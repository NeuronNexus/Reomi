import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { applications, follows, hostVerifications, roomWaitlist, rooms } from '../db/schema';
import type { Ctx } from './common';
import { notify } from './notify.service';
import { autoAdmit } from './rooms.service';

/**
 * Time-based notices, checked every minute: followers hear about new rooms, the waitlist hears
 * when a room opens, and members are asked to rate the host when it ends. Each room records what
 * it already sent, so restarts and sleeping free instances never send anything twice.
 */
export const sweep = async (ctx: Ctx) => {
  const announce = await ctx.db
    .update(rooms)
    .set({ announcedAt: new Date() })
    .where(
      and(isNotNull(rooms.startsAt), isNull(rooms.announcedAt), eq(rooms.visibility, 'public')),
    )
    .returning();
  for (const room of announce) {
    const [host] = await ctx.db
      .select({ name: hostVerifications.displayName })
      .from(hostVerifications)
      .where(eq(hostVerifications.userId, room.hostId));
    const followers = await ctx.db
      .select({ userId: follows.followerId })
      .from(follows)
      .where(eq(follows.followeeId, room.hostId));
    const upcoming = room.startsAt! > new Date();
    await notify(
      ctx,
      followers.map((f) => f.userId),
      {
        kind: 'host_room',
        title: `${host?.name ?? 'A host you follow'} ${upcoming ? 'announced' : 'opened'} a new room`,
        body: room.title,
        link: `/rooms/${room.id}`,
      },
    );
  }

  const opened = await ctx.db
    .update(rooms)
    .set({ openNotifiedAt: new Date() })
    .where(
      and(
        eq(rooms.status, 'open'),
        isNull(rooms.openNotifiedAt),
        sql`${rooms.startsAt} <= now()`,
        sql`${rooms.endsAt} > now()`,
      ),
    )
    .returning();
  for (const room of opened) {
    const waiting = await ctx.db
      .select({ userId: roomWaitlist.userId })
      .from(roomWaitlist)
      .where(eq(roomWaitlist.roomId, room.id));
    await notify(
      ctx,
      waiting.map((w) => w.userId),
      {
        kind: 'room_open',
        title: `${room.title} is open`,
        body: 'You were on the waitlist. Apply before the seats go.',
        link: `/rooms/${room.id}`,
      },
    );
  }

  const ended = await ctx.db
    .update(rooms)
    .set({ endNotifiedAt: new Date() })
    .where(
      and(
        isNotNull(rooms.startsAt),
        isNull(rooms.endNotifiedAt),
        sql`(${rooms.status} = 'closed' or ${rooms.endsAt} <= now())`,
      ),
    )
    .returning();
  for (const room of ended) {
    const members = await ctx.db
      .select({ userId: applications.userId })
      .from(applications)
      .where(and(eq(applications.roomId, room.id), eq(applications.status, 'joined')));
    await notify(
      ctx,
      members.map((m) => m.userId),
      {
        kind: 'rate_host',
        title: `${room.title} has ended`,
        body: 'How was it? Rate your host to help others choose.',
        link: `/rooms/${room.id}/space`,
      },
    );
  }

  // Expired seat holds free seats in instant rooms; offer them to the queue.
  const instant = await ctx.db
    .select({ id: rooms.id })
    .from(rooms)
    .where(
      and(
        eq(rooms.admission, 'instant'),
        eq(rooms.status, 'open'),
        sql`${rooms.startsAt} <= now() and ${rooms.endsAt} > now()`,
        sql`exists (select 1 from applications a where a.room_id = ${rooms.id} and a.status = 'pending')`,
      ),
    );
  for (const room of instant) await autoAdmit(ctx, room.id);
};

export const startSweeper = (ctx: Ctx, log: { error: (data: object, message: string) => void }) => {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    sweep(ctx)
      .catch((err: unknown) => log.error({ err }, 'Sweeper failed'))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
};

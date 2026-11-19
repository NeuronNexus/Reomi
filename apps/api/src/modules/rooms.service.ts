import { and, asc, count, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { FEATURE, formatPaise } from '@reomi/shared';
import type { MyApplication, RoomCard, RoomDetail, roomListQuery } from '@reomi/shared';
import { applications, hostVerifications, profiles, roomWaitlist, rooms } from '../db/schema';
import { assessAdmission } from '../lib/balance';
import type { Person } from '../lib/balance';
import { generateAlias } from '../lib/alias';
import { conflict, forbidden, notFound } from '../lib/errors';
import { roomChannel } from '../lib/realtime';
import {
  assessCandidate,
  assessFor,
  balancingApplies,
  personFor,
  seatHolders,
  seatHoldersByRoom,
} from './balance.service';
import type { Ctx, DbLike } from './common';
import {
  iso,
  isoOrNull,
  isRoomLive,
  isRoomUpcoming,
  likeTerm,
  pageOffset,
  seatsTakenSql,
  viewStatus,
} from './common';
import { fallbackSummary, hostRecords } from './hosts.service';
import { notify } from './notify.service';

type Room = typeof rooms.$inferSelect;

const cardSelection = {
  room: rooms,
  hostName: hostVerifications.displayName,
  hostPublicId: hostVerifications.publicId,
  seatsTaken: seatsTakenSql(rooms.id),
  waitlistCount: sql<number>`(select count(*)::int from room_waitlist w where w.room_id = ${rooms.id})`,
};

type CardRow = {
  room: Room;
  hostName: string;
  hostPublicId: string;
  seatsTaken: number;
  waitlistCount: number;
};

interface Viewer {
  userId: string;
  person: Person;
  waitlisted: Set<string>;
}

const loadViewer = async (
  db: DbLike,
  userId: string | undefined,
  roomIds: string[],
): Promise<Viewer | null> => {
  if (!userId) return null;
  const [person, waits] = await Promise.all([
    personFor(db, userId),
    roomIds.length
      ? db
          .select({ roomId: roomWaitlist.roomId })
          .from(roomWaitlist)
          .where(and(eq(roomWaitlist.userId, userId), inArray(roomWaitlist.roomId, roomIds)))
      : Promise.resolve([]),
  ]);
  return { userId, person, waitlisted: new Set(waits.map((w) => w.roomId)) };
};

/** Builds cards with host reputation and, for signed-in viewers, how well they fit each room. */
export const toCards = async (
  ctx: Pick<Ctx, 'db'>,
  rows: CardRow[],
  viewerId?: string,
): Promise<RoomCard[]> => {
  const ids = rows.map((row) => row.room.id);
  const [records, holders, viewer] = await Promise.all([
    hostRecords(ctx),
    viewerId ? seatHoldersByRoom(ctx.db, ids) : Promise.resolve(new Map<string, Person[]>()),
    loadViewer(ctx.db, viewerId, ids),
  ]);
  return rows.map(({ room, hostName, hostPublicId, seatsTaken, waitlistCount }) => {
    let fit: RoomCard['fit'] = null;
    if (viewer && viewer.person.gender && balancingApplies(room) && room.hostId !== viewer.userId) {
      fit = assessAdmission(holders.get(room.id) ?? [], viewer.person).ok ? 'good' : 'paused';
    }
    return {
      id: room.id,
      title: room.title,
      summary: room.summary,
      category: room.category,
      visibility: room.visibility,
      admission: room.admission,
      balanceMode: room.category === 'dating' ? 'balanced' : room.balanceMode,
      ticketPricePaise: room.ticketPricePaise,
      capacity: room.capacity,
      seatsLeft: Math.max(room.capacity - seatsTaken, 0),
      durationDays: room.durationDays,
      startsAt: iso(room.startsAt!),
      endsAt: iso(room.endsAt!),
      upcoming: isRoomUpcoming(room),
      waitlistCount,
      onWaitlist: viewer?.waitlisted.has(room.id) ?? false,
      fit,
      host: records.get(room.hostId)?.summary ?? fallbackSummary(hostPublicId, hostName),
    };
  });
};

const discoveryRank = sql`case
  when ${FEATURE.discoveryPriority} = any(${rooms.entitlements}) then 2
  when ${FEATURE.discoveryEnhanced} = any(${rooms.entitlements}) then 1
  else 0 end`;

export const listRooms = async (
  ctx: Ctx,
  query: z.infer<typeof roomListQuery>,
  viewerId?: string,
) => {
  const ids = query.ids
    ?.split(',')
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 6);
  const where = and(
    eq(rooms.status, 'open'),
    gt(rooms.endsAt, sql`now()`),
    ids?.length ? inArray(rooms.id, ids) : eq(rooms.visibility, 'public'),
    query.when === 'live' ? sql`${rooms.startsAt} <= now()` : undefined,
    query.when === 'upcoming' ? sql`${rooms.startsAt} > now()` : undefined,
    query.category ? eq(rooms.category, query.category) : undefined,
    query.hostId ? eq(hostVerifications.publicId, query.hostId) : undefined,
    query.q
      ? or(ilike(rooms.title, likeTerm(query.q)), ilike(rooms.summary, likeTerm(query.q)))
      : undefined,
  );

  const [rows, totals] = await Promise.all([
    ctx.db
      .select(cardSelection)
      .from(rooms)
      .innerJoin(hostVerifications, eq(hostVerifications.userId, rooms.hostId))
      .where(where)
      .orderBy(desc(discoveryRank), asc(rooms.startsAt), asc(rooms.id))
      .limit(query.pageSize)
      .offset(pageOffset(query)),
    ctx.db
      .select({ total: count() })
      .from(rooms)
      .innerJoin(hostVerifications, eq(hostVerifications.userId, rooms.hostId))
      .where(where),
  ]);

  return {
    items: await toCards(ctx, rows, viewerId),
    total: totals[0]?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
};

const toMyApplication = (
  application: typeof applications.$inferSelect,
  room: Room,
  admissionNote: string | null = null,
): MyApplication => ({
  id: application.id,
  roomId: application.roomId,
  roomTitle: room.title,
  alias: application.alias,
  message: application.message,
  status: viewStatus(application),
  paymentDueAt: isoOrNull(application.paymentDueAt),
  ticketPricePaise: room.ticketPricePaise,
  roomEndsAt: isoOrNull(room.endsAt),
  admissionNote,
  createdAt: iso(application.createdAt),
});

/** Live public rooms the balance rules would admit this person to, best seats first. */
export const suggestRooms = async (
  ctx: Ctx,
  userId: string,
  excludeRoomId: string,
  category?: Room['category'],
) => {
  const rows = await ctx.db
    .select(cardSelection)
    .from(rooms)
    .innerJoin(hostVerifications, eq(hostVerifications.userId, rooms.hostId))
    .where(
      and(
        eq(rooms.status, 'open'),
        eq(rooms.visibility, 'public'),
        sql`${rooms.startsAt} <= now() and ${rooms.endsAt} > now()`,
        sql`${rooms.id} <> ${excludeRoomId}`,
        sql`${rooms.hostId} <> ${userId}`,
        category ? eq(rooms.category, category) : undefined,
      ),
    )
    .orderBy(desc(discoveryRank), desc(rooms.startsAt))
    .limit(30);
  const cards = await toCards(ctx, rows, userId);
  return cards.filter((card) => card.fit !== 'paused' && card.seatsLeft > 0).slice(0, 3);
};

export const getRoom = async (
  ctx: Ctx,
  roomId: string,
  viewerId: string | undefined,
  inviteCode?: string,
): Promise<RoomDetail> => {
  const [row] = await ctx.db
    .select(cardSelection)
    .from(rooms)
    .innerJoin(hostVerifications, eq(hostVerifications.userId, rooms.hostId))
    .where(eq(rooms.id, roomId));
  if (!row || !row.room.startsAt) throw notFound('Room');

  const mine = viewerId
    ? (
        await ctx.db
          .select()
          .from(applications)
          .where(and(eq(applications.roomId, roomId), eq(applications.userId, viewerId)))
      )[0]
    : undefined;

  const isHost = row.room.hostId === viewerId;
  const hasCode = Boolean(inviteCode) && inviteCode!.toUpperCase() === row.room.inviteCode;
  const current = isRoomLive(row.room) || isRoomUpcoming(row.room);
  // Closed rooms stay readable only for the people who were part of them; private ones need the code.
  if (!isHost && !mine) {
    if (!current) throw notFound('Room');
    if (row.room.visibility === 'private' && !hasCode) throw notFound('Room');
  }

  const [card] = await toCards(ctx, [row], viewerId);
  let balance: RoomDetail['balance'] = null;
  let suggestions: RoomCard[] = [];
  if (viewerId && !isHost) {
    const assessment = await assessFor(ctx.db, row.room, viewerId);
    if (assessment) {
      balance = { ok: assessment.ok, message: assessment.message };
      const settled = mine && ['joined', 'accepted'].includes(viewStatus(mine));
      if (!assessment.ok && !settled) {
        suggestions = await suggestRooms(ctx, viewerId, roomId, row.room.category);
      }
    }
  }

  const note = mine?.status === 'pending' && balance && !balance.ok ? balance.message : null;
  return {
    ...card!,
    description: row.room.description,
    isHost,
    platformFeeBps: row.room.platformFeeBps,
    myApplication: mine ? toMyApplication(mine, row.room, note) : null,
    balance,
    suggestions,
    inviteCodeRequired: row.room.visibility === 'private',
  };
};

export const findRoomByCode = async (ctx: Ctx, code: string) => {
  const [room] = await ctx.db
    .select({ id: rooms.id })
    .from(rooms)
    .where(
      and(eq(rooms.inviteCode, code.trim().toUpperCase()), sql`${rooms.startsAt} is not null`),
    );
  if (!room) throw notFound('Room');
  return { roomId: room.id };
};

export const listMyApplications = async (ctx: Ctx, userId: string): Promise<MyApplication[]> => {
  const rows = await ctx.db
    .select({ application: applications, room: rooms })
    .from(applications)
    .innerJoin(rooms, eq(rooms.id, applications.roomId))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.updatedAt));
  return rows.map(({ application, room }) => toMyApplication(application, room));
};

export const acceptInto = async (
  db: DbLike,
  room: Room,
  applicationId: string,
  paymentWindowHours: number,
  now = new Date(),
) => {
  const windowEnd = now.getTime() + paymentWindowHours * 3_600_000;
  await db
    .update(applications)
    .set({
      status: 'accepted',
      decidedAt: now,
      paymentDueAt: new Date(Math.min(windowEnd, room.endsAt!.getTime())),
    })
    .where(eq(applications.id, applicationId));
};

/**
 * For instant-admission rooms: offers seats to waiting applicants in arrival order, as long as
 * seats remain and the balance rules allow each one. Runs after anything that changes the room.
 */
export const autoAdmit = async (ctx: Ctx, roomId: string) => {
  const admitted = await ctx.db.transaction(async (tx) => {
    const [room] = await tx.select().from(rooms).where(eq(rooms.id, roomId)).for('update');
    if (!room || room.admission !== 'instant' || !isRoomLive(room)) return [];
    const pending = await tx
      .select({
        id: applications.id,
        userId: applications.userId,
        gender: profiles.gender,
        wants: profiles.interestedIn,
      })
      .from(applications)
      .innerJoin(profiles, eq(profiles.id, applications.userId))
      .where(and(eq(applications.roomId, roomId), eq(applications.status, 'pending')))
      .orderBy(asc(applications.createdAt));
    if (pending.length === 0) return [];

    const members = await seatHolders(tx, roomId);
    const done: { userId: string; room: Room }[] = [];
    for (const candidate of pending) {
      if (members.length >= room.capacity) break;
      const outlook = assessCandidate(room, members, candidate);
      if (outlook && !outlook.ok) continue;
      await acceptInto(tx, room, candidate.id, ctx.config.PAYMENT_WINDOW_HOURS);
      members.push(candidate);
      done.push({ userId: candidate.userId, room });
    }
    return done;
  });

  for (const { userId, room } of admitted) {
    await notify(ctx, [userId], {
      kind: 'admitted',
      title: `You have a seat in ${room.title}`,
      body: `Pay ${formatPaise(room.ticketPricePaise)} within ${ctx.config.PAYMENT_WINDOW_HOURS} hours to keep it.`,
      link: `/rooms/${room.id}`,
    });
  }
  return admitted.length;
};

export const applyToRoom = async (
  ctx: Ctx,
  input: { roomId: string; userId: string; message: string; inviteCode?: string | undefined },
): Promise<MyApplication> => {
  const result = await ctx.db.transaction(async (tx) => {
    // Locking the room serialises applicants, keeping the seat check and alias pick accurate.
    const [room] = await tx.select().from(rooms).where(eq(rooms.id, input.roomId)).for('update');
    if (!room || !room.startsAt) throw notFound('Room');
    if (!isRoomLive(room)) {
      throw conflict(
        'room_not_open',
        isRoomUpcoming(room)
          ? 'This room has not opened yet. Join the waitlist instead.'
          : 'This room is no longer open',
      );
    }
    if (room.hostId === input.userId) throw forbidden('own_room', 'You host this room');

    const existingApplications = await tx
      .select()
      .from(applications)
      .where(eq(applications.roomId, room.id));
    const previous = existingApplications.find((row) => row.userId === input.userId);

    if (
      room.visibility === 'private' &&
      !previous &&
      input.inviteCode?.toUpperCase() !== room.inviteCode
    ) {
      throw forbidden(
        'invite_code_required',
        'This is a private room. Ask the host for its invite code.',
      );
    }

    const [{ seatsTaken } = { seatsTaken: 0 }] = await tx
      .select({ seatsTaken: seatsTakenSql(room.id) })
      .from(rooms)
      .where(eq(rooms.id, room.id));
    if (seatsTaken >= room.capacity) throw conflict('room_full', 'This room is full');

    if (previous) {
      const status = viewStatus(previous);
      if (status === 'removed') throw forbidden('forbidden', 'You were removed from this room');
      if (status !== 'withdrawn' && status !== 'expired' && status !== 'left') {
        throw conflict('already_applied', 'You have already applied to this room');
      }
      const [updated] = await tx
        .update(applications)
        .set({ status: 'pending', message: input.message, paymentDueAt: null, decidedAt: null })
        .where(eq(applications.id, previous.id))
        .returning();
      return { application: updated!, room };
    }

    const taken = new Set(existingApplications.map((row) => row.alias));
    const [created] = await tx
      .insert(applications)
      .values({
        roomId: room.id,
        userId: input.userId,
        message: input.message,
        alias: generateAlias(taken),
      })
      .returning();
    return { application: created!, room };
  });

  if (result.room.admission === 'instant') {
    await autoAdmit(ctx, result.room.id);
  } else {
    await notify(ctx, [result.room.hostId], {
      kind: 'application',
      title: `New application for ${result.room.title}`,
      body: `${result.application.alias} wants to join.`,
      link: `/host/rooms/${result.room.id}`,
    });
  }

  const [fresh] = await ctx.db
    .select()
    .from(applications)
    .where(eq(applications.id, result.application.id));
  const outlook =
    fresh!.status === 'pending' ? await assessFor(ctx.db, result.room, input.userId) : null;
  return toMyApplication(fresh!, result.room, outlook && !outlook.ok ? outlook.message : null);
};

export const withdrawApplication = async (ctx: Ctx, applicationId: string, userId: string) => {
  const [row] = await ctx.db
    .update(applications)
    .set({ status: 'withdrawn', paymentDueAt: null })
    .where(
      and(
        eq(applications.id, applicationId),
        eq(applications.userId, userId),
        or(eq(applications.status, 'pending'), eq(applications.status, 'accepted')),
      ),
    )
    .returning({ id: applications.id, roomId: applications.roomId });
  if (!row)
    throw conflict('application_not_pending', 'This application can no longer be withdrawn');
  await autoAdmit(ctx, row.roomId);
};

export const leaveRoom = async (ctx: Ctx, roomId: string, userId: string) => {
  const [row] = await ctx.db
    .update(applications)
    .set({ status: 'left' })
    .where(
      and(
        eq(applications.roomId, roomId),
        eq(applications.userId, userId),
        eq(applications.status, 'joined'),
      ),
    )
    .returning({ id: applications.id });
  if (!row) throw conflict('not_a_member', 'You are not in this room');
  ctx.hub.publish(roomChannel(roomId), { kind: 'members' });
  await autoAdmit(ctx, roomId);
};

export const joinWaitlist = async (ctx: Ctx, roomId: string, userId: string) => {
  const [room] = await ctx.db.select().from(rooms).where(eq(rooms.id, roomId));
  if (!room || !isRoomUpcoming(room)) {
    throw conflict('room_not_open', 'Only upcoming rooms have a waitlist');
  }
  if (room.hostId === userId) throw forbidden('own_room', 'You host this room');
  await ctx.db.insert(roomWaitlist).values({ roomId, userId }).onConflictDoNothing();
};

export const leaveWaitlist = async (ctx: Ctx, roomId: string, userId: string) => {
  await ctx.db
    .delete(roomWaitlist)
    .where(and(eq(roomWaitlist.roomId, roomId), eq(roomWaitlist.userId, userId)));
};

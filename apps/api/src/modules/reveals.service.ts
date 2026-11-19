import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { ageOn } from '@reomi/shared';
import type { Follow, Reveal, RevealedProfile } from '@reomi/shared';
import {
  applications,
  follows,
  hostVerifications,
  profiles,
  reveals,
  rooms,
  threads,
} from '../db/schema';
import { AppError, conflict, forbidden, isUniqueViolation, notFound } from '../lib/errors';
import { roomChannel, userChannel } from '../lib/realtime';
import type { Ctx } from './common';
import { iso, isRoomLive, orderedPair } from './common';
import { invalidateHostCache } from './hosts.service';
import { signPaths } from './media.service';
import { notify } from './notify.service';

type RevealRow = typeof reveals.$inferSelect;
type Profile = typeof profiles.$inferSelect;

const toProfile = (profile: Profile, avatarUrl: string | null): RevealedProfile => ({
  userId: profile.id,
  fullName: profile.fullName ?? 'Someone',
  age: profile.dateOfBirth ? ageOn(profile.dateOfBirth) : null,
  gender: profile.gender,
  city: profile.city,
  bio: profile.bio,
  avatarUrl,
});

/**
 * Builds reveal views for one person. Real profiles are attached only to accepted reveals, and
 * only the other person's, so nothing about anyone leaks before both said yes.
 */
const toReveals = async (ctx: Ctx, rows: RevealRow[], viewerId: string): Promise<Reveal[]> => {
  if (rows.length === 0) return [];
  const otherIds = rows.map((r) => (r.requesterId === viewerId ? r.recipientId : r.requesterId));
  const roomIds = [...new Set(rows.map((r) => r.roomId))];
  const [aliasRows, roomRows, acceptedProfiles, dmThreads] = await Promise.all([
    ctx.db
      .select({
        roomId: applications.roomId,
        userId: applications.userId,
        alias: applications.alias,
      })
      .from(applications)
      .where(and(inArray(applications.roomId, roomIds), inArray(applications.userId, otherIds))),
    ctx.db
      .select({ id: rooms.id, title: rooms.title })
      .from(rooms)
      .where(inArray(rooms.id, roomIds)),
    ctx.db
      .select()
      .from(profiles)
      .where(
        inArray(
          profiles.id,
          rows
            .filter((r) => r.status === 'accepted')
            .map((r) => (r.requesterId === viewerId ? r.recipientId : r.requesterId))
            .concat(['00000000-0000-0000-0000-000000000000']),
        ),
      ),
    ctx.db
      .select()
      .from(threads)
      .where(
        and(eq(threads.kind, 'dm'), or(eq(threads.userA, viewerId), eq(threads.userB, viewerId))),
      ),
  ]);
  const avatars = await signPaths(
    ctx,
    acceptedProfiles.map((p) => p.avatarPath),
  );

  return rows.map((row) => {
    const outgoing = row.requesterId === viewerId;
    const otherId = outgoing ? row.recipientId : row.requesterId;
    const profile =
      row.status === 'accepted' ? acceptedProfiles.find((p) => p.id === otherId) : undefined;
    const [a, b] = orderedPair(viewerId, otherId);
    const thread = dmThreads.find((t) => t.userA === a && t.userB === b);
    return {
      id: row.id,
      roomId: row.roomId,
      roomTitle: roomRows.find((r) => r.id === row.roomId)?.title ?? 'A room',
      direction: outgoing ? 'outgoing' : 'incoming',
      status: row.status,
      otherAlias:
        aliasRows.find((r) => r.roomId === row.roomId && r.userId === otherId)?.alias ?? 'Someone',
      profile: profile
        ? toProfile(profile, profile.avatarPath ? (avatars.get(profile.avatarPath) ?? null) : null)
        : null,
      youConfirmed: Boolean(outgoing ? row.requesterConfirmedAt : row.recipientConfirmedAt),
      theyConfirmed: Boolean(outgoing ? row.recipientConfirmedAt : row.requesterConfirmedAt),
      stage: (outgoing ? row.requesterStage : row.recipientStage) ?? null,
      threadId: thread?.id ?? null,
      createdAt: iso(row.createdAt),
    };
  });
};

export const listRevealsForRoom = async (ctx: Ctx, roomId: string, userId: string) => {
  const rows = await ctx.db
    .select()
    .from(reveals)
    .where(
      and(
        eq(reveals.roomId, roomId),
        inArray(reveals.status, ['pending', 'accepted']),
        or(eq(reveals.requesterId, userId), eq(reveals.recipientId, userId)),
      ),
    )
    .orderBy(desc(reveals.createdAt));
  return toReveals(ctx, rows, userId);
};

export const listConnections = async (ctx: Ctx, userId: string) => {
  const rows = await ctx.db
    .select()
    .from(reveals)
    .where(
      and(
        inArray(reveals.status, ['pending', 'accepted']),
        or(eq(reveals.requesterId, userId), eq(reveals.recipientId, userId)),
      ),
    )
    .orderBy(desc(reveals.createdAt))
    .limit(200);
  return toReveals(ctx, rows, userId);
};

const memberByAlias = async (ctx: Ctx, roomId: string, alias: string) => {
  const [row] = await ctx.db
    .select({ userId: applications.userId })
    .from(applications)
    .where(
      and(
        eq(applications.roomId, roomId),
        eq(applications.alias, alias),
        eq(applications.status, 'joined'),
      ),
    );
  return row?.userId ?? null;
};

const isJoined = async (ctx: Ctx, roomId: string, userId: string) =>
  Boolean(await memberAlias(ctx, roomId, userId));

const memberAlias = async (ctx: Ctx, roomId: string, userId: string) => {
  const [row] = await ctx.db
    .select({ alias: applications.alias })
    .from(applications)
    .where(
      and(
        eq(applications.roomId, roomId),
        eq(applications.userId, userId),
        eq(applications.status, 'joined'),
      ),
    );
  return row?.alias ?? null;
};

export const requestReveal = async (
  ctx: Ctx,
  input: { roomId: string; userId: string; toAlias: string; announce: boolean },
) => {
  const [room] = await ctx.db.select().from(rooms).where(eq(rooms.id, input.roomId));
  if (!room) throw notFound('Room');
  if (!isRoomLive(room)) throw conflict('room_not_open', 'Reveals happen while the room is open');
  const myAlias = await memberAlias(ctx, room.id, input.userId);
  if (!myAlias) throw forbidden('not_a_member', 'Only members can reveal');
  const otherId = await memberByAlias(ctx, room.id, input.toAlias);
  if (!otherId || otherId === input.userId) throw notFound('Member');

  try {
    await ctx.db.insert(reveals).values({
      roomId: room.id,
      requesterId: input.userId,
      recipientId: otherId,
      requesterAnnounce: input.announce,
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict('reveal_exists', 'There is already a reveal between you two');
    throw error;
  }
  await notify(ctx, [otherId], {
    kind: 'reveal_request',
    title: `${myAlias} wants to reveal identities`,
    body: `In ${room.title}. Nothing is shared unless you accept.`,
    link: `/rooms/${room.id}/space`,
  });
  ctx.hub.publish(userChannel(otherId), { kind: 'reveals' });
  ctx.hub.publish(userChannel(input.userId), { kind: 'reveals' });
};

export const respondToReveal = async (
  ctx: Ctx,
  input: { revealId: string; userId: string; accept: boolean; announce: boolean },
) => {
  const [reveal] = await ctx.db.select().from(reveals).where(eq(reveals.id, input.revealId));
  if (!reveal || reveal.recipientId !== input.userId) throw notFound('Reveal');
  if (reveal.status !== 'pending') throw conflict('conflict', 'This request was already answered');
  if (input.accept && !(await isJoined(ctx, reveal.roomId, input.userId))) {
    throw forbidden('not_a_member', 'You are no longer in this room');
  }

  const [updated] = await ctx.db
    .update(reveals)
    .set({
      status: input.accept ? 'accepted' : 'declined',
      recipientAnnounce: input.accept && input.announce,
      respondedAt: new Date(),
    })
    .where(and(eq(reveals.id, reveal.id), eq(reveals.status, 'pending')))
    .returning();
  if (!updated) throw conflict('conflict', 'This request was already answered');

  const [room] = await ctx.db.select().from(rooms).where(eq(rooms.id, reveal.roomId));
  if (input.accept) {
    const [requesterAlias, recipientAlias] = await Promise.all([
      memberAlias(ctx, reveal.roomId, reveal.requesterId),
      memberAlias(ctx, reveal.roomId, reveal.recipientId),
    ]);
    await notify(ctx, [reveal.requesterId], {
      kind: 'reveal_accepted',
      title: `${recipientAlias ?? 'Someone'} accepted your reveal`,
      body: 'You can now see each other and message directly.',
      link: '/connections',
    });
    // The room hears about it only if both people opted in to the announcement.
    if (
      updated.requesterAnnounce &&
      updated.recipientAnnounce &&
      requesterAlias &&
      recipientAlias
    ) {
      const { postSystemMessage } = await import('./space.service');
      await postSystemMessage(
        ctx,
        reveal.roomId,
        `${requesterAlias} and ${recipientAlias} revealed to each other. Congratulations!`,
        'announcement',
      );
    }
    ctx.hub.publish(roomChannel(reveal.roomId), { kind: 'members' });
  } else if (room) {
    await notify(ctx, [reveal.requesterId], {
      kind: 'reveal_declined',
      title: 'Your reveal request was declined',
      body: `In ${room.title}. You stay anonymous to each other.`,
    });
  }
  ctx.hub.publish(userChannel(reveal.requesterId), { kind: 'reveals' });
  ctx.hub.publish(userChannel(reveal.recipientId), { kind: 'reveals' });
};

export const cancelReveal = async (ctx: Ctx, revealId: string, userId: string) => {
  const [row] = await ctx.db
    .update(reveals)
    .set({ status: 'cancelled' })
    .where(
      and(eq(reveals.id, revealId), eq(reveals.requesterId, userId), eq(reveals.status, 'pending')),
    )
    .returning();
  if (!row) throw conflict('conflict', 'This request can no longer be cancelled');
  ctx.hub.publish(userChannel(row.recipientId), { kind: 'reveals' });
};

/**
 * Either person says the room led to a real connection. It counts toward the host's record only
 * once both have said so; a reveal on its own is not a relationship.
 */
export const confirmConnection = async (
  ctx: Ctx,
  revealId: string,
  userId: string,
  stage: NonNullable<RevealRow['requesterStage']>,
) => {
  const [reveal] = await ctx.db.select().from(reveals).where(eq(reveals.id, revealId));
  if (!reveal || (reveal.requesterId !== userId && reveal.recipientId !== userId))
    throw notFound('Reveal');
  if (reveal.status !== 'accepted')
    throw new AppError(409, 'conflict', 'Only accepted reveals can be confirmed');
  const now = new Date();
  await ctx.db
    .update(reveals)
    .set(
      reveal.requesterId === userId
        ? { requesterConfirmedAt: now, requesterStage: stage }
        : { recipientConfirmedAt: now, recipientStage: stage },
    )
    .where(eq(reveals.id, revealId));
  invalidateHostCache();
};

export const listFollowing = async (ctx: Ctx, userId: string): Promise<Follow[]> => {
  const rows = await ctx.db
    .select({
      userId: follows.followeeId,
      fullName: profiles.fullName,
      avatarPath: profiles.avatarPath,
      hostName: hostVerifications.displayName,
      hostPublicId: hostVerifications.publicId,
      hostStatus: hostVerifications.status,
    })
    .from(follows)
    .innerJoin(profiles, eq(profiles.id, follows.followeeId))
    .leftJoin(hostVerifications, eq(hostVerifications.userId, follows.followeeId))
    .where(eq(follows.followerId, userId));
  const connections = await listConnections(ctx, userId);
  const connected = new Set(
    connections.filter((c) => c.status === 'accepted').map((c) => c.profile?.userId),
  );
  const avatars = await signPaths(
    ctx,
    rows.filter((r) => connected.has(r.userId)).map((r) => r.avatarPath),
  );
  return rows.map((row) => {
    const isConnection = connected.has(row.userId);
    return {
      id: isConnection || !row.hostPublicId ? row.userId : row.hostPublicId,
      // Hosts appear under their public name unless you know them personally.
      name: isConnection ? (row.fullName ?? 'Someone') : (row.hostName ?? 'Host'),
      kind: isConnection ? 'connection' : 'host',
      avatarUrl: isConnection && row.avatarPath ? (avatars.get(row.avatarPath) ?? null) : null,
    };
  });
};

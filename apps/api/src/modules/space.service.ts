import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { ACTIVITY_FEATURE, ACTIVITY_KINDS } from '@reomi/shared';
import type { Activity, CreateActivityInput, Message, Space, Thread } from '@reomi/shared';
import {
  activityResponses,
  applications,
  hostRatings,
  hostVerifications,
  messages,
  profiles,
  reveals,
  roomActivities,
  rooms,
  threads,
} from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../lib/errors';
import { scanMessage } from '../lib/moderation';
import type { Identity } from '../lib/moderation';
import { roomChannel, threadChannel, userChannel } from '../lib/realtime';
import type { Ctx } from './common';
import { firstName, iso, isoOrNull, isRoomEnded, isRoomLive, orderedPair } from './common';
import { signPaths } from './media.service';
import { assertNotMuted, enforce } from './moderation.service';
import { listRevealsForRoom } from './reveals.service';

type Room = typeof rooms.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type Profile = typeof profiles.$inferSelect;

export interface RoomAccess {
  room: Room;
  isHost: boolean;
  hostName: string;
  hostPublicId: string;
  /** Your alias as a member, or your host display name. */
  name: string;
  role: 'member' | 'host';
}

/** Members who paid and the host may enter. Everyone else, including removed members, may not. */
export const roomAccess = async (ctx: Ctx, roomId: string, userId: string): Promise<RoomAccess> => {
  const [row] = await ctx.db
    .select({
      room: rooms,
      hostName: hostVerifications.displayName,
      hostPublicId: hostVerifications.publicId,
    })
    .from(rooms)
    .innerJoin(hostVerifications, eq(hostVerifications.userId, rooms.hostId))
    .where(eq(rooms.id, roomId));
  if (!row || !row.room.startsAt) throw notFound('Room');
  const base = { room: row.room, hostName: row.hostName, hostPublicId: row.hostPublicId };
  if (row.room.hostId === userId) {
    return { ...base, isHost: true, name: row.hostName, role: 'host' };
  }
  const [membership] = await ctx.db
    .select({ alias: applications.alias })
    .from(applications)
    .where(
      and(
        eq(applications.roomId, roomId),
        eq(applications.userId, userId),
        eq(applications.status, 'joined'),
      ),
    );
  if (!membership) throw forbidden('not_a_member', 'Only members of this room can enter it');
  return { ...base, isHost: false, name: membership.alias, role: 'member' };
};

/** Real identities of everyone in the room, for the disclosure check. Never leaves the server. */
const roomIdentities = async (ctx: Ctx, room: Room) => {
  const rows = await ctx.db
    .select({ userId: profiles.id, fullName: profiles.fullName, email: profiles.email, city: profiles.city, alias: applications.alias })
    .from(applications)
    .innerJoin(profiles, eq(profiles.id, applications.userId))
    .where(and(eq(applications.roomId, room.id), inArray(applications.status, ['joined', 'accepted', 'left', 'removed'])));
  const [host] = await ctx.db
    .select({ userId: profiles.id, fullName: profiles.fullName, email: profiles.email, city: profiles.city })
    .from(profiles)
    .where(eq(profiles.id, room.hostId));
  const [hostName] = await ctx.db
    .select({ name: hostVerifications.displayName })
    .from(hostVerifications)
    .where(eq(hostVerifications.userId, room.hostId));
  const people = new Map<string, Identity>();
  for (const row of rows) people.set(row.userId, row);
  if (host) people.set(host.userId, host);
  const aliases = [...rows.map((row) => row.alias), ...(hostName ? [hostName.name] : [])];
  return { people, aliases };
};

/* Activities ------------------------------------------------------------------------------- */

export const loadActivities = async (
  ctx: Ctx,
  ids: readonly string[],
  viewerId: string | null,
): Promise<Map<string, Activity>> => {
  const result = new Map<string, Activity>();
  if (ids.length === 0) return result;
  const [rows, responses] = await Promise.all([
    ctx.db.select().from(roomActivities).where(inArray(roomActivities.id, [...ids])),
    ctx.db
      .select()
      .from(activityResponses)
      .where(inArray(activityResponses.activityId, [...ids]))
      .orderBy(asc(activityResponses.createdAt)),
  ]);
  for (const activity of rows) {
    const mine = responses.filter((r) => r.activityId === activity.id);
    const results = activity.options.map((_, index) => mine.filter((r) => r.choice === index).length);
    const own = viewerId ? mine.find((r) => r.userId === viewerId) : undefined;
    result.set(activity.id, {
      id: activity.id,
      kind: activity.kind,
      title: activity.title,
      options: activity.options,
      results,
      responses: mine.length,
      answers: mine.filter((r) => r.answer).map((r) => ({ alias: r.alias, text: r.answer! })),
      myChoice: own?.choice ?? null,
      myAnswer: own?.answer ?? null,
      createdAt: iso(activity.createdAt),
    });
  }
  return result;
};

const SYSTEM_SENDER = { key: 'system', name: 'Reomi', role: 'system' as const, avatarUrl: null };

const toMessage = (row: MessageRow, activities: Map<string, Activity>, avatarUrl: string | null = null): Message => ({
  id: row.id,
  roomId: row.roomId,
  threadId: row.threadId,
  kind: row.kind,
  body: row.body,
  sender:
    row.senderRole === 'system'
      ? SYSTEM_SENDER
      : {
          key: row.senderRole === 'person' ? row.senderId ?? 'gone' : row.senderName,
          name: row.senderName,
          role: row.senderRole,
          avatarUrl,
        },
  activity: row.activityId ? activities.get(row.activityId) ?? null : null,
  createdAt: iso(row.createdAt),
});

/* Room chat -------------------------------------------------------------------------------- */

export const listRoomMessages = async (
  ctx: Ctx,
  roomId: string,
  userId: string,
  query: { before?: string | undefined; limit: number },
): Promise<Message[]> => {
  await roomAccess(ctx, roomId, userId);
  const rows = await ctx.db
    .select()
    .from(messages)
    .where(
      and(eq(messages.roomId, roomId), query.before ? lt(messages.createdAt, new Date(query.before)) : undefined),
    )
    .orderBy(desc(messages.createdAt))
    .limit(query.limit);
  const activities = await loadActivities(
    ctx,
    rows.flatMap((row) => (row.activityId ? [row.activityId] : [])),
    userId,
  );
  return rows.reverse().map((row) => toMessage(row, activities));
};

export const postSystemMessage = async (ctx: Ctx, roomId: string, body: string, kind: MessageRow['kind'] = 'system') => {
  const [row] = await ctx.db
    .insert(messages)
    .values({ roomId, senderName: 'Reomi', senderRole: 'system', kind, body })
    .returning();
  ctx.hub.publish(roomChannel(roomId), { kind: 'message', message: toMessage(row!, new Map()) });
};

export const sendRoomMessage = async (ctx: Ctx, roomId: string, profile: Profile, body: string): Promise<Message> => {
  const access = await roomAccess(ctx, roomId, profile.id);
  if (!isRoomLive(access.room)) throw conflict('room_not_open', 'This room is not open for conversation');
  assertNotMuted(profile);

  const { people, aliases } = await roomIdentities(ctx, access.room);
  const verdict = scanMessage(body, {
    sender: profile,
    others: [...people.entries()].filter(([id]) => id !== profile.id).map(([, identity]) => identity),
    aliases,
    allowContact: false,
  });
  if (verdict.verdict === 'block') {
    await enforce(ctx, { userId: profile.id, context: 'room', excerpt: body, roomId, isHost: access.isHost }, verdict);
  }

  const [row] = await ctx.db
    .insert(messages)
    .values({ roomId, senderId: profile.id, senderName: access.name, senderRole: access.role, body })
    .returning();
  const message = toMessage(row!, new Map());
  ctx.hub.publish(roomChannel(roomId), { kind: 'message', message });
  return message;
};

/* Space ------------------------------------------------------------------------------------ */

export const getSpace = async (ctx: Ctx, roomId: string, profile: Profile): Promise<Space> => {
  const access = await roomAccess(ctx, roomId, profile.id);
  const { room } = access;
  const [members, revealList, rating] = await Promise.all([
    ctx.db
      .select({ alias: applications.alias, userId: applications.userId })
      .from(applications)
      .where(and(eq(applications.roomId, roomId), eq(applications.status, 'joined')))
      .orderBy(asc(applications.alias)),
    listRevealsForRoom(ctx, roomId, profile.id),
    ctx.db
      .select({ id: hostRatings.id })
      .from(hostRatings)
      .where(and(eq(hostRatings.roomId, roomId), eq(hostRatings.userId, profile.id))),
  ]);
  const revealedAliases = new Set(revealList.filter((r) => r.status === 'accepted').map((r) => r.otherAlias));
  const ended = isRoomEnded(room);

  return {
    roomId: room.id,
    title: room.title,
    category: room.category,
    live: isRoomLive(room),
    ended,
    startsAt: isoOrNull(room.startsAt),
    endsAt: isoOrNull(room.endsAt),
    isHost: access.isHost,
    host: { id: access.hostPublicId, displayName: access.hostName },
    you: { key: access.name, name: access.name },
    members: members.map((member) => ({
      alias: member.alias,
      revealed: revealedAliases.has(member.alias),
      isYou: member.userId === profile.id,
    })),
    activityKinds: ACTIVITY_KINDS.filter((kind) => room.entitlements.includes(ACTIVITY_FEATURE[kind])),
    reveals: revealList,
    canRate: !access.isHost && ended && rating.length === 0,
    rated: rating.length > 0,
    mutedUntil: profile.mutedUntil && profile.mutedUntil > new Date() ? iso(profile.mutedUntil) : null,
  };
};

/* Activities ------------------------------------------------------------------------------- */

export const createActivity = async (ctx: Ctx, roomId: string, hostId: string, input: CreateActivityInput) => {
  const access = await roomAccess(ctx, roomId, hostId);
  if (!access.isHost) throw forbidden('forbidden', 'Only the host can start activities');
  if (!isRoomLive(access.room)) throw conflict('room_not_open', 'This room is not open');
  if (!access.room.entitlements.includes(ACTIVITY_FEATURE[input.kind])) {
    throw forbidden('feature_not_in_plan', 'This activity is not included in the room plan');
  }
  const needsOptions = input.kind === 'poll' || input.kind === 'this_or_that';
  const options = needsOptions ? input.options : [];
  if (input.kind === 'this_or_that' && options.length !== 2) {
    throw new AppError(400, 'validation_failed', 'This or that needs exactly two options');
  }
  if (input.kind === 'poll' && (options.length < 2 || options.length > 6)) {
    throw new AppError(400, 'validation_failed', 'Polls need two to six options');
  }

  const [activity] = await ctx.db
    .insert(roomActivities)
    .values({ roomId, kind: input.kind, title: input.title, options })
    .returning();
  const [row] = await ctx.db
    .insert(messages)
    .values({
      roomId,
      senderId: hostId,
      senderName: access.hostName,
      senderRole: 'host',
      kind: 'activity',
      body: input.title,
      activityId: activity!.id,
    })
    .returning();
  const activities = await loadActivities(ctx, [activity!.id], null);
  const message = toMessage(row!, activities);
  ctx.hub.publish(roomChannel(roomId), { kind: 'message', message });
  return message;
};

export const respondToActivity = async (
  ctx: Ctx,
  activityId: string,
  profile: Profile,
  input: { choice?: number | undefined; text?: string | undefined },
): Promise<Activity> => {
  const [activity] = await ctx.db.select().from(roomActivities).where(eq(roomActivities.id, activityId));
  if (!activity) throw notFound('Activity');
  const access = await roomAccess(ctx, activity.roomId, profile.id);
  if (access.isHost) throw forbidden('forbidden', 'Hosts run activities rather than answer them');
  if (!isRoomLive(access.room)) throw conflict('room_not_open', 'This room is not open');
  assertNotMuted(profile);

  const textual = activity.kind === 'prompt' || activity.kind === 'intro_round';
  if (textual) {
    if (!input.text) throw new AppError(400, 'validation_failed', 'Write an answer first');
    const { people, aliases } = await roomIdentities(ctx, access.room);
    const verdict = scanMessage(input.text, {
      sender: profile,
      others: [...people.entries()].filter(([id]) => id !== profile.id).map(([, identity]) => identity),
      aliases,
      allowContact: false,
    });
    if (verdict.verdict === 'block') {
      await enforce(ctx, { userId: profile.id, context: 'activity', excerpt: input.text, roomId: activity.roomId }, verdict);
    }
  } else if (input.choice === undefined || input.choice >= activity.options.length) {
    throw new AppError(400, 'validation_failed', 'Choose one of the options');
  }

  await ctx.db
    .insert(activityResponses)
    .values({
      activityId,
      userId: profile.id,
      alias: access.name,
      choice: textual ? null : input.choice!,
      answer: textual ? input.text! : null,
    })
    .onConflictDoUpdate({
      target: [activityResponses.activityId, activityResponses.userId],
      set: { choice: textual ? null : input.choice!, answer: textual ? input.text! : null },
    });

  const shared = (await loadActivities(ctx, [activityId], null)).get(activityId)!;
  ctx.hub.publish(roomChannel(activity.roomId), { kind: 'activity', activity: shared });
  return (await loadActivities(ctx, [activityId], profile.id)).get(activityId)!;
};

/* Threads: whispers and direct messages ---------------------------------------------------- */

const aliasInRoom = async (ctx: Ctx, roomId: string, alias: string) => {
  const [row] = await ctx.db
    .select({ userId: applications.userId })
    .from(applications)
    .where(and(eq(applications.roomId, roomId), eq(applications.alias, alias), eq(applications.status, 'joined')));
  return row?.userId ?? null;
};

export const revealedBetween = async (ctx: Ctx, a: string, b: string, roomId?: string) => {
  const [row] = await ctx.db
    .select({ id: reveals.id })
    .from(reveals)
    .where(
      and(
        eq(reveals.status, 'accepted'),
        roomId ? eq(reveals.roomId, roomId) : undefined,
        or(
          and(eq(reveals.requesterId, a), eq(reveals.recipientId, b)),
          and(eq(reveals.requesterId, b), eq(reveals.recipientId, a)),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
};

export const openWhisper = async (ctx: Ctx, roomId: string, userId: string, toAlias: string) => {
  const access = await roomAccess(ctx, roomId, userId);
  let otherId: string | null;
  if (toAlias === access.hostName) otherId = access.room.hostId;
  else otherId = await aliasInRoom(ctx, roomId, toAlias);
  if (!otherId || otherId === userId) throw notFound('Member');
  const [userA, userB] = orderedPair(userId, otherId);
  await ctx.db.insert(threads).values({ kind: 'whisper', roomId, userA, userB }).onConflictDoNothing();
  const [thread] = await ctx.db
    .select()
    .from(threads)
    .where(and(eq(threads.kind, 'whisper'), eq(threads.roomId, roomId), eq(threads.userA, userA), eq(threads.userB, userB)));
  return { threadId: thread!.id };
};

export const openDirect = async (ctx: Ctx, userId: string, otherId: string) => {
  if (userId === otherId) throw new AppError(400, 'bad_request', 'That is you');
  if (!(await revealedBetween(ctx, userId, otherId))) {
    throw forbidden('forbidden', 'You can message people once you have both revealed');
  }
  const [userA, userB] = orderedPair(userId, otherId);
  await ctx.db.insert(threads).values({ kind: 'dm', userA, userB }).onConflictDoNothing();
  const [thread] = await ctx.db
    .select()
    .from(threads)
    .where(and(eq(threads.kind, 'dm'), eq(threads.userA, userA), eq(threads.userB, userB)));
  return { threadId: thread!.id };
};

interface ThreadContext {
  thread: typeof threads.$inferSelect;
  otherId: string;
  you: { key: string; name: string; role: 'member' | 'host' | 'person' };
  other: { key: string; name: string; role: 'member' | 'host' | 'person'; avatarPath: string | null };
  room: Room | null;
  revealed: boolean;
}

const aliasOf = async (ctx: Ctx, room: Room, userId: string, hostName: string) => {
  if (userId === room.hostId) return { name: hostName, role: 'host' as const };
  const [row] = await ctx.db
    .select({ alias: applications.alias })
    .from(applications)
    .where(and(eq(applications.roomId, room.id), eq(applications.userId, userId)));
  return { name: row?.alias ?? 'Former member', role: 'member' as const };
};

const threadContext = async (ctx: Ctx, threadId: string, userId: string): Promise<ThreadContext> => {
  const [thread] = await ctx.db.select().from(threads).where(eq(threads.id, threadId));
  if (!thread || (thread.userA !== userId && thread.userB !== userId)) throw notFound('Conversation');
  const otherId = thread.userA === userId ? thread.userB : thread.userA;

  if (thread.kind === 'whisper') {
    const [row] = await ctx.db
      .select({ room: rooms, hostName: hostVerifications.displayName })
      .from(rooms)
      .innerJoin(hostVerifications, eq(hostVerifications.userId, rooms.hostId))
      .where(eq(rooms.id, thread.roomId!));
    const room = row!.room;
    const [you, other, revealed] = await Promise.all([
      aliasOf(ctx, room, userId, row!.hostName),
      aliasOf(ctx, room, otherId, row!.hostName),
      revealedBetween(ctx, userId, otherId, room.id),
    ]);
    return {
      thread,
      otherId,
      you: { key: you.name, ...you },
      other: { key: other.name, ...other, avatarPath: null },
      room,
      revealed,
    };
  }

  const people = await ctx.db
    .select({ id: profiles.id, fullName: profiles.fullName, avatarPath: profiles.avatarPath })
    .from(profiles)
    .where(inArray(profiles.id, [userId, otherId]));
  const me = people.find((p) => p.id === userId)!;
  const them = people.find((p) => p.id === otherId);
  return {
    thread,
    otherId,
    you: { key: userId, name: firstName(me.fullName), role: 'person' },
    other: { key: otherId, name: them?.fullName ?? 'Someone', role: 'person', avatarPath: them?.avatarPath ?? null },
    room: null,
    revealed: true,
  };
};

export const listThreads = async (ctx: Ctx, userId: string): Promise<Thread[]> => {
  const rows = await ctx.db
    .select()
    .from(threads)
    .where(or(eq(threads.userA, userId), eq(threads.userB, userId)))
    .orderBy(sql`${threads.lastMessageAt} desc nulls last`, desc(threads.createdAt))
    .limit(100);
  const contexts = await Promise.all(rows.map((row) => threadContext(ctx, row.id, userId)));
  const last = rows.length
    ? await ctx.db.execute<{ thread_id: string; body: string }>(sql`
        select distinct on (thread_id) thread_id, body from messages
        where thread_id in (${sql.join(rows.map((row) => sql`${row.id}`), sql`, `)})
        order by thread_id, created_at desc`)
    : [];
  const lastByThread = new Map([...last].map((row) => [row.thread_id, row.body]));
  const avatars = await signPaths(ctx, contexts.map((c) => c.other.avatarPath));
  return contexts.map((c) => ({
    id: c.thread.id,
    kind: c.thread.kind,
    roomId: c.room?.id ?? null,
    roomTitle: c.room?.title ?? null,
    you: { key: c.you.key, name: c.you.name },
    other: {
      key: c.other.key,
      name: c.other.name,
      role: c.other.role,
      avatarUrl: c.other.avatarPath ? avatars.get(c.other.avatarPath) ?? null : null,
    },
    lastMessage: lastByThread.get(c.thread.id) ?? null,
    lastMessageAt: isoOrNull(c.thread.lastMessageAt),
    revealed: c.revealed,
  }));
};

export const getThread = async (ctx: Ctx, threadId: string, userId: string): Promise<Thread> => {
  const all = await listThreads(ctx, userId);
  const found = all.find((thread) => thread.id === threadId);
  if (!found) throw notFound('Conversation');
  return found;
};

export const listThreadMessages = async (
  ctx: Ctx,
  threadId: string,
  userId: string,
  query: { before?: string | undefined; limit: number },
): Promise<Message[]> => {
  await threadContext(ctx, threadId, userId);
  const rows = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.threadId, threadId), query.before ? lt(messages.createdAt, new Date(query.before)) : undefined))
    .orderBy(desc(messages.createdAt))
    .limit(query.limit);
  return rows.reverse().map((row) => toMessage(row, new Map()));
};

export const sendThreadMessage = async (ctx: Ctx, threadId: string, profile: Profile, body: string): Promise<Message> => {
  const c = await threadContext(ctx, threadId, profile.id);
  assertNotMuted(profile);

  if (c.thread.kind === 'whisper') {
    const room = c.room!;
    if (!isRoomLive(room)) throw conflict('room_not_open', 'This room is not open for conversation');
    // Both people must still be in the room.
    await roomAccess(ctx, room.id, profile.id);
    if (c.otherId !== room.hostId) await roomAccess(ctx, room.id, c.otherId);
    if (!c.revealed) {
      const { people, aliases } = await roomIdentities(ctx, room);
      const verdict = scanMessage(body, {
        sender: profile,
        others: [...people.entries()].filter(([id]) => id !== profile.id).map(([, identity]) => identity),
        aliases,
        allowContact: false,
      });
      if (verdict.verdict === 'block') {
        await enforce(ctx, { userId: profile.id, context: 'whisper', excerpt: body, roomId: room.id, isHost: room.hostId === profile.id }, verdict);
      }
    }
  }

  const [row] = await ctx.db
    .insert(messages)
    .values({
      threadId,
      senderId: profile.id,
      senderName: c.you.name,
      senderRole: c.you.role,
      body,
    })
    .returning();
  await ctx.db.update(threads).set({ lastMessageAt: row!.createdAt }).where(eq(threads.id, threadId));
  const message = toMessage(row!, new Map());
  ctx.hub.publish(threadChannel(threadId), { kind: 'message', message });
  ctx.hub.publish(userChannel(c.otherId), { kind: 'threads' });
  return message;
};

/** Whether this user may listen on a channel. Checked on every WebSocket subscribe. */
export const canSubscribe = async (ctx: Ctx, userId: string, channel: string): Promise<boolean> => {
  const [kind, id] = channel.split(':');
  if (!id) return false;
  try {
    if (kind === 'user') return id === userId;
    if (kind === 'room') {
      await roomAccess(ctx, id, userId);
      return true;
    }
    if (kind === 'thread') {
      await threadContext(ctx, id, userId);
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

import { and, desc, eq, sql } from 'drizzle-orm';
import type { HostProfile, HostStats, HostSummary, LeaderboardEntry, Review } from '@reomi/shared';
import {
  applications,
  follows,
  hostRatings,
  hostVerifications,
  reveals,
  rooms,
} from '../db/schema';
import { scanCommunityText } from '../lib/moderation';
import { AppError, conflict, forbidden, notFound } from '../lib/errors';
import type { Ctx } from './common';
import { iso, isRoomEnded } from './common';
import { enforce } from './moderation.service';

interface HostRow {
  userId: string;
  publicId: string;
  displayName: string;
  about: string;
  status: string;
  firstStart: Date | null;
  hosted: number;
  completed: number;
  participants: number;
  avg: number | null;
  n: number;
  sd: number | null;
  dist: number[];
  reveals: number;
  verified: number;
  followers: number;
  messages: number;
  strikes: number;
}

export interface HostRecord {
  summary: HostSummary;
  stats: HostStats;
  about: string;
}

/** Bayesian prior, so one five-star review does not outrank a long, consistent record. */
const PRIOR_MEAN = 4;
const PRIOR_WEIGHT = 5;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Ranks on several signals so that size alone never wins: rating (with a prior), the share of
 * participants who formed a confirmed connection, completed rooms, consistency, rule-keeping and
 * engagement. What a host paid for their plan plays no part.
 */
export const scoreHost = (
  row: Omit<
    HostRow,
    'userId' | 'publicId' | 'displayName' | 'about' | 'status' | 'firstStart' | 'dist' | 'followers'
  >,
) => {
  const bayes = (PRIOR_MEAN * PRIOR_WEIGHT + (row.avg ?? 0) * row.n) / (PRIOR_WEIGHT + row.n);
  const rating = clamp01((bayes - 1) / 4);
  const connectionRate = row.participants > 0 ? clamp01((row.verified / row.participants) * 4) : 0;
  const completed = clamp01(row.completed / 10);
  const consistency = row.n >= 2 && row.sd !== null ? clamp01(1 - row.sd / 2) : 0.5;
  const reliability = clamp01(1 - row.strikes * 0.25);
  const engagement = row.participants > 0 ? clamp01(row.messages / row.participants / 40) : 0;
  const score =
    40 * rating +
    25 * connectionRate +
    10 * completed +
    10 * consistency +
    10 * reliability +
    5 * engagement;
  return Math.round(score * 10) / 10;
};

let cache: { at: number; records: Map<string, HostRecord> } | null = null;
const CACHE_MS = 20_000;

export const invalidateHostCache = () => {
  cache = null;
};

const loadRows = async (ctx: Pick<Ctx, 'db'>): Promise<HostRow[]> => {
  const result = await ctx.db.execute<{
    user_id: string;
    public_id: string;
    display_name: string;
    about: string;
    status: string;
    first_start: string | null;
    hosted: number;
    completed: number;
    participants: number;
    avg: number | null;
    n: number;
    sd: number | null;
    s1: number;
    s2: number;
    s3: number;
    s4: number;
    s5: number;
    reveals: number;
    verified: number;
    followers: number;
    messages: number;
    strikes: number;
  }>(sql`
    with rm as (
      select host_id,
        count(*) filter (where starts_at is not null)::int as hosted,
        count(*) filter (where starts_at is not null and (status = 'closed' or ends_at <= now()))::int as completed,
        min(starts_at) as first_start
      from rooms group by host_id
    ),
    parts as (
      select r.host_id, count(*)::int as participants
      from applications a join rooms r on r.id = a.room_id
      where a.status in ('joined', 'left', 'removed')
      group by r.host_id
    ),
    rt as (
      select hr.host_id, avg(hr.stars)::float as avg, count(*)::int as n, stddev_pop(hr.stars)::float as sd,
        count(*) filter (where hr.stars = 1)::int as s1, count(*) filter (where hr.stars = 2)::int as s2,
        count(*) filter (where hr.stars = 3)::int as s3, count(*) filter (where hr.stars = 4)::int as s4,
        count(*) filter (where hr.stars = 5)::int as s5
      from host_ratings hr join rooms r on r.id = hr.room_id
      where r.status = 'closed' or r.ends_at <= now()
      group by hr.host_id
    ),
    cx as (
      select r.host_id, count(*)::int as reveals,
        count(*) filter (where rv.requester_confirmed_at is not null and rv.recipient_confirmed_at is not null)::int as verified
      from reveals rv join rooms r on r.id = rv.room_id
      where rv.status = 'accepted'
      group by r.host_id
    ),
    fl as (select followee_id, count(*)::int as followers from follows group by followee_id),
    mg as (
      select r.host_id, count(*)::int as messages
      from messages m join rooms r on r.id = m.room_id
      where m.sender_role = 'member'
      group by r.host_id
    ),
    st as (
      select user_id, count(*)::int as strikes from moderation_flags
      where severity = 'strong' and status <> 'dismissed' and created_at > now() - interval '90 days'
      group by user_id
    )
    select hv.user_id, hv.public_id, hv.display_name, hv.about, hv.status::text as status, rm.first_start,
      coalesce(rm.hosted, 0) as hosted, coalesce(rm.completed, 0) as completed,
      coalesce(parts.participants, 0) as participants,
      rt.avg, coalesce(rt.n, 0) as n, rt.sd,
      coalesce(rt.s1, 0) as s1, coalesce(rt.s2, 0) as s2, coalesce(rt.s3, 0) as s3,
      coalesce(rt.s4, 0) as s4, coalesce(rt.s5, 0) as s5,
      coalesce(cx.reveals, 0) as reveals, coalesce(cx.verified, 0) as verified,
      coalesce(fl.followers, 0) as followers, coalesce(mg.messages, 0) as messages,
      coalesce(st.strikes, 0) as strikes
    from host_verifications hv
    left join rm on rm.host_id = hv.user_id
    left join parts on parts.host_id = hv.user_id
    left join rt on rt.host_id = hv.user_id
    left join cx on cx.host_id = hv.user_id
    left join fl on fl.followee_id = hv.user_id
    left join mg on mg.host_id = hv.user_id
    left join st on st.user_id = hv.user_id
    where hv.status in ('verified', 'revoked') or rm.hosted > 0
  `);
  return [...result].map((row) => ({
    userId: row.user_id,
    publicId: row.public_id,
    displayName: row.display_name,
    about: row.about,
    status: row.status,
    firstStart: row.first_start ? new Date(row.first_start) : null,
    hosted: Number(row.hosted),
    completed: Number(row.completed),
    participants: Number(row.participants),
    avg: row.avg === null ? null : Number(row.avg),
    n: Number(row.n),
    sd: row.sd === null ? null : Number(row.sd),
    dist: [row.s1, row.s2, row.s3, row.s4, row.s5].map(Number),
    reveals: Number(row.reveals),
    verified: Number(row.verified),
    followers: Number(row.followers),
    messages: Number(row.messages),
    strikes: Number(row.strikes),
  }));
};

/** Every host's public record, ranked. Cached briefly because cards on Explore read it too. */
export const hostRecords = async (ctx: Pick<Ctx, 'db'>): Promise<Map<string, HostRecord>> => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.records;
  const rows = await loadRows(ctx);
  const scored = rows
    .map((row) => ({ row, score: scoreHost(row) }))
    .sort((a, b) => b.score - a.score || b.row.n - a.row.n);

  const rankable = scored.filter(({ row }) => row.hosted > 0 && row.status === 'verified');
  const ranks = new Map(rankable.map(({ row }, index) => [row.userId, index + 1]));

  const records = new Map<string, HostRecord>();
  for (const { row, score } of scored) {
    const rank = ranks.get(row.userId) ?? null;
    const bayes = (PRIOR_MEAN * PRIOR_WEIGHT + (row.avg ?? 0) * row.n) / (PRIOR_WEIGHT + row.n);
    const badges: HostSummary['badges'] = [];
    if (row.status === 'verified') badges.push('verified');
    if (rank !== null && rank <= 10 && row.n >= 3) badges.push('top_host');
    if (row.completed >= 5 && row.n >= 20 && bayes >= 4.5 && row.verified >= 10)
      badges.push('celebrity');
    if (
      row.firstStart &&
      Date.now() - row.firstStart.getTime() < 60 * 86_400_000 &&
      row.n >= 3 &&
      (row.avg ?? 0) >= 4.3
    ) {
      badges.push('rising');
    }
    const rating = row.avg === null ? null : Math.round(row.avg * 10) / 10;
    records.set(row.userId, {
      about: row.about,
      summary: {
        id: row.publicId,
        displayName: row.displayName,
        roomsHosted: row.hosted,
        rating,
        ratingCount: row.n,
        verifiedConnections: row.verified,
        badges,
      },
      stats: {
        roomsHosted: row.hosted,
        roomsCompleted: row.completed,
        participantsServed: row.participants,
        rating,
        ratingCount: row.n,
        ratingDistribution: row.dist,
        verifiedConnections: row.verified,
        revealsFacilitated: row.reveals,
        followers: row.followers,
        score,
        rank,
      },
    });
  }
  cache = { at: Date.now(), records };
  return records;
};

export const fallbackSummary = (publicId: string, displayName: string): HostSummary => ({
  id: publicId,
  displayName,
  roomsHosted: 0,
  rating: null,
  ratingCount: 0,
  verifiedConnections: 0,
  badges: [],
});

export const leaderboard = async (ctx: Ctx): Promise<LeaderboardEntry[]> => {
  const records = await hostRecords(ctx);
  return [...records.values()]
    .filter((record) => record.stats.rank !== null)
    .sort((a, b) => a.stats.rank! - b.stats.rank!)
    .slice(0, 50)
    .map((record) => ({ rank: record.stats.rank!, host: record.summary, stats: record.stats }));
};

export const recentReviews = async (ctx: Ctx, hostId: string): Promise<Review[]> => {
  const rows = await ctx.db
    .select({ rating: hostRatings, roomTitle: rooms.title })
    .from(hostRatings)
    .innerJoin(rooms, eq(rooms.id, hostRatings.roomId))
    .where(
      and(
        eq(hostRatings.hostId, hostId),
        sql`(${rooms.status} = 'closed' or ${rooms.endsAt} <= now())`,
        sql`length(${hostRatings.comment}) > 0`,
      ),
    )
    .orderBy(desc(hostRatings.createdAt))
    .limit(12);
  return rows.map(({ rating, roomTitle }) => ({
    stars: rating.stars,
    comment: rating.comment,
    roomTitle,
    createdAt: iso(rating.createdAt),
  }));
};

export const resolveHost = async (ctx: Pick<Ctx, 'db'>, publicId: string) => {
  const [verification] = await ctx.db
    .select()
    .from(hostVerifications)
    .where(eq(hostVerifications.publicId, publicId));
  if (!verification) throw notFound('Host');
  return verification;
};

export const hostProfileBase = async (
  ctx: Ctx,
  publicId: string,
  viewerId: string | undefined,
): Promise<Omit<HostProfile, 'live' | 'upcoming'>> => {
  const verification = await resolveHost(ctx, publicId);
  const hostId = verification.userId;
  const records = await hostRecords(ctx);
  const record = records.get(hostId);

  const [past, reviews, following] = await Promise.all([
    ctx.db
      .select({
        id: rooms.id,
        title: rooms.title,
        endsAt: rooms.endsAt,
        participants: sql<number>`(select count(*)::int from applications a
          where a.room_id = rooms.id and a.status in ('joined', 'left', 'removed'))`,
      })
      .from(rooms)
      .where(
        and(
          eq(rooms.hostId, hostId),
          sql`${rooms.startsAt} is not null and (${rooms.status} = 'closed' or ${rooms.endsAt} <= now())`,
          eq(rooms.visibility, 'public'),
        ),
      )
      .orderBy(desc(rooms.endsAt))
      .limit(10),
    recentReviews(ctx, hostId),
    viewerId
      ? ctx.db
          .select()
          .from(follows)
          .where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, hostId)))
      : Promise.resolve([]),
  ]);

  return {
    host: record?.summary ?? fallbackSummary(verification.publicId, verification.displayName),
    about: verification.about,
    stats: record?.stats ?? {
      roomsHosted: 0,
      roomsCompleted: 0,
      participantsServed: 0,
      rating: null,
      ratingCount: 0,
      ratingDistribution: [0, 0, 0, 0, 0],
      verifiedConnections: 0,
      revealsFacilitated: 0,
      followers: 0,
      score: 0,
      rank: null,
    },
    past: past.map((room) => ({
      id: room.id,
      title: room.title,
      endedAt: iso(room.endsAt!),
      participants: room.participants,
    })),
    reviews,
    isFollowing: following.length > 0,
    isYou: viewerId === hostId,
  };
};

/* Ratings ------------------------------------------------------------------------------------ */

export const rateHost = async (
  ctx: Ctx,
  input: { roomId: string; userId: string; stars: number; comment: string },
) => {
  const [row] = await ctx.db
    .select({ room: rooms, application: applications })
    .from(rooms)
    .innerJoin(
      applications,
      and(eq(applications.roomId, rooms.id), eq(applications.userId, input.userId)),
    )
    .where(eq(rooms.id, input.roomId));
  // Only paying members rate, which is what keeps reviews from being bought or faked.
  if (!row || !['joined', 'left'].includes(row.application.status)) {
    throw forbidden('not_a_member', 'Only members of this room can rate its host');
  }
  if (!isRoomEnded(row.room)) {
    throw conflict('room_not_ended', 'You can rate the host once the room has ended');
  }
  if (input.comment) {
    const verdict = scanCommunityText(input.comment);
    if (verdict.verdict === 'block') {
      await enforce(
        ctx,
        { userId: input.userId, context: 'rating', excerpt: input.comment, roomId: input.roomId },
        verdict,
      );
    }
  }
  const inserted = await ctx.db
    .insert(hostRatings)
    .values({
      roomId: input.roomId,
      hostId: row.room.hostId,
      userId: input.userId,
      stars: input.stars,
      comment: input.comment,
    })
    .onConflictDoNothing()
    .returning({ id: hostRatings.id });
  if (inserted.length === 0) throw conflict('already_rated', 'You already rated this room');
  invalidateHostCache();
};

/* Following ---------------------------------------------------------------------------------- */

export const canFollow = async (ctx: Ctx, followerId: string, followeeId: string) => {
  if (followerId === followeeId) return false;
  const [host] = await ctx.db
    .select({ id: hostVerifications.userId })
    .from(hostVerifications)
    .where(and(eq(hostVerifications.userId, followeeId), eq(hostVerifications.status, 'verified')));
  if (host) return true;
  const [connection] = await ctx.db
    .select({ id: reveals.id })
    .from(reveals)
    .where(
      and(
        eq(reveals.status, 'accepted'),
        sql`((${reveals.requesterId} = ${followerId} and ${reveals.recipientId} = ${followeeId})
          or (${reveals.requesterId} = ${followeeId} and ${reveals.recipientId} = ${followerId}))`,
      ),
    )
    .limit(1);
  return Boolean(connection);
};

export const follow = async (ctx: Ctx, followerId: string, followeeId: string) => {
  if (!(await canFollow(ctx, followerId, followeeId))) {
    throw new AppError(403, 'forbidden', 'You can follow hosts and people you have revealed to');
  }
  await ctx.db.insert(follows).values({ followerId, followeeId }).onConflictDoNothing();
  invalidateHostCache();
};

export const followHost = async (ctx: Ctx, followerId: string, publicId: string, on: boolean) => {
  const host = await resolveHost(ctx, publicId);
  if (on) await follow(ctx, followerId, host.userId);
  else await unfollow(ctx, followerId, host.userId);
};

export const unfollow = async (ctx: Ctx, followerId: string, followeeId: string) => {
  await ctx.db
    .delete(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)));
  invalidateHostCache();
};

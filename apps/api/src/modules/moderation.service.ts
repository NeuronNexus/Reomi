import { and, count, desc, eq, gte, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { adminFlagQuery, AdminFlag, BlockedMessageDetails } from '@reomi/shared';
import {
  adminAuditLog,
  applications,
  communities,
  communityMembers,
  moderationFlags,
  profiles,
  rooms,
} from '../db/schema';
import { AppError, notFound } from '../lib/errors';
import type { Verdict } from '../lib/moderation';
import { roomChannel } from '../lib/realtime';
import type { Ctx } from './common';
import { iso, pageOffset } from './common';
import { notify } from './notify.service';

const STRIKE_WINDOW_DAYS = 30;

export const strikesFor = async (ctx: Pick<Ctx, 'db'>, userId: string): Promise<number> => {
  const [row] = await ctx.db
    .select({ value: count() })
    .from(moderationFlags)
    .where(
      and(
        eq(moderationFlags.userId, userId),
        eq(moderationFlags.severity, 'strong'),
        ne(moderationFlags.status, 'dismissed'),
        gte(moderationFlags.createdAt, new Date(Date.now() - STRIKE_WINDOW_DAYS * 86_400_000)),
      ),
    );
  return row?.value ?? 0;
};

interface Incident {
  userId: string;
  context: 'room' | 'whisper' | 'activity' | 'post' | 'comment' | 'rating';
  excerpt: string;
  roomId?: string | null;
  communityId?: string | null;
  /** Hosts cannot be removed from their own room, so that rung becomes a longer mute. */
  isHost?: boolean;
}

/**
 * Records a blocked message and applies the escalation ladder, identically for members, paying
 * members and hosts: a warning, then a 24 hour mute, then removal from the room (a week's mute
 * for hosts), then suspension pending review. Only strong flags climb the ladder.
 */
export const enforce = async (
  ctx: Ctx,
  incident: Incident,
  verdict: Extract<Verdict, { verdict: 'block' }>,
): Promise<never> => {
  await ctx.db.insert(moderationFlags).values({
    userId: incident.userId,
    roomId: incident.roomId ?? null,
    communityId: incident.communityId ?? null,
    context: incident.context,
    reason: verdict.reason,
    severity: verdict.severity,
    excerpt: incident.excerpt.slice(0, 1000),
  });

  let action: BlockedMessageDetails['action'] = 'none';
  const strikes = verdict.severity === 'strong' ? await strikesFor(ctx, incident.userId) : 0;
  const code = incident.context === 'post' || incident.context === 'comment' ? 'content_blocked' : 'message_blocked';

  if (verdict.severity === 'strong') {
    if (strikes <= 1) {
      action = 'warning';
      await notify(ctx, [incident.userId], {
        kind: 'moderation',
        title: 'Warning: a message was blocked',
        body: 'Exposing or attacking other people is not allowed. Further strikes lead to mutes, removal and suspension.',
      });
    } else if (strikes === 2) {
      action = 'muted';
      await ctx.db
        .update(profiles)
        .set({ mutedUntil: new Date(Date.now() + 24 * 3_600_000) })
        .where(eq(profiles.id, incident.userId));
      await notify(ctx, [incident.userId], {
        kind: 'moderation',
        title: 'You are muted for 24 hours',
        body: 'This is your second strike in 30 days.',
      });
    } else if (strikes === 3) {
      if (incident.roomId && !incident.isHost) {
        action = 'removed';
        await ctx.db
          .update(applications)
          .set({ status: 'removed' })
          .where(
            and(
              eq(applications.roomId, incident.roomId),
              eq(applications.userId, incident.userId),
              eq(applications.status, 'joined'),
            ),
          );
        ctx.hub.publish(roomChannel(incident.roomId), { kind: 'members' });
      } else if (incident.communityId) {
        action = 'removed';
        await ctx.db
          .update(communityMembers)
          .set({ status: 'banned' })
          .where(
            and(
              eq(communityMembers.communityId, incident.communityId),
              eq(communityMembers.userId, incident.userId),
              ne(communityMembers.role, 'owner'),
            ),
          );
      } else {
        action = 'muted';
      }
      await ctx.db
        .update(profiles)
        .set({ mutedUntil: new Date(Date.now() + 7 * 86_400_000) })
        .where(eq(profiles.id, incident.userId));
      await notify(ctx, [incident.userId], {
        kind: 'moderation',
        title: action === 'removed' ? 'You were removed and muted for a week' : 'You are muted for a week',
        body: 'This is your third strike in 30 days. One more suspends your account.',
      });
    } else {
      action = 'suspended';
      await ctx.db
        .update(profiles)
        .set({ status: 'suspended' })
        .where(eq(profiles.id, incident.userId));
    }
  }

  throw new AppError(422, code, verdict.message, {
    reason: verdict.reason,
    severity: verdict.severity,
    strikes,
    action,
  } satisfies BlockedMessageDetails);
};

/** Throws `muted` while a temporary restriction is in force. */
export const assertNotMuted = (profile: { mutedUntil: Date | null }) => {
  if (profile.mutedUntil && profile.mutedUntil > new Date()) {
    throw new AppError(
      403,
      'muted',
      `You are muted until ${profile.mutedUntil.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    );
  }
};

export const report = async (
  ctx: Ctx,
  input: { reporterId: string; userId: string; excerpt: string; context: string; roomId?: string | null; communityId?: string | null; reason: string },
) => {
  await ctx.db.insert(moderationFlags).values({
    userId: input.userId,
    reporterId: input.reporterId,
    roomId: input.roomId ?? null,
    communityId: input.communityId ?? null,
    context: input.context,
    reason: 'user_report',
    severity: 'report',
    excerpt: `${input.excerpt.slice(0, 800)}\n\nReport: ${input.reason}`,
  });
};

/* Admin ----------------------------------------------------------------------------------- */

export const listFlags = async (ctx: Ctx, query: z.infer<typeof adminFlagQuery>) => {
  const reporter = sql<string | null>`(select p.email from profiles p where p.id = ${moderationFlags.reporterId})`;
  const where = and(
    query.status ? eq(moderationFlags.status, query.status) : undefined,
    query.severity ? eq(moderationFlags.severity, query.severity) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        flag: moderationFlags,
        email: profiles.email,
        name: profiles.fullName,
        userStatus: profiles.status,
        roomTitle: rooms.title,
        communityName: communities.name,
        reporter,
      })
      .from(moderationFlags)
      .innerJoin(profiles, eq(profiles.id, moderationFlags.userId))
      .leftJoin(rooms, eq(rooms.id, moderationFlags.roomId))
      .leftJoin(communities, eq(communities.id, moderationFlags.communityId))
      .where(where)
      .orderBy(desc(moderationFlags.createdAt))
      .limit(query.pageSize)
      .offset(pageOffset(query)),
    ctx.db.select({ value: count() }).from(moderationFlags).where(where),
  ]);

  const strikeCounts = new Map<string, number>();
  for (const row of rows) {
    if (!strikeCounts.has(row.flag.userId)) {
      strikeCounts.set(row.flag.userId, await strikesFor(ctx, row.flag.userId));
    }
  }

  return {
    items: rows.map(
      (row): AdminFlag => ({
        id: row.flag.id,
        userId: row.flag.userId,
        userEmail: row.email,
        userName: row.name,
        userStatus: row.userStatus,
        context: row.flag.context,
        reason: row.flag.reason,
        severity: row.flag.severity,
        status: row.flag.status,
        excerpt: row.flag.excerpt,
        where: row.roomTitle ? `Room: ${row.roomTitle}` : row.communityName ? `Community: ${row.communityName}` : null,
        reporterEmail: row.reporter,
        strikes: strikeCounts.get(row.flag.userId) ?? 0,
        createdAt: iso(row.flag.createdAt),
      }),
    ),
    total: total?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export const reviewFlag = async (
  ctx: Ctx,
  adminId: string,
  flagId: string,
  input: { status: 'dismissed' | 'actioned'; suspendUser: boolean },
) => {
  const [flag] = await ctx.db
    .update(moderationFlags)
    .set({ status: input.status, reviewedBy: adminId, reviewedAt: new Date() })
    .where(eq(moderationFlags.id, flagId))
    .returning();
  if (!flag) throw notFound('Flag');
  if (input.suspendUser) {
    await ctx.db.update(profiles).set({ status: 'suspended' }).where(eq(profiles.id, flag.userId));
  }
  await ctx.db.insert(adminAuditLog).values({
    adminId,
    action: `flag.${input.status}`,
    entityType: 'moderation_flag',
    entityId: flag.id,
    details: { suspendUser: input.suspendUser },
  });
};

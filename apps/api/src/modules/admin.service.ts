import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  adminFeatureInput,
  adminFeaturePatch,
  adminHostDecision,
  adminHostQuery,
  AdminPlan,
  adminPaymentQuery,
  adminPlanInput,
  adminPlanPatch,
  adminRoomPatch,
  adminRoomQuery,
  AdminStats,
  adminUserQuery,
} from '@reomi/shared';
import type { Db, Tx } from '../db/client';
import {
  adminAuditLog,
  features,
  hostVerifications,
  payments,
  planFeatures,
  plans,
  profiles,
  rooms,
} from '../db/schema';
import { AppError, conflict, forbidden, isUniqueViolation, notFound } from '../lib/errors';
import {
  applicationCountSql,
  iso,
  isoOrNull,
  isRoomLive,
  likeTerm,
  pageOffset,
  roomLiveSql,
  roomsHostedSql,
  seatsTakenSql,
} from './common';

const audit = (
  tx: Tx | Db,
  adminId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
) => tx.insert(adminAuditLog).values({ adminId, action, entityType, entityId, details });

const page = <T>(items: T[], total: number, query: { page: number; pageSize: number }) => ({
  items,
  total,
  page: query.page,
  pageSize: query.pageSize,
});

const countWhere = (condition: SQL) => sql<number>`count(*) filter (where ${condition})::int`;
const sumWhere = (column: SQL, condition: SQL) =>
  sql<number>`coalesce(sum(${column}) filter (where ${condition}), 0)::bigint`.mapWith(Number);

export const getStats = async (db: Db): Promise<AdminStats> => {
  const [[users], [hosts], [roomTotals], [money]] = await Promise.all([
    db
      .select({
        total: count(),
        active24h: countWhere(sql`${profiles.lastSeenAt} > now() - interval '24 hours'`),
        active30d: countWhere(sql`${profiles.lastSeenAt} > now() - interval '30 days'`),
        suspended: countWhere(sql`${profiles.status} = 'suspended'`),
      })
      .from(profiles),
    db
      .select({
        verified: countWhere(sql`${hostVerifications.status} = 'verified'`),
        pending: countWhere(sql`${hostVerifications.status} = 'pending'`),
      })
      .from(hostVerifications),
    db.select({ total: count(), live: countWhere(roomLiveSql) }).from(rooms),
    db
      .select({
        hostPlanPaise: sumWhere(
          sql`${payments.amountPaise}`,
          sql`${payments.status} = 'paid' and ${payments.purpose} = 'host_plan'`,
        ),
        ticketGrossPaise: sumWhere(
          sql`${payments.amountPaise}`,
          sql`${payments.status} = 'paid' and ${payments.purpose} = 'room_ticket'`,
        ),
        platformFeePaise: sumWhere(
          sql`${payments.platformFeePaise}`,
          sql`${payments.status} = 'paid'`,
        ),
        hostLiabilityPaise: sumWhere(
          sql`${payments.hostEarningPaise}`,
          sql`${payments.status} = 'paid'`,
        ),
        refundsDuePaise: sumWhere(
          sql`${payments.amountPaise}`,
          sql`${payments.status} = 'refund_required'`,
        ),
      })
      .from(payments),
  ]);

  const activity = await db.execute<{
    messages24h: number;
    reveals: number;
    verified: number;
    communities: number;
    posts24h: number;
    open_flags: number;
  }>(sql`select
    (select count(*)::int from messages where created_at > now() - interval '24 hours') as "messages24h",
    (select count(*)::int from reveals where status = 'accepted') as reveals,
    (select count(*)::int from reveals where status = 'accepted' and requester_confirmed_at is not null
      and recipient_confirmed_at is not null) as verified,
    (select count(*)::int from communities) as communities,
    (select count(*)::int from posts where created_at > now() - interval '24 hours') as "posts24h",
    (select count(*)::int from moderation_flags where status = 'open') as open_flags`);
  const a = [...activity][0]!;

  return {
    users: users!,
    hosts: hosts!,
    rooms: roomTotals!,
    revenue: money!,
    activity: {
      messages24h: Number(a.messages24h),
      reveals: Number(a.reveals),
      verifiedConnections: Number(a.verified),
      communities: Number(a.communities),
      posts24h: Number(a.posts24h),
      openFlags: Number(a.open_flags),
    },
  };
};

export const listUsers = async (db: Db, query: z.infer<typeof adminUserQuery>) => {
  const where = and(
    query.status ? eq(profiles.status, query.status) : undefined,
    query.q
      ? or(ilike(profiles.email, likeTerm(query.q)), ilike(profiles.fullName, likeTerm(query.q)))
      : undefined,
    query.activeWithinDays
      ? gte(profiles.lastSeenAt, new Date(Date.now() - query.activeWithinDays * 86_400_000))
      : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        profile: profiles,
        hostStatus: hostVerifications.status,
        strikes: sql<number>`(select count(*)::int from moderation_flags f where f.user_id = ${profiles.id}
          and f.severity = 'strong' and f.status <> 'dismissed'
          and f.created_at > now() - interval '30 days')`,
      })
      .from(profiles)
      .leftJoin(hostVerifications, eq(hostVerifications.userId, profiles.id))
      .where(where)
      .orderBy(sql`${profiles.lastSeenAt} desc nulls last`, asc(profiles.id))
      .limit(query.pageSize)
      .offset(pageOffset(query)),
    db.select({ total: count() }).from(profiles).where(where),
  ]);

  return page(
    rows.map(({ profile, hostStatus, strikes }) => ({
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      role: profile.role,
      status: profile.status,
      hostStatus,
      strikes,
      lastSeenAt: isoOrNull(profile.lastSeenAt),
      createdAt: iso(profile.createdAt),
    })),
    totals[0]?.total ?? 0,
    query,
  );
};

export const setUserStatus = async (
  db: Db,
  adminId: string,
  userId: string,
  status: 'active' | 'suspended',
) => {
  if (adminId === userId) throw forbidden('forbidden', 'You cannot change your own status');
  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(profiles).where(eq(profiles.id, userId)).for('update');
    if (!target) throw notFound('User');
    if (target.role === 'admin') throw forbidden('forbidden', 'Admins cannot be suspended here');
    await tx.update(profiles).set({ status }).where(eq(profiles.id, userId));
    await audit(tx, adminId, 'user.status', 'profile', userId, {
      from: target.status,
      to: status,
    });
  });
};

export const listHosts = async (db: Db, query: z.infer<typeof adminHostQuery>) => {
  const where = and(
    query.status ? eq(hostVerifications.status, query.status) : undefined,
    query.q
      ? or(
          ilike(hostVerifications.displayName, likeTerm(query.q)),
          ilike(profiles.email, likeTerm(query.q)),
        )
      : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        host: hostVerifications,
        email: profiles.email,
        fullName: profiles.fullName,
        roomsHosted: roomsHostedSql(hostVerifications.userId),
        liveRooms: sql<number>`(
          select count(*)::int from rooms r
          where r.host_id = ${hostVerifications.userId}
            and r.status = 'open' and r.ends_at > now()
        )`,
      })
      .from(hostVerifications)
      .innerJoin(profiles, eq(profiles.id, hostVerifications.userId))
      .where(where)
      .orderBy(
        sql`case ${hostVerifications.status} when 'pending' then 0 else 1 end`,
        desc(hostVerifications.createdAt),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query)),
    db
      .select({ total: count() })
      .from(hostVerifications)
      .innerJoin(profiles, eq(profiles.id, hostVerifications.userId))
      .where(where),
  ]);

  return page(
    rows.map(({ host, email, fullName, roomsHosted, liveRooms }) => ({
      userId: host.userId,
      email,
      fullName,
      displayName: host.displayName,
      about: host.about,
      status: host.status,
      reviewNote: host.reviewNote,
      reviewedAt: isoOrNull(host.reviewedAt),
      roomsHosted,
      liveRooms,
      createdAt: iso(host.createdAt),
    })),
    totals[0]?.total ?? 0,
    query,
  );
};

export const decideHost = async (
  db: Db,
  adminId: string,
  userId: string,
  input: z.infer<typeof adminHostDecision>,
) => {
  await db.transaction(async (tx) => {
    const [host] = await tx
      .select()
      .from(hostVerifications)
      .where(eq(hostVerifications.userId, userId))
      .for('update');
    if (!host) throw notFound('Host application');

    await tx
      .update(hostVerifications)
      .set({
        status: input.status,
        reviewNote: input.reviewNote ?? null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      })
      .where(eq(hostVerifications.userId, userId));
    await audit(tx, adminId, 'host.decision', 'host_verification', userId, {
      from: host.status,
      to: input.status,
      note: input.reviewNote,
    });
  });
};

const adminRoomSelection = {
  room: rooms,
  planName: plans.name,
  hostDisplayName: hostVerifications.displayName,
  hostEmail: profiles.email,
  seatsTaken: seatsTakenSql(rooms.id),
  pendingApplications: applicationCountSql(rooms.id, 'pending'),
};

export const listRooms = async (db: Db, query: z.infer<typeof adminRoomQuery>) => {
  const where = and(
    query.status ? eq(rooms.status, query.status) : undefined,
    query.q
      ? or(
          ilike(rooms.title, likeTerm(query.q)),
          ilike(hostVerifications.displayName, likeTerm(query.q)),
        )
      : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select(adminRoomSelection)
      .from(rooms)
      .innerJoin(plans, eq(plans.id, rooms.planId))
      .innerJoin(profiles, eq(profiles.id, rooms.hostId))
      .innerJoin(hostVerifications, eq(hostVerifications.userId, rooms.hostId))
      .where(where)
      .orderBy(desc(rooms.createdAt))
      .limit(query.pageSize)
      .offset(pageOffset(query)),
    db
      .select({ total: count() })
      .from(rooms)
      .innerJoin(hostVerifications, eq(hostVerifications.userId, rooms.hostId))
      .where(where),
  ]);

  return page(
    rows.map(({ room, planName, hostDisplayName, hostEmail, seatsTaken, pendingApplications }) => ({
      id: room.id,
      title: room.title,
      category: room.category,
      status: room.status,
      visibility: room.visibility,
      live: isRoomLive(room),
      hostDisplayName,
      hostEmail,
      planId: room.planId,
      planName,
      ticketPricePaise: room.ticketPricePaise,
      capacity: room.capacity,
      durationDays: room.durationDays,
      seatsTaken,
      pendingApplications,
      entitlements: room.entitlements,
      startsAt: isoOrNull(room.startsAt),
      endsAt: isoOrNull(room.endsAt),
      createdAt: iso(room.createdAt),
    })),
    totals[0]?.total ?? 0,
    query,
  );
};

export const updateRoom = async (
  db: Db,
  adminId: string,
  roomId: string,
  input: z.infer<typeof adminRoomPatch>,
) => {
  await db.transaction(async (tx) => {
    const [room] = await tx.select().from(rooms).where(eq(rooms.id, roomId)).for('update');
    if (!room) throw notFound('Room');
    const changes: Partial<typeof rooms.$inferInsert> = {};

    if (input.planId && input.planId !== room.planId) {
      if (!room.startsAt) {
        throw conflict('conflict', 'A room awaiting its first payment cannot change plan');
      }
      const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId));
      if (!plan) throw notFound('Plan');

      const [seats] = await tx
        .select({ taken: seatsTakenSql(room.id) })
        .from(rooms)
        .where(eq(rooms.id, room.id));
      if (plan.capacity < (seats?.taken ?? 0)) {
        throw conflict(
          'capacity_below_seats_taken',
          `${seats?.taken} seats are taken, more than this plan allows`,
        );
      }
      const entitled = await tx
        .select({ key: planFeatures.featureKey })
        .from(planFeatures)
        .where(eq(planFeatures.planId, plan.id));

      Object.assign(changes, {
        planId: plan.id,
        capacity: plan.capacity,
        durationDays: plan.durationDays,
        platformFeeBps: plan.platformFeeBps,
        entitlements: entitled.map(({ key }) => key),
        endsAt: new Date(room.startsAt.getTime() + plan.durationDays * 86_400_000),
      });
    }

    if (input.status && input.status !== room.status) {
      if (input.status === 'open' && !room.startsAt) {
        throw conflict('conflict', 'This room has not been paid for');
      }
      changes.status = input.status;
    }

    if (Object.keys(changes).length === 0) return;
    await tx.update(rooms).set(changes).where(eq(rooms.id, roomId));
    await audit(tx, adminId, 'room.update', 'room', roomId, {
      planId: changes.planId,
      status: changes.status,
    });
  });
};

export const listAdminPlans = async (db: Db): Promise<AdminPlan[]> => {
  const [planRows, featureRows, links] = await Promise.all([
    db
      .select({
        plan: plans,
        // Written out because Drizzle drops the table prefix on single-table selects, which would
        // make this compare r.plan_id with r.id.
        roomCount: sql<number>`(select count(*)::int from rooms r where r.plan_id = plans.id)`,
      })
      .from(plans)
      .orderBy(asc(plans.sortOrder)),
    db.select().from(features).orderBy(asc(features.sortOrder)),
    db.select().from(planFeatures),
  ]);

  return planRows.map(({ plan, roomCount }) => ({
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    pricePaise: plan.pricePaise,
    durationDays: plan.durationDays,
    capacity: plan.capacity,
    platformFeeBps: plan.platformFeeBps,
    referenceTicketPaise: plan.referenceTicketPaise,
    ticketCapBps: plan.ticketCapBps,
    maxTicketPaise: Math.floor((plan.referenceTicketPaise * (10_000 + plan.ticketCapBps)) / 10_000),
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    roomCount,
    features: featureRows
      .filter((feature) =>
        links.some((link) => link.planId === plan.id && link.featureKey === feature.key),
      )
      .map(toFeature),
  }));
};

export const toFeature = (feature: typeof features.$inferSelect) => ({
  key: feature.key,
  name: feature.name,
  description: feature.description,
  isLive: feature.isLive,
  sortOrder: feature.sortOrder,
});

export const createPlan = async (
  db: Db,
  adminId: string,
  input: z.infer<typeof adminPlanInput>,
) => {
  try {
    await db.transaction(async (tx) => {
      const [plan] = await tx.insert(plans).values(input).returning({ id: plans.id });
      await audit(tx, adminId, 'plan.create', 'plan', plan!.id, input);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('conflict', 'A plan with that slug exists');
    throw error;
  }
};

export const updatePlan = async (
  db: Db,
  adminId: string,
  planId: string,
  input: z.infer<typeof adminPlanPatch>,
) => {
  try {
    await db.transaction(async (tx) => {
      const [plan] = await tx
        .update(plans)
        .set(input)
        .where(eq(plans.id, planId))
        .returning({ id: plans.id });
      if (!plan) throw notFound('Plan');
      await audit(tx, adminId, 'plan.update', 'plan', planId, input);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('conflict', 'A plan with that slug exists');
    throw error;
  }
};

export const setPlanFeatures = async (
  db: Db,
  adminId: string,
  planId: string,
  featureKeys: string[],
) => {
  await db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, planId)).for('update');
    if (!plan) throw notFound('Plan');

    const unique = [...new Set(featureKeys)];
    if (unique.length > 0) {
      const known = await tx
        .select({ key: features.key })
        .from(features)
        .where(inArray(features.key, unique));
      if (known.length !== unique.length) {
        throw new AppError(400, 'bad_request', 'Unknown feature key');
      }
    }

    await tx.delete(planFeatures).where(eq(planFeatures.planId, planId));
    if (unique.length > 0) {
      await tx.insert(planFeatures).values(unique.map((featureKey) => ({ planId, featureKey })));
    }
    await audit(tx, adminId, 'plan.features', 'plan', planId, { featureKeys: unique });
  });
};

export const listFeatures = async (db: Db) =>
  (await db.select().from(features).orderBy(asc(features.sortOrder))).map(toFeature);

export const createFeature = async (
  db: Db,
  adminId: string,
  input: z.infer<typeof adminFeatureInput>,
) => {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(features).values(input);
      await audit(tx, adminId, 'feature.create', 'feature', input.key, input);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('conflict', 'That feature key exists');
    throw error;
  }
};

export const updateFeature = async (
  db: Db,
  adminId: string,
  key: string,
  input: z.infer<typeof adminFeaturePatch>,
) => {
  await db.transaction(async (tx) => {
    const [feature] = await tx
      .update(features)
      .set(input)
      .where(eq(features.key, key))
      .returning({ key: features.key });
    if (!feature) throw notFound('Feature');
    await audit(tx, adminId, 'feature.update', 'feature', key, input);
  });
};

export const listPayments = async (db: Db, query: z.infer<typeof adminPaymentQuery>) => {
  const where = and(
    query.status ? eq(payments.status, query.status) : undefined,
    query.purpose ? eq(payments.purpose, query.purpose) : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select({ payment: payments, userEmail: profiles.email, roomTitle: rooms.title })
      .from(payments)
      .innerJoin(profiles, eq(profiles.id, payments.userId))
      .innerJoin(rooms, eq(rooms.id, payments.roomId))
      .where(where)
      .orderBy(desc(payments.createdAt))
      .limit(query.pageSize)
      .offset(pageOffset(query)),
    db.select({ total: count() }).from(payments).where(where),
  ]);

  return page(
    rows.map(({ payment, userEmail, roomTitle }) => ({
      id: payment.id,
      purpose: payment.purpose,
      status: payment.status,
      provider: payment.provider,
      providerOrderId: payment.providerOrderId,
      providerPaymentId: payment.providerPaymentId,
      amountPaise: payment.amountPaise,
      platformFeePaise: payment.platformFeePaise,
      hostEarningPaise: payment.hostEarningPaise,
      userEmail,
      roomId: payment.roomId,
      roomTitle,
      paidAt: isoOrNull(payment.paidAt),
      createdAt: iso(payment.createdAt),
    })),
    totals[0]?.total ?? 0,
    query,
  );
};

/** Records a refund already issued in the provider's dashboard. Moves no money itself. */
export const markRefunded = async (db: Db, adminId: string, paymentId: string) => {
  await db.transaction(async (tx) => {
    const [payment] = await tx
      .update(payments)
      .set({ status: 'refunded' })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'refund_required')))
      .returning({ id: payments.id });
    if (!payment) throw conflict('conflict', 'This payment is not awaiting a refund');
    await audit(tx, adminId, 'payment.refunded', 'payment', paymentId);
  });
};

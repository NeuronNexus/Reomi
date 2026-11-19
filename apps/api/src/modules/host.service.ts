import { and, asc, avg, count, desc, eq, inArray, sql, sum } from 'drizzle-orm';
import type { z } from 'zod';
import { ACTIVITY_FEATURE, ACTIVITY_KINDS, FEATURE, formatPaise } from '@reomi/shared';
import type {
  Applicant,
  CreateRoomInput,
  HostApplicationInput,
  HostRoom,
  HostRoomDashboard,
  paginationQuery,
} from '@reomi/shared';
import {
  applications,
  hostRatings,
  hostVerifications,
  payments,
  planFeatures,
  plans,
  profiles,
  reveals,
  roomWaitlist,
  rooms,
} from '../db/schema';
import { isHealthy, pressure } from '../lib/balance';
import { AppError, conflict, forbidden, isUniqueViolation, notFound } from '../lib/errors';
import { roomChannel } from '../lib/realtime';
import type { AuthContext } from '../plugins/auth';
import { assessCandidate, seatHolders } from './balance.service';
import type { Ctx } from './common';
import {
  applicationCountSql,
  iso,
  isoOrNull,
  isRoomLive,
  isRoomUpcoming,
  pageOffset,
  seatsTakenSql,
  viewStatus,
} from './common';
import { invalidateHostCache } from './hosts.service';
import { notify } from './notify.service';
import { openPlanCheckout } from './payments.service';
import { acceptInto } from './rooms.service';

export const submitHostApplication = async (
  ctx: Pick<Ctx, 'db'>,
  auth: AuthContext,
  input: HostApplicationInput,
) => {
  const current = auth.host?.status;
  if (current === 'pending' || current === 'verified') {
    throw conflict('host_application_exists', 'You already have a host application');
  }
  if (current === 'revoked') {
    throw forbidden('forbidden', 'Your host access was revoked. Contact support.');
  }

  try {
    await ctx.db
      .insert(hostVerifications)
      .values({ userId: auth.profile.id, ...input })
      .onConflictDoUpdate({
        target: hostVerifications.userId,
        set: { ...input, status: 'pending', reviewNote: null, reviewedAt: null, reviewedBy: null },
      });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('host_name_taken', 'That host name is taken');
    throw error;
  }
};

const hostRoomSelection = {
  room: rooms,
  planName: plans.name,
  pending: applicationCountSql(rooms.id, 'pending'),
  joined: applicationCountSql(rooms.id, 'joined'),
  seatsTaken: seatsTakenSql(rooms.id),
};

type HostRoomRow = {
  room: typeof rooms.$inferSelect;
  planName: string;
  pending: number;
  joined: number;
  seatsTaken: number;
};

const toHostRoom = ({ room, planName, pending, joined, seatsTaken }: HostRoomRow): HostRoom => ({
  id: room.id,
  title: room.title,
  summary: room.summary,
  category: room.category,
  status: room.status,
  visibility: room.visibility,
  admission: room.admission,
  balanceMode: room.category === 'dating' ? 'balanced' : room.balanceMode,
  inviteCode: room.inviteCode,
  live: isRoomLive(room),
  upcoming: isRoomUpcoming(room),
  planName,
  ticketPricePaise: room.ticketPricePaise,
  capacity: room.capacity,
  durationDays: room.durationDays,
  startsAt: isoOrNull(room.startsAt),
  endsAt: isoOrNull(room.endsAt),
  counts: { pending, accepted: seatsTaken - joined, joined },
  createdAt: iso(room.createdAt),
});

export const listHostRooms = async (ctx: Pick<Ctx, 'db'>, hostId: string): Promise<HostRoom[]> => {
  const rows = await ctx.db
    .select(hostRoomSelection)
    .from(rooms)
    .innerJoin(plans, eq(plans.id, rooms.planId))
    .where(eq(rooms.hostId, hostId))
    .orderBy(desc(rooms.createdAt));
  return rows.map(toHostRoom);
};

const ownedRoom = async (ctx: Pick<Ctx, 'db'>, roomId: string, hostId: string) => {
  const [room] = await ctx.db
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, roomId), eq(rooms.hostId, hostId)));
  if (!room) throw notFound('Room');
  return room;
};

/** The fairness rule: a group room's ticket may exceed the plan's published reference by the cap. */
export const maxTicketFor = (plan: Pick<typeof plans.$inferSelect, 'referenceTicketPaise' | 'ticketCapBps'>) =>
  Math.floor((plan.referenceTicketPaise * (10_000 + plan.ticketCapBps)) / 10_000);

export const createRoom = async (ctx: Ctx, hostId: string, input: CreateRoomInput) => {
  const [plan] = await ctx.db
    .select()
    .from(plans)
    .where(and(eq(plans.id, input.planId), eq(plans.isActive, true)));
  if (!plan) throw conflict('plan_unavailable', 'This plan is not available');

  const cap = maxTicketFor(plan);
  if (input.ticketPricePaise > cap) {
    throw new AppError(
      400,
      'ticket_above_cap',
      `Group rooms on the ${plan.name} plan can charge up to ${formatPaise(cap)} per ticket`,
    );
  }

  let scheduledFor: Date | null = null;
  if (input.scheduledFor) {
    scheduledFor = new Date(input.scheduledFor);
    const ahead = scheduledFor.getTime() - Date.now();
    if (ahead < 5 * 60_000 || ahead > 60 * 86_400_000) {
      throw new AppError(400, 'validation_failed', 'Schedule the opening between 5 minutes and 60 days from now');
    }
  }

  const entitled = await ctx.db
    .select({ key: planFeatures.featureKey })
    .from(planFeatures)
    .where(eq(planFeatures.planId, plan.id));

  const [room] = await ctx.db
    .insert(rooms)
    .values({
      hostId,
      planId: plan.id,
      title: input.title,
      summary: input.summary,
      description: input.description,
      category: input.category,
      visibility: input.visibility,
      admission: input.admission,
      // Dating rooms always balance; hosts cannot switch it off.
      balanceMode: input.category === 'dating' ? 'balanced' : input.balanceMode,
      scheduledFor,
      ticketPricePaise: input.ticketPricePaise,
      planPricePaise: plan.pricePaise,
      capacity: plan.capacity,
      durationDays: plan.durationDays,
      platformFeeBps: plan.platformFeeBps,
      entitlements: entitled.map(({ key }) => key),
    })
    .returning();

  return { roomId: room!.id, checkout: await openPlanCheckout(ctx, room!) };
};

export const retryPlanCheckout = async (ctx: Ctx, roomId: string, hostId: string) =>
  openPlanCheckout(ctx, await ownedRoom(ctx, roomId, hostId));

export const getHostRoomDashboard = async (
  ctx: Ctx,
  roomId: string,
  hostId: string,
): Promise<HostRoomDashboard> => {
  const { db } = ctx;
  const [row] = await db
    .select(hostRoomSelection)
    .from(rooms)
    .innerJoin(plans, eq(plans.id, rooms.planId))
    .where(and(eq(rooms.id, roomId), eq(rooms.hostId, hostId)));
  if (!row) throw notFound('Room');

  const { entitlements } = row.room;
  const engaged = and(
    eq(applications.roomId, roomId),
    inArray(applications.status, ['pending', 'accepted', 'joined']),
  );

  const [holders, [waitlist], [ratings], [connections]] = await Promise.all([
    seatHolders(db, roomId),
    db.select({ value: count() }).from(roomWaitlist).where(eq(roomWaitlist.roomId, roomId)),
    db
      .select({ average: avg(hostRatings.stars).mapWith(Number), count: count() })
      .from(hostRatings)
      .where(eq(hostRatings.roomId, roomId)),
    db
      .select({
        reveals: count(),
        verified: sql<number>`count(*) filter (where ${reveals.requesterConfirmedAt} is not null
          and ${reveals.recipientConfirmedAt} is not null)::int`,
      })
      .from(reveals)
      .where(and(eq(reveals.roomId, roomId), eq(reveals.status, 'accepted'))),
  ]);

  let demand: HostRoomDashboard['demand'] = null;
  if (entitlements.includes(FEATURE.analyticsDetailed)) {
    const interest = sql<string>`unnest(${profiles.interestedIn})`;
    const [seeking, gender] = await Promise.all([
      db
        .select({ interest, count: count() })
        .from(applications)
        .innerJoin(profiles, eq(profiles.id, applications.userId))
        .where(engaged)
        .groupBy(interest),
      db
        .select({ gender: profiles.gender, count: count() })
        .from(applications)
        .innerJoin(profiles, eq(profiles.id, applications.userId))
        .where(engaged)
        .groupBy(profiles.gender),
    ]);
    demand = {
      seeking: seeking as NonNullable<HostRoomDashboard['demand']>['seeking'],
      gender: gender.filter(
        (entry): entry is { gender: NonNullable<typeof entry.gender>; count: number } =>
          entry.gender !== null,
      ),
    };
  }

  let funnel: HostRoomDashboard['funnel'] = null;
  if (entitlements.includes(FEATURE.analyticsAdvanced)) {
    const [[applied], [accepted], [money]] = await Promise.all([
      db.select({ value: count() }).from(applications).where(eq(applications.roomId, roomId)),
      db
        .select({ value: count() })
        .from(applications)
        .where(
          and(
            eq(applications.roomId, roomId),
            sql`${applications.decidedAt} is not null
          and ${applications.status} in ('accepted', 'joined', 'left')`,
          ),
        ),
      db
        .select({
          gross: sum(payments.amountPaise).mapWith(Number),
          fee: sum(payments.platformFeePaise).mapWith(Number),
          host: sum(payments.hostEarningPaise).mapWith(Number),
        })
        .from(payments)
        .where(
          and(
            eq(payments.roomId, roomId),
            eq(payments.purpose, 'room_ticket'),
            eq(payments.status, 'paid'),
          ),
        ),
    ]);
    funnel = {
      applied: applied?.value ?? 0,
      accepted: accepted?.value ?? 0,
      joined: row.joined,
      grossPaise: money?.gross ?? 0,
      platformFeePaise: money?.fee ?? 0,
      hostEarningsPaise: money?.host ?? 0,
    };
  }

  return {
    ...toHostRoom(row),
    entitlements,
    activityKinds: ACTIVITY_KINDS.filter((kind) => entitlements.includes(ACTIVITY_FEATURE[kind])),
    balance: { healthy: isHealthy(holders), groups: pressure(holders) },
    waitlistCount: waitlist?.value ?? 0,
    ratings: {
      average: ratings?.average ? Math.round(ratings.average * 10) / 10 : null,
      count: ratings?.count ?? 0,
    },
    connections: { reveals: connections?.reveals ?? 0, verified: connections?.verified ?? 0 },
    demand,
    funnel,
  };
};

export const listApplicants = async (
  ctx: Ctx,
  roomId: string,
  hostId: string,
  query: z.infer<typeof paginationQuery>,
) => {
  const room = await ownedRoom(ctx, roomId, hostId);

  const [rows, totals, holders] = await Promise.all([
    ctx.db
      .select({
        application: applications,
        gender: profiles.gender,
        interestedIn: profiles.interestedIn,
      })
      .from(applications)
      .innerJoin(profiles, eq(profiles.id, applications.userId))
      .where(eq(applications.roomId, roomId))
      .orderBy(
        sql`case ${applications.status} when 'pending' then 0 when 'accepted' then 1 else 2 end`,
        asc(applications.createdAt),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query)),
    ctx.db.select({ total: count() }).from(applications).where(eq(applications.roomId, roomId)),
    seatHolders(ctx.db, roomId),
  ]);

  return {
    items: rows.map(({ application, gender, interestedIn }): Applicant => {
      const outlook =
        application.status === 'pending'
          ? assessCandidate(room, holders, { gender, wants: interestedIn })
          : null;
      return {
        id: application.id,
        alias: application.alias,
        gender,
        interestedIn: interestedIn as Applicant['interestedIn'],
        message: application.message,
        status: viewStatus(application),
        paymentDueAt: isoOrNull(application.paymentDueAt),
        admissible: outlook ? outlook.ok : true,
        blockedReason: outlook?.message ?? null,
        createdAt: iso(application.createdAt),
      };
    }),
    total: totals[0]?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export const decideApplication = async (
  ctx: Ctx,
  input: {
    roomId: string;
    applicationId: string;
    hostId: string;
    decision: 'accept' | 'reject';
  },
) => {
  const outcome = await ctx.db.transaction(async (tx) => {
    // The room lock is what stops two accepts from both taking the last seat.
    const [room] = await tx
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, input.roomId), eq(rooms.hostId, input.hostId)))
      .for('update');
    if (!room) throw notFound('Room');

    const [application] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.id, input.applicationId), eq(applications.roomId, room.id)))
      .for('update');
    if (!application) throw notFound('Application');
    if (application.status !== 'pending') {
      throw conflict('application_not_pending', 'This application has already been decided');
    }

    const now = new Date();
    if (input.decision === 'reject') {
      await tx
        .update(applications)
        .set({ status: 'rejected', decidedAt: now })
        .where(eq(applications.id, application.id));
      return { room, application, accepted: false };
    }

    if (!isRoomLive(room, now)) throw conflict('room_not_open', 'This room is no longer open');
    const [seats] = await tx
      .select({ taken: seatsTakenSql(room.id) })
      .from(rooms)
      .where(eq(rooms.id, room.id));
    if ((seats?.taken ?? 0) >= room.capacity) throw conflict('room_full', 'This room is full');

    // Hosts cannot override the interest balance; the platform enforces it here.
    const [candidate] = await tx
      .select({ gender: profiles.gender, wants: profiles.interestedIn })
      .from(profiles)
      .where(eq(profiles.id, application.userId));
    const outlook = assessCandidate(room, await seatHolders(tx, room.id), candidate!);
    if (outlook && !outlook.ok) throw conflict('room_unbalanced', outlook.message!);

    await acceptInto(tx, room, application.id, ctx.config.PAYMENT_WINDOW_HOURS, now);
    return { room, application, accepted: true };
  });

  await notify(ctx, [outcome.application.userId], outcome.accepted
    ? {
        kind: 'accepted',
        title: `You were accepted into ${outcome.room.title}`,
        body: `Pay ${formatPaise(outcome.room.ticketPricePaise)} within ${ctx.config.PAYMENT_WINDOW_HOURS} hours to take your seat.`,
        link: `/rooms/${outcome.room.id}`,
      }
    : {
        kind: 'rejected',
        title: `Not this time: ${outcome.room.title}`,
        body: 'The host chose other applicants. You were not charged.',
        link: '/',
      });
};

/** Ends a room early. Ratings open for its members straight away. */
export const endRoom = async (ctx: Ctx, roomId: string, hostId: string) => {
  const room = await ownedRoom(ctx, roomId, hostId);
  if (!isRoomLive(room) && !isRoomUpcoming(room)) throw conflict('room_not_open', 'This room is not running');
  const now = new Date();
  await ctx.db
    .update(rooms)
    .set({ status: 'closed', endsAt: now, ...(room.startsAt && room.startsAt > now ? { startsAt: now } : {}) })
    .where(eq(rooms.id, roomId));
  ctx.hub.publish(roomChannel(roomId), { kind: 'members' });
  invalidateHostCache();
};

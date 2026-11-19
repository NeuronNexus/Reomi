import { and, asc, count, desc, eq, inArray, sql, sum } from 'drizzle-orm';
import type { z } from 'zod';
import { FEATURE } from '@reomi/shared';
import type {
  Applicant,
  CreateRoomInput,
  HostApplicationInput,
  HostRoom,
  HostRoomDashboard,
  paginationQuery,
} from '@reomi/shared';
import type { Db } from '../db/client';
import {
  applications,
  hostVerifications,
  payments,
  planFeatures,
  plans,
  profiles,
  rooms,
} from '../db/schema';
import { conflict, forbidden, isUniqueViolation, notFound } from '../lib/errors';
import type { PaymentProvider } from '../lib/payment-provider';
import type { AuthContext } from '../plugins/auth';
import {
  applicationCountSql,
  iso,
  isoOrNull,
  isRoomLive,
  pageOffset,
  seatsTakenSql,
  viewStatus,
} from './common';
import { openPlanCheckout } from './payments.service';

export const submitHostApplication = async (
  db: Db,
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
    await db
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
  live: isRoomLive(room),
  planName,
  ticketPricePaise: room.ticketPricePaise,
  capacity: room.capacity,
  durationDays: room.durationDays,
  startsAt: isoOrNull(room.startsAt),
  endsAt: isoOrNull(room.endsAt),
  counts: { pending, accepted: seatsTaken - joined, joined },
  createdAt: iso(room.createdAt),
});

export const listHostRooms = async (db: Db, hostId: string): Promise<HostRoom[]> => {
  const rows = await db
    .select(hostRoomSelection)
    .from(rooms)
    .innerJoin(plans, eq(plans.id, rooms.planId))
    .where(eq(rooms.hostId, hostId))
    .orderBy(desc(rooms.createdAt));
  return rows.map(toHostRoom);
};

const ownedRoom = async (db: Db, roomId: string, hostId: string) => {
  const [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, roomId), eq(rooms.hostId, hostId)));
  if (!room) throw notFound('Room');
  return room;
};

export const createRoom = async (
  deps: { db: Db; provider: PaymentProvider },
  hostId: string,
  input: CreateRoomInput,
) => {
  const { db } = deps;
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, input.planId), eq(plans.isActive, true)));
  if (!plan) throw conflict('plan_unavailable', 'This plan is not available');

  const entitled = await db
    .select({ key: planFeatures.featureKey })
    .from(planFeatures)
    .where(eq(planFeatures.planId, plan.id));

  const [room] = await db
    .insert(rooms)
    .values({
      hostId,
      planId: plan.id,
      title: input.title,
      summary: input.summary,
      description: input.description,
      category: input.category,
      ticketPricePaise: input.ticketPricePaise,
      planPricePaise: plan.pricePaise,
      capacity: plan.capacity,
      durationDays: plan.durationDays,
      platformFeeBps: plan.platformFeeBps,
      entitlements: entitled.map(({ key }) => key),
    })
    .returning();

  return { roomId: room!.id, checkout: await openPlanCheckout(deps, room!) };
};

export const retryPlanCheckout = async (
  deps: { db: Db; provider: PaymentProvider },
  roomId: string,
  hostId: string,
) => openPlanCheckout(deps, await ownedRoom(deps.db, roomId, hostId));

export const getHostRoomDashboard = async (
  db: Db,
  roomId: string,
  hostId: string,
): Promise<HostRoomDashboard> => {
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
          and ${applications.status} in ('accepted', 'joined')`,
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

  return { ...toHostRoom(row), entitlements, demand, funnel };
};

export const listApplicants = async (
  db: Db,
  roomId: string,
  hostId: string,
  query: z.infer<typeof paginationQuery>,
) => {
  await ownedRoom(db, roomId, hostId);

  const [rows, totals] = await Promise.all([
    db
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
    db.select({ total: count() }).from(applications).where(eq(applications.roomId, roomId)),
  ]);

  return {
    items: rows.map(({ application, gender, interestedIn }): Applicant => ({
      id: application.id,
      alias: application.alias,
      gender,
      interestedIn: interestedIn as Applicant['interestedIn'],
      message: application.message,
      status: viewStatus(application),
      paymentDueAt: isoOrNull(application.paymentDueAt),
      createdAt: iso(application.createdAt),
    })),
    total: totals[0]?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export const decideApplication = async (
  db: Db,
  input: {
    roomId: string;
    applicationId: string;
    hostId: string;
    decision: 'accept' | 'reject';
    paymentWindowHours: number;
  },
) =>
  db.transaction(async (tx) => {
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
      return;
    }

    if (!isRoomLive(room, now)) throw conflict('room_not_open', 'This room is no longer open');
    const [seats] = await tx
      .select({ taken: seatsTakenSql(room.id) })
      .from(rooms)
      .where(eq(rooms.id, room.id));
    if ((seats?.taken ?? 0) >= room.capacity) throw conflict('room_full', 'This room is full');

    const windowEnd = now.getTime() + input.paymentWindowHours * 3_600_000;
    await tx
      .update(applications)
      .set({
        status: 'accepted',
        decidedAt: now,
        paymentDueAt: new Date(Math.min(windowEnd, room.endsAt!.getTime())),
      })
      .where(eq(applications.id, application.id));
  });

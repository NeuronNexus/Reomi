import { and, asc, count, desc, eq, gt, ilike, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { FEATURE } from '@reomi/shared';
import type { MyApplication, RoomCard, RoomDetail, roomListQuery } from '@reomi/shared';
import type { Db } from '../db/client';
import { applications, hostVerifications, profiles, rooms } from '../db/schema';
import { generateAlias } from '../lib/alias';
import { conflict, forbidden, notFound } from '../lib/errors';
import {
  iso,
  isoOrNull,
  isRoomLive,
  likeTerm,
  pageOffset,
  roomsHostedSql,
  seatsTakenSql,
  viewStatus,
} from './common';

const cardSelection = {
  room: rooms,
  hostName: hostVerifications.displayName,
  seatsTaken: seatsTakenSql(rooms.id),
  roomsHosted: roomsHostedSql(rooms.hostId),
};

type CardRow = {
  room: typeof rooms.$inferSelect;
  hostName: string;
  seatsTaken: number;
  roomsHosted: number;
};

const toCard = ({ room, hostName, seatsTaken, roomsHosted }: CardRow): RoomCard => ({
  id: room.id,
  title: room.title,
  summary: room.summary,
  category: room.category,
  ticketPricePaise: room.ticketPricePaise,
  capacity: room.capacity,
  seatsLeft: Math.max(room.capacity - seatsTaken, 0),
  durationDays: room.durationDays,
  startsAt: iso(room.startsAt!),
  endsAt: iso(room.endsAt!),
  host: { displayName: hostName, roomsHosted },
});

const discoveryRank = sql`case
  when ${FEATURE.discoveryPriority} = any(${rooms.entitlements}) then 2
  when ${FEATURE.discoveryEnhanced} = any(${rooms.entitlements}) then 1
  else 0 end`;

export const listRooms = async (db: Db, query: z.infer<typeof roomListQuery>) => {
  const where = and(
    eq(rooms.status, 'open'),
    gt(rooms.endsAt, sql`now()`),
    query.category ? eq(rooms.category, query.category) : undefined,
    query.q
      ? or(ilike(rooms.title, likeTerm(query.q)), ilike(rooms.summary, likeTerm(query.q)))
      : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select(cardSelection)
      .from(rooms)
      .innerJoin(hostVerifications, eq(hostVerifications.userId, rooms.hostId))
      .where(where)
      .orderBy(desc(discoveryRank), desc(rooms.startsAt), asc(rooms.id))
      .limit(query.pageSize)
      .offset(pageOffset(query)),
    db.select({ total: count() }).from(rooms).where(where),
  ]);

  return {
    items: rows.map(toCard),
    total: totals[0]?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
};

const toMyApplication = (
  application: typeof applications.$inferSelect,
  room: typeof rooms.$inferSelect,
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
  createdAt: iso(application.createdAt),
});

export const getRoom = async (
  db: Db,
  roomId: string,
  viewerId: string | undefined,
): Promise<RoomDetail> => {
  const [row] = await db
    .select(cardSelection)
    .from(rooms)
    .innerJoin(hostVerifications, eq(hostVerifications.userId, rooms.hostId))
    .where(eq(rooms.id, roomId));
  if (!row || !row.room.startsAt) throw notFound('Room');

  const mine = viewerId
    ? (
        await db
          .select()
          .from(applications)
          .where(and(eq(applications.roomId, roomId), eq(applications.userId, viewerId)))
      )[0]
    : undefined;

  const isHost = row.room.hostId === viewerId;
  // Closed rooms stay readable only for the people who were part of them.
  if (!isRoomLive(row.room) && !isHost && !mine) throw notFound('Room');

  return {
    ...toCard(row),
    description: row.room.description,
    isHost,
    myApplication: mine ? toMyApplication(mine, row.room) : null,
  };
};

export const listMyApplications = async (db: Db, userId: string): Promise<MyApplication[]> => {
  const rows = await db
    .select({ application: applications, room: rooms })
    .from(applications)
    .innerJoin(rooms, eq(rooms.id, applications.roomId))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.updatedAt));
  return rows.map(({ application, room }) => toMyApplication(application, room));
};

export const applyToRoom = async (
  db: Db,
  input: { roomId: string; userId: string; message: string },
): Promise<MyApplication> =>
  db.transaction(async (tx) => {
    // Locking the room serialises applicants, keeping the seat check and alias pick accurate.
    const [room] = await tx.select().from(rooms).where(eq(rooms.id, input.roomId)).for('update');
    if (!room || !room.startsAt) throw notFound('Room');
    if (!isRoomLive(room)) throw conflict('room_not_open', 'This room is no longer open');
    if (room.hostId === input.userId) throw forbidden('own_room', 'You host this room');

    const existingApplications = await tx
      .select()
      .from(applications)
      .where(eq(applications.roomId, room.id));
    const [{ seatsTaken } = { seatsTaken: 0 }] = await tx
      .select({ seatsTaken: seatsTakenSql(room.id) })
      .from(rooms)
      .where(eq(rooms.id, room.id));
    if (seatsTaken >= room.capacity) throw conflict('room_full', 'This room is full');

    const previous = existingApplications.find((row) => row.userId === input.userId);
    if (previous) {
      const status = viewStatus(previous);
      if (status !== 'withdrawn' && status !== 'expired') {
        throw conflict('already_applied', 'You have already applied to this room');
      }
      const [updated] = await tx
        .update(applications)
        .set({ status: 'pending', message: input.message, paymentDueAt: null, decidedAt: null })
        .where(eq(applications.id, previous.id))
        .returning();
      return toMyApplication(updated!, room);
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
    return toMyApplication(created!, room);
  });

export const withdrawApplication = async (db: Db, applicationId: string, userId: string) => {
  const [row] = await db
    .update(applications)
    .set({ status: 'withdrawn', paymentDueAt: null })
    .where(
      and(
        eq(applications.id, applicationId),
        eq(applications.userId, userId),
        or(eq(applications.status, 'pending'), eq(applications.status, 'accepted')),
      ),
    )
    .returning({ id: applications.id });
  if (!row)
    throw conflict('application_not_pending', 'This application can no longer be withdrawn');
};

export const getLobby = async (db: Db, roomId: string, userId: string) => {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId));
  if (!room) throw notFound('Room');

  const members = await db
    .select({ alias: applications.alias, userId: applications.userId })
    .from(applications)
    .where(and(eq(applications.roomId, roomId), eq(applications.status, 'joined')))
    .orderBy(asc(applications.alias));

  const yourAlias = members.find((member) => member.userId === userId)?.alias ?? null;
  if (!yourAlias && room.hostId !== userId) {
    throw forbidden('forbidden', 'Only members of this room can enter it');
  }

  return {
    roomId: room.id,
    title: room.title,
    endsAt: isoOrNull(room.endsAt),
    yourAlias,
    members: members.map(({ alias }) => ({ alias })),
  };
};

export const updateOnboarding = async (
  db: Db,
  userId: string,
  input: Pick<typeof profiles.$inferInsert, 'fullName' | 'dateOfBirth' | 'gender' | 'interestedIn'>,
) => {
  await db.update(profiles).set(input).where(eq(profiles.id, userId));
};

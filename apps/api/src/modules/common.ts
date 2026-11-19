import { sql } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import type { Config } from '../config';
import type { Db, Tx } from '../db/client';
import type { applications } from '../db/schema';
import { rooms } from '../db/schema';
import type { PaymentProvider } from '../lib/payment-provider';
import type { RealtimeHub } from '../lib/realtime';
import type { MediaStorage } from '../lib/storage';

type Application = typeof applications.$inferSelect;
type Room = typeof rooms.$inferSelect;

/** Everything a service may need. Routes build one per request from the app decorations. */
export interface Ctx {
  db: Db;
  hub: RealtimeHub;
  storage: MediaStorage;
  config: Config;
  provider: PaymentProvider;
}

export type DbLike = Db | Tx;

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null => date?.toISOString() ?? null;

export const likeTerm = (term: string): string => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

/** Open for applications and conversation: paid, started and not yet over. */
export const isRoomLive = (
  room: Pick<Room, 'status' | 'endsAt' | 'startsAt'>,
  now = new Date(),
): boolean =>
  room.status === 'open' &&
  room.startsAt !== null &&
  room.startsAt <= now &&
  room.endsAt !== null &&
  room.endsAt > now;

/** Paid and announced but not open yet. */
export const isRoomUpcoming = (room: Pick<Room, 'status' | 'startsAt'>, now = new Date()): boolean =>
  room.status === 'open' && room.startsAt !== null && room.startsAt > now;

/** Over, either by time or because the host ended it. Ratings open from here. */
export const isRoomEnded = (room: Pick<Room, 'status' | 'endsAt' | 'startsAt'>, now = new Date()) =>
  room.startsAt !== null &&
  (room.status === 'closed' || (room.endsAt !== null && room.endsAt <= now));

export const roomLiveSql = sql<boolean>`(${rooms.status} = 'open' and ${rooms.startsAt} <= now()
  and ${rooms.endsAt} > now())`;

export const viewStatus = (
  application: Pick<Application, 'status' | 'paymentDueAt'>,
  now = new Date(),
) =>
  application.status === 'accepted' && application.paymentDueAt && application.paymentDueAt <= now
    ? ('expired' as const)
    : application.status;

/**
 * A seat is held by a member, or by an accepted applicant whose payment window is still open.
 * Expired holds free themselves here, so no background job is needed to release seats.
 */
export const seatsTakenSql = (roomId: AnyColumn | string) => sql<number>`(
  select count(*)::int from applications a
  where a.room_id = ${roomId}
    and (a.status = 'joined' or (a.status = 'accepted' and a.payment_due_at > now()))
)`;

export const applicationCountSql = (
  roomId: AnyColumn,
  status: Application['status'],
) => sql<number>`(
  select count(*)::int from applications a where a.room_id = ${roomId} and a.status = ${status}
)`;

export const roomsHostedSql = (hostId: AnyColumn) => sql<number>`(
  select count(*)::int from rooms r where r.host_id = ${hostId} and r.starts_at is not null
)`;

export const pageOffset = ({ page, pageSize }: { page: number; pageSize: number }): number =>
  (page - 1) * pageSize;

/** Orders two user ids the way `threads` stores them. */
export const orderedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export const firstName = (fullName: string | null): string =>
  (fullName ?? '').trim().split(/\s+/)[0] || 'Someone';

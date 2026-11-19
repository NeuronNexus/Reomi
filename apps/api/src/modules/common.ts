import { sql } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import type { applications } from '../db/schema';
import { rooms } from '../db/schema';

type Application = typeof applications.$inferSelect;
type Room = typeof rooms.$inferSelect;

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null => date?.toISOString() ?? null;

export const likeTerm = (term: string): string => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

export const isRoomLive = (room: Pick<Room, 'status' | 'endsAt'>, now = new Date()): boolean =>
  room.status === 'open' && room.endsAt !== null && room.endsAt > now;

export const roomLiveSql = sql<boolean>`(${rooms.status} = 'open' and ${rooms.endsAt} > now())`;

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

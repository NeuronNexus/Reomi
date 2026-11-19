import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { applications, profiles, rooms } from '../db/schema';
import type { Assessment, Person } from '../lib/balance';
import { assessAdmission, explainBlock } from '../lib/balance';
import type { DbLike } from './common';

type Room = typeof rooms.$inferSelect;

const holdsSeat = sql`(${applications.status} = 'joined'
  or (${applications.status} = 'accepted' and ${applications.paymentDueAt} > now()))`;

/** The people currently holding seats, as the balance rules see them. */
export const seatHolders = async (
  db: DbLike,
  roomId: string,
  excludeUserId?: string,
): Promise<Person[]> => {
  const rows = await db
    .select({ gender: profiles.gender, wants: profiles.interestedIn })
    .from(applications)
    .innerJoin(profiles, eq(profiles.id, applications.userId))
    .where(
      and(
        eq(applications.roomId, roomId),
        holdsSeat,
        excludeUserId ? ne(applications.userId, excludeUserId) : undefined,
      ),
    );
  return rows;
};

/** Seat holders for many rooms at once, for listing pages. */
export const seatHoldersByRoom = async (db: DbLike, roomIds: readonly string[]) => {
  const byRoom = new Map<string, Person[]>();
  if (roomIds.length === 0) return byRoom;
  const rows = await db
    .select({ roomId: applications.roomId, gender: profiles.gender, wants: profiles.interestedIn })
    .from(applications)
    .innerJoin(profiles, eq(profiles.id, applications.userId))
    .where(and(inArray(applications.roomId, [...roomIds]), holdsSeat));
  for (const { roomId, ...person } of rows) {
    const list = byRoom.get(roomId) ?? [];
    list.push(person);
    byRoom.set(roomId, list);
  }
  return byRoom;
};

export const personFor = async (db: DbLike, userId: string): Promise<Person> => {
  const [row] = await db
    .select({ gender: profiles.gender, wants: profiles.interestedIn })
    .from(profiles)
    .where(eq(profiles.id, userId));
  return row ?? { gender: null, wants: [] };
};

const balancingApplies = (room: Pick<Room, 'balanceMode' | 'category'>) =>
  room.category === 'dating' || room.balanceMode === 'balanced';

/** Null when the room does not balance, otherwise whether this person could be admitted now. */
export const assessFor = async (
  db: DbLike,
  room: Pick<Room, 'id' | 'balanceMode' | 'category'>,
  userId: string,
): Promise<(Assessment & { message: string | null }) | null> => {
  if (!balancingApplies(room)) return null;
  const [members, candidate] = await Promise.all([
    seatHolders(db, room.id, userId),
    personFor(db, userId),
  ]);
  const result = assessAdmission(members, candidate);
  return { ...result, message: result.ok ? null : explainBlock(result.blockedFor) };
};

export const assessCandidate = (
  room: Pick<Room, 'balanceMode' | 'category'>,
  members: readonly Person[],
  candidate: Person,
) => {
  if (!balancingApplies(room)) return null;
  const result = assessAdmission(members, candidate);
  return { ...result, message: result.ok ? null : explainBlock(result.blockedFor) };
};

export { balancingApplies };

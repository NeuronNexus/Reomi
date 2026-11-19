import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Notification, Notifications } from '@reomi/shared';
import { notifications } from '../db/schema';
import { userChannel } from '../lib/realtime';
import type { Ctx, DbLike } from './common';
import { iso } from './common';

type Row = typeof notifications.$inferSelect;

export const toNotification = (row: Row): Notification => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  link: row.link,
  read: row.readAt !== null,
  createdAt: iso(row.createdAt),
});

export interface NotificationInput {
  kind: string;
  title: string;
  body?: string;
  link?: string | null;
}

/** Stores the notice for each person and pushes it live to anyone connected. */
export const notify = async (
  ctx: Pick<Ctx, 'db' | 'hub'> & { db: DbLike },
  userIds: readonly string[],
  input: NotificationInput,
) => {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const rows = await ctx.db
    .insert(notifications)
    .values(
      unique.map((userId) => ({
        userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? '',
        link: input.link ?? null,
      })),
    )
    .returning();
  for (const row of rows) {
    ctx.hub.publish(userChannel(row.userId), {
      kind: 'notification',
      notification: toNotification(row),
    });
  }
};

export const listNotifications = async (ctx: Ctx, userId: string): Promise<Notifications> => {
  const [rows, [unread]] = await Promise.all([
    ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50),
    ctx.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { items: rows.map(toNotification), unread: unread?.value ?? 0 };
};

export const markRead = async (ctx: Ctx, userId: string, ids?: readonly string[]) => {
  await ctx.db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids && ids.length > 0 ? inArray(notifications.id, [...ids]) : undefined,
      ),
    );
};

import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { MEDIA_LIMITS } from '@reomi/shared';
import type { Media, MediaUpload } from '@reomi/shared';
import { media } from '../db/schema';
import { AppError } from '../lib/errors';
import type { Ctx, DbLike } from './common';

type MediaRow = typeof media.$inferSelect;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const isImage = (type: string) => (MEDIA_LIMITS.imageTypes as readonly string[]).includes(type);
const isVideo = (type: string) => (MEDIA_LIMITS.videoTypes as readonly string[]).includes(type);

export const createUpload = async (
  ctx: Ctx,
  ownerId: string,
  input: { purpose: MediaRow['purpose']; contentType: string; size: number },
): Promise<MediaUpload> => {
  const type = input.contentType.toLowerCase();
  const image = isImage(type);
  const video = isVideo(type);
  if (!image && !video) throw new AppError(400, 'media_invalid', 'Use a JPG, PNG, WebP, GIF, MP4, WebM or MOV file');
  if (input.purpose === 'avatar' && !image) {
    throw new AppError(400, 'media_invalid', 'Profile photos must be images');
  }
  const limit = image ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.videoBytes;
  if (input.size > limit) {
    throw new AppError(400, 'media_invalid', `Files of this type can be up to ${limit / 1024 / 1024} MB`);
  }

  const id = randomUUID();
  const path = `${input.purpose}/${ownerId}/${id}.${EXTENSIONS[type]}`;
  const upload = await ctx.storage.createUpload(path, type);
  await ctx.db.insert(media).values({
    id,
    ownerId,
    purpose: input.purpose,
    path,
    contentType: type,
    size: input.size,
  });
  return { mediaId: id, upload };
};

/** Claims uploaded files for a post, story or profile. Each file may be used once, by its owner. */
export const claimMedia = async (
  db: DbLike,
  ownerId: string,
  ids: readonly string[],
  purpose: MediaRow['purpose'],
): Promise<MediaRow[]> => {
  if (ids.length === 0) return [];
  const rows = await db
    .update(media)
    .set({ attachedAt: new Date() })
    .where(
      and(
        inArray(media.id, [...ids]),
        eq(media.ownerId, ownerId),
        eq(media.purpose, purpose),
        isNull(media.attachedAt),
      ),
    )
    .returning();
  if (rows.length !== new Set(ids).size) {
    throw new AppError(400, 'media_invalid', 'One of the files is missing or already used');
  }
  return ids.map((id) => rows.find((row) => row.id === id)!);
};

export const mediaKind = (contentType: string): Media['type'] =>
  contentType.startsWith('video/') ? 'video' : 'image';

/** Signs every path once, tolerating storage outages so a feed still renders without images. */
export const signPaths = async (ctx: Ctx, paths: readonly (string | null | undefined)[]) => {
  const wanted = paths.filter((path): path is string => Boolean(path));
  try {
    return await ctx.storage.signDownloads(wanted);
  } catch {
    return new Map<string, string>();
  }
};

export const loadMedia = async (ctx: Ctx, ids: readonly string[]) => {
  if (ids.length === 0) return new Map<string, Media>();
  const rows = await ctx.db.select().from(media).where(inArray(media.id, [...new Set(ids)]));
  const urls = await signPaths(
    ctx,
    rows.map((row) => row.path),
  );
  return new Map(
    rows
      .filter((row) => urls.has(row.path))
      .map((row) => [row.id, { id: row.id, url: urls.get(row.path)!, type: mediaKind(row.contentType) }]),
  );
};

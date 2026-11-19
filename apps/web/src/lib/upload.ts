import { toast } from 'sonner';
import { ApiRequestError, MEDIA_LIMITS } from '@reomi/shared';
import type { BlockedMessageDetails, MediaUpload } from '@reomi/shared';
import { api } from './client';

type Purpose = 'avatar' | 'post' | 'story';

export const ACCEPT_IMAGES = MEDIA_LIMITS.imageTypes.join(',');
export const ACCEPT_MEDIA = [...MEDIA_LIMITS.imageTypes, ...MEDIA_LIMITS.videoTypes].join(',');

/** Sends a file straight to storage with a signed URL and returns its media id. */
export const uploadFile = async (file: File, purpose: Purpose): Promise<string> => {
  const isVideo = file.type.startsWith('video/');
  const limit = isVideo ? MEDIA_LIMITS.videoBytes : MEDIA_LIMITS.imageBytes;
  if (file.size > limit) {
    throw new Error(
      `That file is too big. ${isVideo ? 'Videos' : 'Images'} can be up to ${limit / 1024 / 1024} MB.`,
    );
  }
  const { mediaId, upload } = await api.post<MediaUpload>('/v1/media/uploads', {
    purpose,
    contentType: file.type || 'application/octet-stream',
    size: file.size,
  });
  let response: Response;
  try {
    response = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: file,
    });
  } catch {
    throw new Error('The upload did not go through. Check your connection and try again.');
  }
  if (!response.ok) throw new Error('The upload was rejected. Try a smaller or different file.');
  return mediaId;
};

const ACTIONS: Record<BlockedMessageDetails['action'], string | null> = {
  none: null,
  warning: 'This is a warning. Repeated strikes lead to mutes and removal.',
  muted: 'You are muted for 24 hours.',
  removed: 'You were removed and muted for a week.',
  suspended: 'Your account is suspended pending review.',
};

/** Shows why a message or post was held back, including any strike that was applied. */
export const toastError = (error: unknown) => {
  if (
    error instanceof ApiRequestError &&
    (error.code === 'message_blocked' || error.code === 'content_blocked')
  ) {
    const details = error.details as BlockedMessageDetails | undefined;
    toast.error(error.message, {
      description: details ? (ACTIONS[details.action] ?? undefined) : undefined,
      duration: 8000,
    });
    return;
  }
  toast.error(error instanceof Error ? error.message : 'Something went wrong');
};

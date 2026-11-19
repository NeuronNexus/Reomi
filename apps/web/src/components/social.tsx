import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Film, Flag, Heart, ImagePlus, MessageSquare, Plus, Send, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { Author, Comment, Post, StoryGroup } from '@reomi/shared';
import { api } from '../lib/client';
import { timeAgo } from '../lib/format';
import { ACCEPT_IMAGES, ACCEPT_MEDIA, toastError, uploadFile } from '../lib/upload';
import { AuraAvatar } from './aura';
import { Badge, Button } from './ui';

export const AuthorAvatar = ({ author, size = 'md' }: { author: Author; size?: 'md' | 'lg' }) =>
  author.avatarUrl ? (
    <img
      src={author.avatarUrl}
      alt=""
      className={clsx('rounded-full object-cover', size === 'md' ? 'size-10' : 'size-14')}
    />
  ) : (
    <AuraAvatar seed={author.memberId} size={size} />
  );

/* Posts -------------------------------------------------------------------------------------- */

export const PostCard = ({
  post,
  showCommunity = false,
  onChanged,
}: {
  post: Post;
  showCommunity?: boolean;
  onChanged: () => void;
}) => {
  const [liked, setLiked] = useState(post.likedByYou);
  const [likes, setLikes] = useState(post.likeCount);
  const [open, setOpen] = useState(false);

  const like = useMutation({
    mutationFn: (on: boolean) =>
      on ? api.post(`/v1/posts/${post.id}/like`) : api.delete(`/v1/posts/${post.id}/like`),
    onMutate: (on) => {
      setLiked(on);
      setLikes((n) => n + (on ? 1 : -1));
    },
    onError: (error, on) => {
      setLiked(!on);
      setLikes((n) => n - (on ? 1 : -1));
      toastError(error);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/posts/${post.id}`),
    onSuccess: () => {
      toast.success('Post removed');
      onChanged();
    },
    onError: toastError,
  });
  const report = useMutation({
    mutationFn: (reason: string) =>
      api.post('/v1/reports', { targetType: 'post', targetId: post.id, reason }),
    onSuccess: () => toast.success('Reported to the moderators'),
    onError: toastError,
  });

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex items-center gap-3 p-4">
        <AuthorAvatar author={post.author} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-medium">
            {post.author.displayName}
            {post.author.role !== 'member' && (
              <Badge tone="ember">{post.author.role === 'owner' ? 'Owner' : 'Mod'}</Badge>
            )}
          </p>
          <p className="truncate text-xs text-faint">
            {showCommunity && (
              <>
                <Link to={`/c/${post.community.slug}`} className="hover:text-amber">
                  {post.community.name}
                </Link>
                {' · '}
              </>
            )}
            {timeAgo(post.createdAt)}
            {post.kind === 'reel' && ' · Reel'}
          </p>
        </div>
        {post.canDelete ? (
          <Button
            variant="quiet"
            className="px-2!"
            aria-label="Delete post"
            onClick={() => {
              if (window.confirm('Delete this post?')) remove.mutate();
            }}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button
            variant="quiet"
            className="px-2!"
            aria-label="Report post"
            onClick={() => {
              const reason = window.prompt('Why are you reporting this post?');
              if (reason && reason.trim().length >= 3) report.mutate(reason.trim());
            }}
          >
            <Flag className="size-4" aria-hidden />
          </Button>
        )}
      </header>
      {post.body && <p className="px-4 pb-3 leading-relaxed whitespace-pre-wrap">{post.body}</p>}
      {post.media.length > 0 && <MediaGrid post={post} />}
      <footer className="flex items-center gap-4 px-4 py-3 text-sm">
        <button
          type="button"
          aria-pressed={liked}
          onClick={() => like.mutate(!liked)}
          className={clsx(
            'inline-flex min-h-9 items-center gap-1.5',
            liked ? 'text-ember' : 'text-muted hover:text-cream',
          )}
        >
          <Heart className={clsx('size-5', liked && 'fill-ember')} aria-hidden />
          {likes}
        </button>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-9 items-center gap-1.5 text-muted hover:text-cream"
        >
          <MessageSquare className="size-5" aria-hidden />
          {post.commentCount}
        </button>
      </footer>
      {open && <Comments postId={post.id} onChanged={onChanged} />}
    </article>
  );
};

const MediaGrid = ({ post }: { post: Post }) => {
  const items = post.media;
  if (items.length === 1) {
    const item = items[0]!;
    return item.type === 'video' ? (
      <video
        src={item.url}
        controls
        playsInline
        preload="metadata"
        className={clsx(
          'w-full bg-black',
          post.kind === 'reel' ? 'mx-auto max-h-[70vh] aspect-[9/16] object-cover' : 'max-h-[70vh]',
        )}
      />
    ) : (
      <img src={item.url} alt="" loading="lazy" className="max-h-[75vh] w-full object-cover" />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-0.5">
      {items.map((item) => (
        <img
          key={item.id}
          src={item.url}
          alt=""
          loading="lazy"
          className="aspect-square w-full object-cover"
        />
      ))}
    </div>
  );
};

const Comments = ({ postId, onChanged }: { postId: string; onChanged: () => void }) => {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const key = ['comments', postId];
  const comments = useQuery({
    queryKey: key,
    queryFn: () => api.get<Comment[]>(`/v1/posts/${postId}/comments`),
  });
  const add = useMutation({
    mutationFn: () => api.post<Comment[]>(`/v1/posts/${postId}/comments`, { body: body.trim() }),
    onSuccess: (list) => {
      queryClient.setQueryData(key, list);
      setBody('');
      onChanged();
    },
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/comments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: toastError,
  });

  return (
    <div className="border-t border-line px-4 py-3">
      <ul className="space-y-3">
        {comments.data?.map((comment) => (
          <li key={comment.id} className="flex gap-2.5 text-sm">
            <span className="scale-75">
              <AuthorAvatar author={comment.author} />
            </span>
            <div className="min-w-0 flex-1">
              <p>
                <span className="font-medium">{comment.author.displayName}</span>{' '}
                <span className="text-faint">{timeAgo(comment.createdAt)}</span>
              </p>
              <p className="whitespace-pre-wrap text-muted">{comment.body}</p>
            </div>
            {comment.canDelete && (
              <button
                type="button"
                aria-label="Delete comment"
                className="text-faint hover:text-danger"
                onClick={() => remove.mutate(comment.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim()) add.mutate();
        }}
      >
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={500}
          placeholder="Add something kind and useful"
          className="min-h-10 flex-1 rounded-full border border-line bg-ink px-4 text-sm placeholder:text-faint focus:border-amber focus:outline-none"
        />
        <Button
          type="submit"
          aria-label="Post comment"
          className="size-10 px-0!"
          loading={add.isPending}
          disabled={!body.trim()}
        >
          {!add.isPending && <Send className="size-4" aria-hidden />}
        </Button>
      </form>
    </div>
  );
};

export const PostComposer = ({ slug, onPosted }: { slug: string; onPosted: () => void }) => {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [reel, setReel] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const previews = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)));

  const hasVideo = files.some((f) => f.type.startsWith('video/'));
  const kind = files.length === 0 ? 'text' : hasVideo ? (reel ? 'reel' : 'video') : 'photo';

  const submit = async () => {
    if (busy) return;
    if (hasVideo && files.length > 1) {
      toast.error('A video post takes a single video.');
      return;
    }
    setBusy(true);
    try {
      const mediaIds = [];
      for (const file of files) mediaIds.push(await uploadFile(file, 'post'));
      await api.post(`/v1/communities/${slug}/posts`, { kind, body: body.trim(), mediaIds });
      setBody('');
      setFiles([]);
      setReel(false);
      toast.success('Posted');
      onPosted();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder="Share something with this community"
        className="w-full resize-none bg-transparent text-base placeholder:text-faint focus:outline-none"
      />
      {previews.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {previews.map(({ file, url }) => (
            <div key={url} className="relative shrink-0">
              {file.type.startsWith('video/') ? (
                <video src={url} className="size-24 rounded-xl object-cover" muted />
              ) : (
                <img src={url} alt="" className="size-24 rounded-xl object-cover" />
              )}
              <button
                type="button"
                aria-label="Remove"
                onClick={() => setFiles(files.filter((f) => f !== file))}
                className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-ink/80"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT_MEDIA}
          className="hidden"
          onChange={(e) => {
            setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 6));
            e.target.value = '';
          }}
        />
        <Button variant="ghost" className="px-4!" onClick={() => input.current?.click()}>
          <ImagePlus className="size-4" aria-hidden />
          Photo or video
        </Button>
        {hasVideo && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={reel}
              onChange={(e) => setReel(e.target.checked)}
              className="size-4 accent-[#ff6a33]"
            />
            <Film className="size-4" aria-hidden />
            Post as a reel
          </label>
        )}
        <Button
          className="ml-auto"
          loading={busy}
          disabled={!body.trim() && files.length === 0}
          onClick={() => void submit()}
        >
          Post
        </Button>
      </div>
    </div>
  );
};

/* Stories ------------------------------------------------------------------------------------ */

export const StoriesBar = ({
  groups,
  slug,
  onChanged,
}: {
  groups: StoryGroup[];
  slug?: string;
  onChanged: () => void;
}) => {
  const [viewing, setViewing] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const addStory = async (file: File | undefined) => {
    if (!file || !slug) return;
    setBusy(true);
    try {
      const mediaId = await uploadFile(file, 'story');
      const caption = window.prompt('Add a caption (optional)') ?? '';
      await api.post(`/v1/communities/${slug}/stories`, {
        mediaId,
        caption: caption.slice(0, 200),
      });
      toast.success('Story shared for 24 hours');
      onChanged();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  if (groups.length === 0 && !slug) return null;

  return (
    <>
      <div className="mb-6 flex gap-4 overflow-x-auto pb-2">
        {slug && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="flex w-18 shrink-0 flex-col items-center gap-1.5 text-xs text-muted"
          >
            <span className="grid size-16 place-items-center rounded-full border-2 border-dashed border-line">
              <Plus className={clsx('size-6', busy && 'animate-spin')} aria-hidden />
            </span>
            Your story
            <input
              ref={input}
              type="file"
              accept={ACCEPT_IMAGES + ',video/mp4,video/webm'}
              className="hidden"
              onChange={(e) => void addStory(e.target.files?.[0])}
            />
          </button>
        )}
        {groups.map((group, index) => (
          <button
            key={group.author.memberId}
            type="button"
            onClick={() => setViewing(index)}
            className="flex w-18 shrink-0 flex-col items-center gap-1.5 text-xs text-muted"
          >
            <span className="rounded-full bg-[conic-gradient(#ff6a33,#ffc56b,#ff4d6d,#ff6a33)] p-0.5">
              <span className="block rounded-full border-2 border-ink">
                <AuthorAvatar author={group.author} size="lg" />
              </span>
            </span>
            <span className="w-full truncate">{group.author.displayName}</span>
          </button>
        ))}
      </div>
      {viewing !== null && groups[viewing] && (
        <StoryViewer groups={groups} start={viewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
};

const STORY_MS = 5000;

const StoryViewer = ({
  groups,
  start,
  onClose,
}: {
  groups: StoryGroup[];
  start: number;
  onClose: () => void;
}) => {
  const [groupIndex, setGroupIndex] = useState(start);
  const [storyIndex, setStoryIndex] = useState(0);
  const group = groups[groupIndex]!;
  const story = group.stories[storyIndex]!;

  const next = () => {
    if (storyIndex < group.stories.length - 1) setStoryIndex(storyIndex + 1);
    else if (groupIndex < groups.length - 1) {
      setGroupIndex(groupIndex + 1);
      setStoryIndex(0);
    } else onClose();
  };
  const previous = () => {
    if (storyIndex > 0) setStoryIndex(storyIndex - 1);
    else if (groupIndex > 0) {
      setGroupIndex(groupIndex - 1);
      setStoryIndex(0);
    }
  };

  useEffect(() => {
    if (story.media.type === 'video') return;
    const timer = setTimeout(next, STORY_MS);
    return () => clearTimeout(timer);
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') next();
      if (event.key === 'ArrowLeft') previous();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Stories"
      className="fixed inset-0 z-50 grid place-items-center bg-black/95"
    >
      <div className="relative h-full max-h-[52rem] w-full max-w-md">
        <div className="absolute inset-x-3 top-3 z-10 flex gap-1">
          {group.stories.map((s, i) => (
            <span key={s.id} className="h-0.5 flex-1 overflow-hidden rounded bg-white/30">
              <span
                className={clsx(
                  'block h-full bg-white',
                  i < storyIndex ? 'w-full' : i > storyIndex ? 'w-0' : 'story-progress',
                )}
                style={
                  i === storyIndex && story.media.type !== 'video'
                    ? { animationDuration: `${STORY_MS}ms` }
                    : undefined
                }
              />
            </span>
          ))}
        </div>
        <div className="absolute inset-x-3 top-6 z-10 flex items-center gap-2 text-sm">
          <span className="scale-75">
            <AuthorAvatar author={group.author} />
          </span>
          <span className="font-medium">{group.author.displayName}</span>
          <span className="text-white/60">
            {group.community.name} · {timeAgo(story.createdAt)}
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto grid size-10 place-items-center"
          >
            <X className="size-6" />
          </button>
        </div>
        {story.media.type === 'video' ? (
          <video
            key={story.id}
            src={story.media.url}
            autoPlay
            playsInline
            onEnded={next}
            className="h-full w-full object-contain"
          />
        ) : (
          <img
            key={story.id}
            src={story.media.url}
            alt=""
            className="h-full w-full object-contain"
          />
        )}
        {story.caption && (
          <p className="absolute inset-x-6 bottom-10 rounded-xl bg-black/50 p-3 text-center">
            {story.caption}
          </p>
        )}
        <button
          type="button"
          aria-label="Previous"
          onClick={previous}
          className="absolute inset-y-16 left-0 w-1/3"
        />
        <button
          type="button"
          aria-label="Next"
          onClick={next}
          className="absolute inset-y-16 right-0 w-2/3"
        />
      </div>
    </div>
  );
};

import type { InfiniteData } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Flag, MessageCircle, Send, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { toast } from 'sonner';
import type { Activity, Message, RealtimeEvent } from '@reomi/shared';
import { api } from '../lib/client';
import { useChannel } from '../lib/realtime';
import { toastError } from '../lib/upload';
import { AuraAvatar } from './aura';
import { Badge, Button } from './ui';

type Pages = InfiniteData<Message[], string | undefined>;

const PAGE = 40;

/**
 * Loads a conversation newest-first in pages and keeps it live: realtime messages are appended
 * to the newest page, and activity results are merged in place without losing your own answer.
 */
export const useConversation = (kind: 'room' | 'thread', id: string) => {
  const queryClient = useQueryClient();
  const base = kind === 'room' ? `/v1/rooms/${id}/messages` : `/v1/threads/${id}/messages`;
  const key = [kind === 'room' ? 'messages' : 'thread-messages', id];

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api.get<Message[]>(base, { before: pageParam, limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[0]?.createdAt : undefined),
    staleTime: Infinity,
  });

  const append = (message: Message) =>
    queryClient.setQueryData<Pages>(key, (data) => {
      if (!data) return data;
      if (data.pages.some((page) => page.some((m) => m.id === message.id))) return data;
      const [newest = [], ...rest] = data.pages;
      return { ...data, pages: [[...newest, message], ...rest] };
    });

  const mergeActivity = (activity: Activity) =>
    queryClient.setQueryData<Pages>(key, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) =>
              page.map((m) =>
                m.activity?.id === activity.id
                  ? {
                      ...m,
                      activity: {
                        ...activity,
                        myChoice: activity.myChoice ?? m.activity.myChoice,
                        myAnswer: activity.myAnswer ?? m.activity.myAnswer,
                      },
                    }
                  : m,
              ),
            ),
          }
        : data,
    );

  useChannel(`${kind}:${id}`, (event: RealtimeEvent) => {
    if (event.kind === 'message') append(event.message);
    if (event.kind === 'activity') mergeActivity(event.activity);
    if (event.kind === 'members') void queryClient.invalidateQueries({ queryKey: ['space', id] });
  });

  const messages = query.data ? [...query.data.pages].reverse().flat() : [];
  return { query, messages, append, mergeActivity };
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export const ChatTimeline = ({
  conversation,
  youKey,
  onWhisper,
  canReport = true,
  emptyText = 'No messages yet. Say hello.',
}: {
  conversation: ReturnType<typeof useConversation>;
  youKey: string;
  onWhisper?: ((alias: string) => void) | undefined;
  canReport?: boolean;
  emptyText?: string;
}) => {
  const { query, messages, mergeActivity } = conversation;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const count = messages.length;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [count]);

  return (
    <div
      ref={scroller}
      onScroll={(event) => {
        const el = event.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      }}
      className="flex-1 space-y-3 overflow-y-auto px-1 py-4"
      aria-live="polite"
    >
      {query.hasNextPage && (
        <div className="text-center">
          <Button
            variant="quiet"
            loading={query.isFetchingNextPage}
            onClick={() => {
              stick.current = false;
              void query.fetchNextPage();
            }}
          >
            Load earlier messages
          </Button>
        </div>
      )}
      {query.isSuccess && count === 0 && (
        <p className="py-10 text-center text-muted">{emptyText}</p>
      )}
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const grouped =
          previous &&
          previous.sender.key === message.sender.key &&
          previous.kind === 'text' &&
          message.kind === 'text';
        return (
          <MessageRow
            key={message.id}
            message={message}
            mine={message.sender.key === youKey}
            grouped={Boolean(grouped)}
            onWhisper={onWhisper}
            canReport={canReport}
            onActivity={mergeActivity}
          />
        );
      })}
    </div>
  );
};

const MessageRow = ({
  message,
  mine,
  grouped,
  onWhisper,
  canReport,
  onActivity,
}: {
  message: Message;
  mine: boolean;
  grouped: boolean;
  onWhisper?: ((alias: string) => void) | undefined;
  canReport: boolean;
  onActivity: (activity: Activity) => void;
}) => {
  const reportMessage = useMutation({
    mutationFn: (reason: string) =>
      api.post('/v1/reports', { targetType: 'message', targetId: message.id, reason }),
    onSuccess: () => toast.success('Reported. Our team will take a look.'),
    onError: toastError,
  });

  if (message.kind === 'system' || message.kind === 'announcement') {
    return (
      <p
        className={clsx(
          'mx-auto w-fit max-w-md rounded-full px-4 py-1.5 text-center text-sm',
          message.kind === 'announcement' ? 'bg-ember/15 text-amber' : 'bg-raised text-muted',
        )}
      >
        {message.kind === 'announcement' && (
          <Sparkles className="mr-1.5 inline size-4" aria-hidden />
        )}
        {message.body}
      </p>
    );
  }

  if (message.kind === 'activity' && message.activity) {
    return (
      <ActivityCard activity={message.activity} host={message.sender.name} onChange={onActivity} />
    );
  }

  return (
    <div className={clsx('group flex gap-3', mine && 'flex-row-reverse', grouped && '-mt-2')}>
      <div className="w-9 shrink-0">
        {!grouped &&
          (message.sender.avatarUrl ? (
            <img
              src={message.sender.avatarUrl}
              alt=""
              className="size-9 rounded-full object-cover"
            />
          ) : (
            <span className="inline-block scale-90">
              <AuraAvatar seed={message.sender.name} />
            </span>
          ))}
      </div>
      <div className={clsx('flex max-w-[78%] flex-col', mine && 'items-end')}>
        {!grouped && (
          <div
            className={clsx(
              'mb-1 flex items-center gap-2 text-xs text-faint',
              mine && 'flex-row-reverse',
            )}
          >
            <span className="font-medium text-muted">{mine ? 'You' : message.sender.name}</span>
            {message.sender.role === 'host' && <Badge tone="ember">Host</Badge>}
            <span>{time(message.createdAt)}</span>
          </div>
        )}
        <p
          className={clsx(
            'rounded-2xl px-4 py-2.5 leading-relaxed break-words whitespace-pre-wrap',
            mine ? 'rounded-tr-md bg-ember text-ink' : 'rounded-tl-md bg-raised',
          )}
        >
          {message.body}
        </p>
        {!mine && (
          <div className="mt-1 flex gap-3 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            {onWhisper && message.sender.role !== 'system' && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-faint hover:text-cream"
                onClick={() => onWhisper(message.sender.name)}
              >
                <MessageCircle className="size-3.5" aria-hidden />
                Whisper
              </button>
            )}
            {canReport && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-faint hover:text-danger"
                onClick={() => {
                  const reason = window.prompt('What is wrong with this message?');
                  if (reason && reason.trim().length >= 3) reportMessage.mutate(reason.trim());
                }}
              >
                <Flag className="size-3.5" aria-hidden />
                Report
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const KIND_LABEL: Record<Activity['kind'], string> = {
  prompt: 'Conversation prompt',
  this_or_that: 'This or that',
  poll: 'Poll',
  intro_round: 'Introductions',
};

export const ActivityCard = ({
  activity,
  host,
  onChange,
}: {
  activity: Activity;
  host: string;
  onChange: (activity: Activity) => void;
}) => {
  const [text, setText] = useState('');
  const respond = useMutation({
    mutationFn: (body: { choice?: number; text?: string }) =>
      api.post<Activity>(`/v1/activities/${activity.id}/respond`, body),
    onSuccess: (updated) => {
      onChange(updated);
      setText('');
    },
    onError: toastError,
  });
  const textual = activity.kind === 'prompt' || activity.kind === 'intro_round';
  const total = activity.results.reduce((sum, value) => sum + value, 0);

  return (
    <article className="mx-auto w-full max-w-lg rounded-2xl border border-ember/40 bg-surface p-5">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-amber uppercase">
        <Sparkles className="size-3.5" aria-hidden />
        {KIND_LABEL[activity.kind]} from {host}
      </p>
      <h3 className="mt-2 font-display text-xl leading-snug">{activity.title}</h3>

      {!textual && (
        <div className="mt-4 space-y-2">
          {activity.options.map((option, index) => {
            const share = total ? Math.round(((activity.results[index] ?? 0) / total) * 100) : 0;
            const chosen = activity.myChoice === index;
            return (
              <button
                key={option}
                type="button"
                disabled={respond.isPending}
                onClick={() => respond.mutate({ choice: index })}
                className={clsx(
                  'relative w-full overflow-hidden rounded-xl border px-4 py-2.5 text-left text-sm transition-colors',
                  chosen ? 'border-amber' : 'border-line hover:border-faint',
                )}
              >
                {activity.myChoice !== null && (
                  <span
                    className="absolute inset-y-0 left-0 bg-ember/20"
                    style={{ width: `${share}%` }}
                    aria-hidden
                  />
                )}
                <span className="relative flex justify-between gap-3">
                  <span>{option}</span>
                  {activity.myChoice !== null && <span className="text-muted">{share}%</span>}
                </span>
              </button>
            );
          })}
          <p className="text-xs text-faint">
            {activity.responses} {activity.responses === 1 ? 'answer' : 'answers'}, anonymous
            {activity.myChoice === null && '. Vote to see results.'}
          </p>
        </div>
      )}

      {textual && (
        <div className="mt-4 space-y-3">
          {activity.answers.length > 0 && (
            <ul className="max-h-60 space-y-2 overflow-y-auto">
              {activity.answers.map((answer) => (
                <li
                  key={`${answer.alias}-${answer.text}`}
                  className="rounded-xl bg-raised px-3 py-2 text-sm"
                >
                  <span className="font-medium text-muted">{answer.alias}: </span>
                  {answer.text}
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) respond.mutate({ text: text.trim() });
            }}
          >
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={500}
              placeholder={activity.myAnswer ? 'Change your answer' : 'Your answer'}
              className="min-h-11 flex-1 rounded-full border border-line bg-ink px-4 text-sm placeholder:text-faint focus:border-amber focus:outline-none"
            />
            <Button type="submit" loading={respond.isPending} className="px-4!">
              Share
            </Button>
          </form>
        </div>
      )}
    </article>
  );
};

export const Composer = ({
  onSend,
  disabled,
  disabledReason,
  placeholder = 'Write a message',
}: {
  onSend: (body: string) => Promise<unknown>;
  disabled?: boolean;
  disabledReason?: string | null;
  placeholder?: string;
}) => {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [body]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setBody('');
    } catch (error) {
      toastError(error);
    } finally {
      setSending(false);
      field.current?.focus();
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) void submit(event);
  };

  if (disabled) {
    return (
      <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-center text-sm text-muted">
        {disabledReason ?? 'Messaging is closed here.'}
      </p>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-2"
    >
      <textarea
        ref={field}
        rows={1}
        value={body}
        maxLength={1000}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKey}
        placeholder={placeholder}
        aria-label={placeholder}
        className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-base placeholder:text-faint focus:outline-none"
      />
      <Button
        type="submit"
        aria-label="Send"
        loading={sending}
        disabled={!body.trim()}
        className="size-11 px-0!"
      >
        {!sending && <Send className="size-4" aria-hidden />}
      </Button>
    </form>
  );
};

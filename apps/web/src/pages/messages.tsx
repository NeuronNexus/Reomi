import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, EyeOff, Lock, MessagesSquare } from 'lucide-react';
import { Link, useParams } from 'react-router';
import type { Message, Thread } from '@reomi/shared';
import { AuraAvatar } from '../components/aura';
import { ChatTimeline, Composer, useConversation } from '../components/chat';
import { EmptyState, ErrorNotice, LinkButton, PageTitle, Spinner } from '../components/ui';
import { api } from '../lib/client';
import { timeAgo } from '../lib/format';

const Avatar = ({ thread }: { thread: Thread }) =>
  thread.other.avatarUrl ? (
    <img src={thread.other.avatarUrl} alt="" className="size-10 rounded-full object-cover" />
  ) : (
    <AuraAvatar seed={thread.other.name} />
  );

const ThreadList = ({ activeId }: { activeId?: string }) => {
  const threads = useQuery({
    queryKey: ['threads'],
    queryFn: () => api.get<Thread[]>('/v1/threads'),
  });
  if (threads.isPending) return <Spinner />;
  if (threads.isError) return <ErrorNotice error={threads.error} />;
  if (threads.data.length === 0) {
    return (
      <EmptyState
        title="No conversations yet"
        body="Whisper to someone from inside a room, or message a person after you both reveal."
        action={<LinkButton to="/my-rooms">Go to my rooms</LinkButton>}
      />
    );
  }
  return (
    <ul className="space-y-1">
      {threads.data.map((thread) => (
        <li key={thread.id}>
          <Link
            to={`/messages/${thread.id}`}
            className={clsx(
              'flex items-center gap-3 rounded-xl p-3 transition-colors',
              thread.id === activeId ? 'bg-raised' : 'hover:bg-raised/60',
            )}
          >
            <Avatar thread={thread} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-medium">
                {thread.kind === 'whisper' && (
                  <EyeOff className="size-3.5 text-faint" aria-label="Anonymous" />
                )}
                {thread.other.name}
              </p>
              <p className="truncate text-sm text-muted">
                {thread.kind === 'whisper' ? `In ${thread.roomTitle}` : 'Direct message'}
                {thread.lastMessage ? ` · ${thread.lastMessage}` : ''}
              </p>
            </div>
            {thread.lastMessageAt && (
              <span className="shrink-0 text-xs text-faint">{timeAgo(thread.lastMessageAt)}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
};

export const MessagesPage = () => (
  <div className="mx-auto max-w-2xl">
    <PageTitle
      title="Messages"
      subtitle="Anonymous whispers from your rooms, and direct messages with people you revealed to."
    />
    <ThreadList />
  </div>
);

export const ThreadPage = () => {
  const { id = '' } = useParams();
  const thread = useQuery({
    queryKey: ['thread', id],
    queryFn: () => api.get<Thread>(`/v1/threads/${id}`),
  });
  const conversation = useConversation('thread', id);

  if (thread.isPending) return <Spinner />;
  if (thread.isError) return <ErrorNotice error={thread.error} />;
  const data = thread.data;

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <aside className="hidden lg:block">
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl">
          <MessagesSquare className="size-5 text-amber" aria-hidden />
          Messages
        </h2>
        <ThreadList activeId={id} />
      </aside>
      <section className="-my-4 flex h-[calc(100dvh-12rem)] min-h-[28rem] flex-col md:-my-8 lg:h-[calc(100dvh-9rem)]">
        <header className="flex items-center gap-3 border-b border-line pb-3">
          <Link
            to="/messages"
            aria-label="All messages"
            className="text-muted hover:text-cream lg:hidden"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <Avatar thread={data} />
          <div className="min-w-0">
            <p className="truncate font-display text-xl">{data.other.name}</p>
            <p className="truncate text-xs text-muted">
              {data.kind === 'whisper' ? (
                <>
                  <Lock className="mr-1 inline size-3" aria-hidden />
                  Anonymous whisper in{' '}
                  <Link to={`/rooms/${data.roomId}/space`} className="hover:text-amber">
                    {data.roomTitle}
                  </Link>
                  {data.revealed
                    ? ' · you have revealed to each other'
                    : ' · you are ' + data.you.name}
                </>
              ) : (
                'You revealed to each other'
              )}
            </p>
          </div>
        </header>
        <ChatTimeline conversation={conversation} youKey={data.you.key} emptyText="Say hello." />
        <Composer
          placeholder={`Message ${data.other.name}`}
          onSend={async (body) => {
            conversation.append(await api.post<Message>(`/v1/threads/${id}/messages`, { body }));
          }}
        />
        {data.kind === 'whisper' && !data.revealed && (
          <p className="mt-2 text-xs text-faint">
            Still anonymous. Names and contact details are held back until you both reveal.
          </p>
        )}
      </section>
    </div>
  );
};

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeft,
  Eye,
  Heart,
  LogOut,
  MessageCircle,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ACTIVITY_LIBRARY, CONNECTION_STAGES } from '@reomi/shared';
import type { Message, Reveal, Space } from '@reomi/shared';
import { AuraAvatar } from '../components/aura';
import { ChatTimeline, Composer, useConversation } from '../components/chat';
import { StarPicker } from '../components/reputation';
import { Badge, Button, EmptyState, Input, LinkButton, Spinner, Textarea } from '../components/ui';
import { api } from '../lib/client';
import { shortDate, timeLeft } from '../lib/format';
import { STAGE_LABELS } from '../lib/labels';
import { toastError } from '../lib/upload';

type Panel = 'chat' | 'people' | 'reveals' | 'host';

export const RoomSpacePage = () => {
  const { id = '' } = useParams();
  const [panel, setPanel] = useState<Panel>('chat');
  const navigate = useNavigate();
  const space = useQuery({
    queryKey: ['space', id],
    queryFn: () => api.get<Space>(`/v1/rooms/${id}/space`),
  });
  const conversation = useConversation('room', id);

  const whisper = useMutation({
    mutationFn: (toAlias: string) =>
      api.post<{ threadId: string }>(`/v1/rooms/${id}/whispers`, { toAlias }),
    onSuccess: ({ threadId }) => navigate(`/messages/${threadId}`),
    onError: toastError,
  });

  if (space.isPending) return <Spinner />;
  if (space.isError) {
    return (
      <EmptyState
        title="You are not in this room"
        body="Only members who hold a seat, and the host, can enter."
        action={<LinkButton to={`/rooms/${id}`}>See the room</LinkButton>}
      />
    );
  }
  const data = space.data;
  const incoming = data.reveals.filter(
    (r) => r.direction === 'incoming' && r.status === 'pending',
  ).length;
  const muted = data.mutedUntil ? `You are muted until ${shortDate(data.mutedUntil)}.` : null;

  const tabs: { key: Panel; label: string; badge?: number }[] = [
    { key: 'chat', label: 'Chat' },
    { key: 'people', label: `People (${data.members.length})` },
    ...(data.isHost
      ? [{ key: 'host' as const, label: 'Host tools' }]
      : [{ key: 'reveals' as const, label: 'Reveals', badge: incoming }]),
  ];

  return (
    <div className="-my-4 flex flex-col md:-my-8">
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <Link
          to={data.isHost ? `/host/rooms/${id}` : '/my-rooms'}
          aria-label="Back"
          className="mt-1 text-muted hover:text-cream"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-3xl leading-tight">{data.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {data.isHost ? (
              'You are hosting'
            ) : (
              <>
                You are <span className="font-medium text-cream">{data.you.name}</span>
              </>
            )}
            {' · '}
            {data.live && data.endsAt
              ? timeLeft(data.endsAt)
              : data.ended
                ? 'This room has ended'
                : 'Not open yet'}
            {' · hosted by '}
            <Link to={`/hosts/${data.host.id}`} className="hover:text-amber">
              {data.host.displayName}
            </Link>
          </p>
        </div>
        {!data.isHost && data.live && <LeaveButton roomId={id} />}
      </header>

      <nav className="mb-3 flex gap-2 lg:hidden" aria-label="Room sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setPanel(tab.key)}
            className={clsx(
              'relative min-h-10 rounded-full border px-4 text-sm',
              panel === tab.key ? 'border-cream bg-cream text-ink' : 'border-line text-muted',
            )}
          >
            {tab.label}
            {Boolean(tab.badge) && (
              <span className="ml-1.5 rounded-full bg-ember px-1.5 text-xs text-ink">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section
          className={clsx(
            'flex h-[calc(100dvh-16rem)] min-h-[28rem] flex-col rounded-2xl border border-line bg-surface/40 p-3 lg:h-[calc(100dvh-12rem)]',
            panel !== 'chat' && 'hidden lg:flex',
          )}
        >
          <ChatTimeline
            conversation={conversation}
            youKey={data.you.key}
            onWhisper={data.live ? (alias) => whisper.mutate(alias) : undefined}
            emptyText={
              data.isHost
                ? 'Start the room with an activity or a welcome.'
                : 'Be the first to say hello.'
            }
          />
          {data.canRate && <RatePanel roomId={id} host={data.host.displayName} />}
          <Composer
            disabled={!data.live || Boolean(muted)}
            disabledReason={
              muted ??
              (data.ended
                ? 'This room has ended. Reveals and ratings stay open.'
                : 'The room is not open yet.')
            }
            placeholder={
              data.isHost ? `Message as ${data.host.displayName}` : `Message as ${data.you.name}`
            }
            onSend={async (body) => {
              conversation.append(await api.post<Message>(`/v1/rooms/${id}/messages`, { body }));
            }}
          />
          <p className="mt-2 px-1 text-xs text-faint">
            Names, photos and contact details are blocked before delivery. Use Reveal when you both
            want to know more.
          </p>
        </section>

        <aside className={clsx('space-y-6', panel === 'chat' && 'hidden lg:block')}>
          <div className={clsx(panel !== 'people' && 'hidden lg:block')}>
            <People space={data} onWhisper={(alias) => whisper.mutate(alias)} />
          </div>
          {!data.isHost && (
            <div className={clsx(panel !== 'reveals' && 'hidden lg:block')}>
              <Reveals space={data} />
            </div>
          )}
          {data.isHost && (
            <div className={clsx(panel !== 'host' && 'hidden lg:block')}>
              <HostTools space={data} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

const LeaveButton = ({ roomId }: { roomId: string }) => {
  const navigate = useNavigate();
  const leave = useMutation({
    mutationFn: () => api.post(`/v1/rooms/${roomId}/leave`),
    onSuccess: () => {
      toast.success('You left the room');
      return navigate('/my-rooms');
    },
    onError: toastError,
  });
  return (
    <Button
      variant="ghost"
      className="px-4!"
      loading={leave.isPending}
      onClick={() => {
        if (
          window.confirm(
            'Leave this room? Your ticket is not refunded and your seat goes to someone else.',
          )
        )
          leave.mutate();
      }}
    >
      <LogOut className="size-4" aria-hidden />
      Leave
    </Button>
  );
};

const People = ({ space, onWhisper }: { space: Space; onWhisper: (alias: string) => void }) => {
  const queryClient = useQueryClient();
  const [revealing, setRevealing] = useState<string | null>(null);
  const [announce, setAnnounce] = useState(false);
  const pendingWith = new Set(
    space.reveals.filter((r) => r.status === 'pending').map((r) => r.otherAlias),
  );

  const reveal = useMutation({
    mutationFn: (toAlias: string) =>
      api.post(`/v1/rooms/${space.roomId}/reveals`, { toAlias, announce }),
    onSuccess: () => {
      toast.success('Reveal request sent. Nothing is shared unless they accept.');
      setRevealing(null);
      return queryClient.invalidateQueries({ queryKey: ['space', space.roomId] });
    },
    onError: toastError,
  });

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-display text-xl">
        <Users className="size-5 text-amber" aria-hidden />
        In the room
      </h2>
      <ul className="mt-4 space-y-2">
        <li className="flex items-center gap-3 rounded-xl bg-raised/50 p-2">
          <AuraAvatar seed={space.host.displayName} />
          <span className="flex-1 truncate">{space.host.displayName}</span>
          <Badge tone="ember">Host</Badge>
          {!space.isHost && space.live && (
            <Button
              variant="quiet"
              className="px-2!"
              aria-label="Whisper to the host"
              onClick={() => onWhisper(space.host.displayName)}
            >
              <MessageCircle className="size-4" aria-hidden />
            </Button>
          )}
        </li>
        {space.members.length === 0 && (
          <li className="text-sm text-muted">Nobody has joined yet.</li>
        )}
        {space.members.map((member) => (
          <li key={member.alias} className="rounded-xl p-2 hover:bg-raised/50">
            <div className="flex items-center gap-3">
              <AuraAvatar seed={member.alias} />
              <span className="flex-1 truncate">{member.alias}</span>
              {member.isYou && <Badge tone="ember">You</Badge>}
              {member.revealed && (
                <Badge tone="success">
                  <Eye className="mr-1 size-3" aria-hidden />
                  Revealed
                </Badge>
              )}
              {!member.isYou && space.live && (
                <Button
                  variant="quiet"
                  className="px-2!"
                  aria-label={`Whisper to ${member.alias}`}
                  onClick={() => onWhisper(member.alias)}
                >
                  <MessageCircle className="size-4" aria-hidden />
                </Button>
              )}
              {!member.isYou &&
                !space.isHost &&
                space.live &&
                !member.revealed &&
                !pendingWith.has(member.alias) && (
                  <Button
                    variant="quiet"
                    className="px-2!"
                    aria-label={`Reveal to ${member.alias}`}
                    onClick={() => setRevealing(member.alias)}
                  >
                    <Heart className="size-4" aria-hidden />
                  </Button>
                )}
              {pendingWith.has(member.alias) && <Badge>Pending</Badge>}
            </div>
            {revealing === member.alias && (
              <div className="mt-3 space-y-3 rounded-xl border border-ember/40 p-3 text-sm">
                <p>
                  Ask <strong>{member.alias}</strong> to reveal? If they accept, you both see each
                  other's real profile.
                </p>
                <label className="flex items-center gap-2 text-muted">
                  <input
                    type="checkbox"
                    checked={announce}
                    onChange={(e) => setAnnounce(e.target.checked)}
                    className="size-4 accent-[#ff6a33]"
                  />
                  Celebrate in the room if we both agree
                </label>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    loading={reveal.isPending}
                    onClick={() => reveal.mutate(member.alias)}
                  >
                    Send request
                  </Button>
                  <Button variant="ghost" onClick={() => setRevealing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

const Reveals = ({ space }: { space: Space }) => (
  <section className="rounded-2xl border border-line bg-surface p-5">
    <h2 className="flex items-center gap-2 font-display text-xl">
      <Heart className="size-5 text-amber" aria-hidden />
      Reveals
    </h2>
    {space.reveals.length === 0 ? (
      <p className="mt-3 text-sm text-muted">
        When you click with someone, tap the heart next to their alias. Nobody's identity is shared
        unless both say yes.
      </p>
    ) : (
      <ul className="mt-4 space-y-3">
        {space.reveals.map((reveal) => (
          <RevealItem key={reveal.id} reveal={reveal} roomId={space.roomId} />
        ))}
      </ul>
    )}
  </section>
);

export const RevealItem = ({ reveal, roomId }: { reveal: Reveal; roomId?: string }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [announce, setAnnounce] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['space', roomId ?? reveal.roomId] }),
      queryClient.invalidateQueries({ queryKey: ['connections'] }),
    ]);

  const respond = useMutation({
    mutationFn: (accept: boolean) =>
      api.post(`/v1/reveals/${reveal.id}/respond`, { accept, announce }),
    onSuccess: (_, accept) => {
      toast.success(
        accept ? 'Revealed! You can now see each other.' : 'Declined. You both stay anonymous.',
      );
      return refresh();
    },
    onError: toastError,
  });
  const cancel = useMutation({
    mutationFn: () => api.delete(`/v1/reveals/${reveal.id}`),
    onSuccess: refresh,
    onError: toastError,
  });
  const confirm = useMutation({
    mutationFn: (stage: string) => api.post(`/v1/reveals/${reveal.id}/confirm`, { stage }),
    onSuccess: () => {
      toast.success('Thanks. It counts for your host once you both confirm.');
      return refresh();
    },
    onError: toastError,
  });
  const message = useMutation({
    mutationFn: () => api.post<{ threadId: string }>(`/v1/users/${reveal.profile!.userId}/dm`),
    onSuccess: ({ threadId }) => navigate(`/messages/${threadId}`),
    onError: toastError,
  });

  if (reveal.status === 'pending') {
    return reveal.direction === 'incoming' ? (
      <li className="rounded-xl border border-ember/50 p-3 text-sm">
        <p>
          <strong>{reveal.otherAlias}</strong> wants to reveal identities with you.
        </p>
        <label className="mt-2 flex items-center gap-2 text-muted">
          <input
            type="checkbox"
            checked={announce}
            onChange={(e) => setAnnounce(e.target.checked)}
            className="size-4 accent-[#ff6a33]"
          />
          Celebrate in the room if they asked to as well
        </label>
        <div className="mt-3 flex gap-2">
          <Button
            className="flex-1"
            loading={respond.isPending && respond.variables}
            onClick={() => respond.mutate(true)}
          >
            Reveal
          </Button>
          <Button
            variant="ghost"
            loading={respond.isPending && !respond.variables}
            onClick={() => respond.mutate(false)}
          >
            Not now
          </Button>
        </div>
      </li>
    ) : (
      <li className="flex items-center justify-between gap-3 rounded-xl bg-raised/50 p-3 text-sm">
        <span>
          Waiting for <strong>{reveal.otherAlias}</strong>
        </span>
        <Button
          variant="quiet"
          className="px-2!"
          loading={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          Cancel
        </Button>
      </li>
    );
  }

  const profile = reveal.profile;
  if (!profile) return null;
  return (
    <li className="rounded-xl border border-success/40 p-4">
      <div className="flex items-center gap-3">
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" className="size-14 rounded-full object-cover" />
        ) : (
          <AuraAvatar seed={profile.userId} size="lg" />
        )}
        <div className="min-w-0">
          <p className="font-display text-xl">{profile.fullName}</p>
          <p className="text-sm text-muted">
            {[profile.age, profile.city].filter(Boolean).join(' · ')}
            {' · was '}
            {reveal.otherAlias}
          </p>
        </div>
      </div>
      {profile.bio && <p className="mt-3 text-sm text-muted">{profile.bio}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="px-4!" loading={message.isPending} onClick={() => message.mutate()}>
          <MessageCircle className="size-4" aria-hidden />
          Message
        </Button>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        {reveal.youConfirmed ? (
          <p className="text-sm text-success">
            You confirmed: {STAGE_LABELS[reveal.stage ?? 'connection']}
            {reveal.theyConfirmed ? '. They did too.' : '. Waiting for them.'}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Did this room lead somewhere? Both confirmations count for your host.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CONNECTION_STAGES.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => confirm.mutate(stage)}
                  className="min-h-9 rounded-full border border-line px-3 text-xs text-muted hover:border-amber hover:text-cream"
                >
                  {STAGE_LABELS[stage]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </li>
  );
};

const RatePanel = ({ roomId, host }: { roomId: string; host: string }) => {
  const queryClient = useQueryClient();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const rate = useMutation({
    mutationFn: () => api.post(`/v1/rooms/${roomId}/rating`, { stars, comment }),
    onSuccess: () => {
      toast.success('Thanks for rating your host');
      return queryClient.invalidateQueries({ queryKey: ['space', roomId] });
    },
    onError: toastError,
  });
  return (
    <div className="mb-3 rounded-2xl border border-amber/50 bg-surface p-4">
      <p className="font-medium">How was {host}?</p>
      <p className="text-sm text-muted">
        Your rating helps others choose. It is shown with the total number of ratings.
      </p>
      <StarPicker value={stars} onChange={setStars} />
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={500}
        placeholder="Anything to add? (optional)"
        className="min-h-20!"
      />
      <Button
        className="mt-3"
        disabled={stars === 0}
        loading={rate.isPending}
        onClick={() => rate.mutate()}
      >
        Submit rating
      </Button>
    </div>
  );
};

const HostTools = ({ space }: { space: Space }) => {
  const [kind, setKind] = useState(space.activityKinds[0] ?? 'prompt');
  const [title, setTitle] = useState('');
  const [options, setOptions] = useState('');
  const launch = useMutation({
    mutationFn: (body: { kind: string; title: string; options: string[] }) =>
      api.post(`/v1/host/rooms/${space.roomId}/activities`, body),
    onSuccess: () => {
      toast.success('Activity started');
      setTitle('');
      setOptions('');
    },
    onError: toastError,
  });
  const library = ACTIVITY_LIBRARY.filter((item) => space.activityKinds.includes(item.kind));

  if (space.activityKinds.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-line p-5 text-sm text-muted">
        Activities are not included in this room's plan.
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-2xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-display text-xl">
        <Sparkles className="size-5 text-amber" aria-hidden />
        Start an activity
      </h2>
      {!space.live && <p className="text-sm text-muted">Activities run while the room is open.</p>}
      <div>
        <h3 className="text-sm text-faint">Ready to go</h3>
        <ul className="mt-2 space-y-2">
          {library.map((item) => (
            <li key={item.title}>
              <button
                type="button"
                disabled={!space.live || launch.isPending}
                onClick={() => launch.mutate(item)}
                className="w-full rounded-xl border border-line px-3 py-2 text-left text-sm hover:border-amber disabled:opacity-50"
              >
                <span className="text-xs text-faint uppercase">{item.kind.replace(/_/g, ' ')}</span>
                <span className="block">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <form
        className="space-y-3 border-t border-line pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          launch.mutate({
            kind,
            title: title.trim(),
            options: options
              .split('\n')
              .map((o) => o.trim())
              .filter(Boolean),
          });
        }}
      >
        <h3 className="flex items-center gap-2 text-sm text-faint">
          <Settings2 className="size-4" aria-hidden />
          Write your own
        </h3>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="w-full rounded-xl border border-line bg-ink px-3 py-2.5"
        >
          {space.activityKinds.map((value) => (
            <option key={value} value={value}>
              {value.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Question or title"
          maxLength={200}
        />
        {(kind === 'poll' || kind === 'this_or_that') && (
          <Textarea
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder={
              kind === 'this_or_that'
                ? 'Two options, one per line'
                : 'Two to six options, one per line'
            }
            className="min-h-24!"
          />
        )}
        <Button
          type="submit"
          disabled={!space.live || title.trim().length < 3}
          loading={launch.isPending}
        >
          Launch
        </Button>
      </form>
    </section>
  );
};

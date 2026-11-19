import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Clock, Sparkles, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useParams } from 'react-router';
import { toast } from 'sonner';
import { ApiRequestError, applyInput, formatPaise } from '@agnipath/shared';
import type { Lobby, MyApplication, RoomDetail } from '@agnipath/shared';
import { AuraAvatar, AuraPanel } from '../components/aura';
import { ApplicationBadge } from '../components/status';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  LinkButton,
  Spinner,
  Textarea,
} from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { shortDate, timeLeft } from '../lib/format';
import { CATEGORY_LABELS } from '../lib/labels';
import { usePayTicket } from '../lib/use-pay-ticket';

export const RoomPage = () => {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const room = useQuery({
    queryKey: ['room', id, session?.user.id],
    queryFn: () => api.get<RoomDetail>(`/v1/rooms/${id}`),
  });

  if (room.isPending) return <Spinner />;
  if (room.isError) {
    const missing = room.error instanceof ApiRequestError && room.error.status === 404;
    return missing ? (
      <EmptyState
        title="This room is not open"
        body="It may have ended, or the link may be wrong."
        action={<LinkButton to="/">Back to Explore</LinkButton>}
      />
    ) : (
      <ErrorNotice error={room.error} />
    );
  }

  const data = room.data;

  return (
    <article>
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-cream"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All rooms
      </Link>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div>
          <AuraPanel seed={data.id} animated className="relative h-44 rounded-2xl md:h-60" />
          <div className="mt-6">
            <Badge>{CATEGORY_LABELS[data.category]}</Badge>
            <h1 className="mt-3 font-display text-4xl leading-tight md:text-5xl">{data.title}</h1>
            <p className="mt-3 text-lg text-muted">{data.summary}</p>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-line p-5 sm:grid-cols-3">
            <Fact icon={<Users className="size-4" />} label="Seats">
              {data.seatsLeft} of {data.capacity} left
            </Fact>
            <Fact icon={<CalendarDays className="size-4" />} label="Room length">
              {data.durationDays} days
            </Fact>
            <Fact icon={<Clock className="size-4" />} label="Closes">
              {timeLeft(data.endsAt)}
            </Fact>
          </dl>

          <section className="mt-8">
            <h2 className="font-display text-2xl">What to expect</h2>
            <p className="mt-3 leading-relaxed whitespace-pre-line text-muted">
              {data.description}
            </p>
          </section>

          <section className="mt-8 rounded-2xl border border-line p-5">
            <h2 className="text-sm text-faint">Your host</h2>
            <p className="mt-1 font-display text-xl">{data.host.displayName}</p>
            <p className="text-sm text-muted">
              {data.host.roomsHosted} room{data.host.roomsHosted === 1 ? '' : 's'} hosted
            </p>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="font-display text-4xl">{formatPaise(data.ticketPricePaise)}</p>
            <p className="mt-1 text-sm text-muted">
              One-time ticket, charged only if the host accepts you.
            </p>
            <div className="mt-5">
              <RoomAction room={data} />
            </div>
          </div>
        </aside>
      </div>
    </article>
  );
};

const Fact = ({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) => (
  <div>
    <dt className="flex items-center gap-1.5 text-sm text-faint">
      {icon}
      {label}
    </dt>
    <dd className="mt-1 font-medium">{children}</dd>
  </div>
);

const RoomAction = ({ room }: { room: RoomDetail }) => {
  const { session, me } = useAuth();
  const location = useLocation();
  const application = room.myApplication;

  if (room.isHost) {
    return (
      <LinkButton to={`/host/rooms/${room.id}`} className="w-full">
        Manage this room
      </LinkButton>
    );
  }
  if (!session) {
    return (
      <LinkButton to={`/login?next=${encodeURIComponent(location.pathname)}`} className="w-full">
        Sign in to apply
      </LinkButton>
    );
  }
  if (me && !me.onboarded) {
    return (
      <LinkButton
        to={`/onboarding?next=${encodeURIComponent(location.pathname)}`}
        className="w-full"
      >
        Finish your profile to apply
      </LinkButton>
    );
  }
  if (application && !['withdrawn', 'expired'].includes(application.status)) {
    return <ApplicationState application={application} />;
  }
  if (room.seatsLeft === 0) {
    return <p className="text-sm text-muted">This room is full right now.</p>;
  }
  return (
    <>
      {application && (
        <div className="mb-4">
          <ApplicationBadge status={application.status} />
        </div>
      )}
      <ApplyForm roomId={room.id} />
    </>
  );
};

const ApplicationState = ({ application }: { application: MyApplication }) => {
  const payTicket = usePayTicket();
  const queryClient = useQueryClient();
  const withdraw = useMutation({
    mutationFn: () => api.delete(`/v1/applications/${application.id}`),
    onSuccess: () => {
      toast.success('Application withdrawn');
      return queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <ApplicationBadge status={application.status} />
      <p className="text-sm text-muted">
        You appear here as <span className="font-medium text-cream">{application.alias}</span>.
      </p>

      {application.status === 'pending' && (
        <>
          <p className="text-sm text-muted">The host is reviewing applications.</p>
          <Button
            variant="ghost"
            className="w-full"
            loading={withdraw.isPending}
            onClick={() => withdraw.mutate()}
          >
            Withdraw application
          </Button>
        </>
      )}

      {application.status === 'accepted' && (
        <>
          {application.paymentDueAt && (
            <p className="text-sm text-muted">
              Your seat is held until {shortDate(application.paymentDueAt)}.
            </p>
          )}
          <Button
            className="w-full"
            loading={payTicket.isPending}
            onClick={() => payTicket.mutate(application.id)}
          >
            Pay {formatPaise(application.ticketPricePaise)} to enter
          </Button>
        </>
      )}

      {application.status === 'joined' && (
        <LinkButton to={`/rooms/${application.roomId}/lobby`} className="w-full">
          Enter room
        </LinkButton>
      )}

      {application.status === 'rejected' && (
        <p className="text-sm text-muted">
          The host chose other applicants for this room. You have not been charged.
        </p>
      )}
    </div>
  );
};

const ApplyForm = ({ roomId }: { roomId: string }) => {
  const queryClient = useQueryClient();
  const form = useForm({ resolver: zodResolver(applyInput), defaultValues: { message: '' } });

  const apply = useMutation({
    mutationFn: (body: { message: string }) => api.post(`/v1/rooms/${roomId}/applications`, body),
    onSuccess: () => {
      toast.success('Application sent to the host');
      return queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => apply.mutate(values))} className="space-y-4">
      <Field
        label="Why this room?"
        error={form.formState.errors.message?.message}
        hint="The host sees this and an alias, never your name."
      >
        <Textarea
          placeholder="Say something that sounds like you. Avoid details that identify you."
          {...form.register('message')}
        />
      </Field>
      <Button type="submit" className="w-full" loading={apply.isPending}>
        Apply to join
      </Button>
    </form>
  );
};

export const LobbyPage = () => {
  const { id = '' } = useParams();
  const lobby = useQuery({
    queryKey: ['lobby', id],
    queryFn: () => api.get<Lobby>(`/v1/rooms/${id}/lobby`),
  });

  if (lobby.isPending) return <Spinner />;
  if (lobby.isError) return <ErrorNotice error={lobby.error} />;

  const { title, yourAlias, members, endsAt } = lobby.data;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/my-rooms"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-cream"
      >
        <ArrowLeft className="size-4" aria-hidden />
        My rooms
      </Link>
      <h1 className="font-display text-4xl leading-tight md:text-5xl">{title}</h1>
      <p className="mt-2 text-muted">
        {yourAlias ? (
          <>
            You are here as <span className="font-medium text-cream">{yourAlias}</span>.
          </>
        ) : (
          'You are hosting this room.'
        )}
        {endsAt && ` ${timeLeft(endsAt)}.`}
      </p>

      <section className="mt-8 rounded-2xl border border-line bg-surface p-6">
        <h2 className="flex items-center gap-2 font-display text-2xl">
          <Sparkles className="size-5 text-amber" aria-hidden />
          Conversation opens soon
        </h2>
        <p className="mt-2 text-muted">
          Your seat is confirmed. Group chat and identity reveals are the next features to arrive in
          rooms.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 font-display text-2xl">
          In the room <span className="text-faint">({members.length})</span>
        </h2>
        {members.length === 0 ? (
          <p className="text-muted">Nobody has joined yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {members.map((member) => (
              <li
                key={member.alias}
                className="flex items-center gap-3 rounded-xl border border-line p-3"
              >
                <AuraAvatar seed={member.alias} />
                <span>{member.alias}</span>
                {member.alias === yourAlias && <Badge tone="ember">You</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

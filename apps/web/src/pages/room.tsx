import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BellRing,
  CalendarDays,
  Clock,
  Info,
  Lock,
  Scale,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ApiRequestError, applyInput, formatPaise } from '@reomi/shared';
import type { MyApplication, RoomDetail } from '@reomi/shared';
import { AuraPanel } from '../components/aura';
import { HostBadges, Rating } from '../components/reputation';
import { RoomCard } from '../components/room-card';
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
import { opensIn, shortDate, timeLeft } from '../lib/format';
import { CATEGORY_LABELS } from '../lib/labels';
import { toastError } from '../lib/upload';
import { usePayTicket } from '../lib/use-pay-ticket';

export const RoomPage = () => {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const code = params.get('code') ?? undefined;
  const { session } = useAuth();
  const room = useQuery({
    queryKey: ['room', id, session?.user.id, code],
    queryFn: () => api.get<RoomDetail>(`/v1/rooms/${id}`, { code }),
  });

  if (room.isPending) return <Spinner />;
  if (room.isError) {
    const missing = room.error instanceof ApiRequestError && room.error.status === 404;
    return missing ? (
      <EmptyState
        title="This room is not open"
        body="It may have ended, the link may be wrong, or it is private and needs its invite code."
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
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge>{CATEGORY_LABELS[data.category]}</Badge>
            {data.visibility === 'private' && (
              <Badge>
                <Lock className="mr-1 size-3" aria-hidden />
                Private
              </Badge>
            )}
            {data.balanceMode === 'balanced' && (
              <Badge>
                <Scale className="mr-1 size-3" aria-hidden />
                Interest balanced
              </Badge>
            )}
            {data.admission === 'instant' && <Badge tone="ember">Instant seats</Badge>}
            {data.upcoming && <Badge tone="ember">{opensIn(data.startsAt)}</Badge>}
          </div>
          <h1 className="mt-3 font-display text-4xl leading-tight md:text-5xl">{data.title}</h1>
          <p className="mt-3 text-lg text-muted">{data.summary}</p>

          <dl className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-line p-5 sm:grid-cols-3">
            <Fact icon={<Users className="size-4" />} label="Seats">
              {data.seatsLeft} of {data.capacity} left
            </Fact>
            <Fact icon={<CalendarDays className="size-4" />} label="Room length">
              {data.durationDays} days
            </Fact>
            <Fact icon={<Clock className="size-4" />} label={data.upcoming ? 'Opens' : 'Closes'}>
              {data.upcoming ? shortDate(data.startsAt) : timeLeft(data.endsAt)}
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
            <Link
              to={`/hosts/${data.host.id}`}
              className="mt-1 block font-display text-2xl hover:text-amber"
            >
              {data.host.displayName}
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Rating value={data.host.rating} count={data.host.ratingCount} size="lg" />
              <HostBadges badges={data.host.badges} />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-faint">Rooms hosted</dt>
                <dd className="font-display text-2xl">{data.host.roomsHosted}</dd>
              </div>
              <div>
                <dt className="text-faint">Confirmed connections</dt>
                <dd className="font-display text-2xl">{data.host.verifiedConnections}</dd>
              </div>
              <div>
                <dt className="text-faint">Reviews</dt>
                <dd className="font-display text-2xl">{data.host.ratingCount}</dd>
              </div>
            </dl>
          </section>

          <section className="mt-8 rounded-2xl border border-line p-5 text-sm text-muted">
            <h2 className="flex items-center gap-2 font-medium text-cream">
              <ShieldCheck className="size-4 text-success" aria-hidden />
              How this room keeps you safe
            </h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>You appear under an alias that is only used in this room.</li>
              <li>Real names, photos and contact details are blocked before anyone sees them.</li>
              <li>Profiles are shown only when two people both agree to reveal.</li>
              {data.balanceMode === 'balanced' && (
                <li>
                  Admissions follow who people want to meet, so the room never tips heavily one way.
                </li>
              )}
            </ul>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="font-display text-4xl">{formatPaise(data.ticketPricePaise)}</p>
            <p className="mt-1 text-sm text-muted">
              One-time ticket, charged only once you have a seat.
            </p>
            <BalanceNotice room={data} />
            <div className="mt-5">
              <RoomAction room={data} code={code} />
            </div>
            <details className="mt-5 text-sm text-muted">
              <summary className="flex cursor-pointer items-center gap-1.5 text-faint hover:text-cream">
                <Info className="size-4" aria-hidden />
                Ticket terms
              </summary>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li>Access lasts until the room closes ({shortDate(data.endsAt)}).</li>
                <li>Not a subscription. You pay once for this room only.</li>
                <li>
                  {data.platformFeeBps / 100}% of the ticket is the platform fee, already included.
                  No other charges.
                </li>
                <li>
                  Full refund if the room closes before you get in or your seat cannot be honoured.
                </li>
              </ul>
            </details>
          </div>
        </aside>
      </div>

      {data.suggestions.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-2xl">Rooms where you would fit right now</h2>
          <p className="mt-1 text-muted">
            These rooms have space for people looking for what you are.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.suggestions.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
};

const BalanceNotice = ({ room }: { room: RoomDetail }) => {
  if (!room.balance || room.isHost) return null;
  return room.balance.ok ? (
    <p className="mt-4 flex gap-2 rounded-xl bg-success/10 p-3 text-sm text-success">
      <Scale className="mt-0.5 size-4 shrink-0" aria-hidden />
      This room is balanced for the people you want to meet.
    </p>
  ) : (
    <p className="mt-4 flex gap-2 rounded-xl bg-raised p-3 text-sm text-muted">
      <Scale className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
      {room.balance.message}
    </p>
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

const RoomAction = ({ room, code }: { room: RoomDetail; code: string | undefined }) => {
  const { session, me } = useAuth();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  const application = room.myApplication;

  if (room.isHost) {
    return (
      <div className="space-y-3">
        <LinkButton to={`/host/rooms/${room.id}`} className="w-full">
          Manage this room
        </LinkButton>
        {!room.upcoming && (
          <LinkButton to={`/rooms/${room.id}/space`} variant="ghost" className="w-full">
            Enter the room
          </LinkButton>
        )}
      </div>
    );
  }
  if (!session) {
    return (
      <LinkButton to={`/login?next=${encodeURIComponent(here)}`} className="w-full">
        Sign in to {room.upcoming ? 'join the waitlist' : 'apply'}
      </LinkButton>
    );
  }
  if (me && !me.onboarded) {
    return (
      <LinkButton to={`/onboarding?next=${encodeURIComponent(here)}`} className="w-full">
        Finish your profile first
      </LinkButton>
    );
  }
  if (room.upcoming) return <Waitlist room={room} />;
  if (application && !['withdrawn', 'expired', 'left'].includes(application.status)) {
    return <ApplicationState application={application} />;
  }
  if (room.seatsLeft === 0)
    return <p className="text-sm text-muted">This room is full right now.</p>;
  return (
    <>
      {application && (
        <div className="mb-4">
          <ApplicationBadge status={application.status} />
        </div>
      )}
      <ApplyForm room={room} code={code} />
    </>
  );
};

const Waitlist = ({ room }: { room: RoomDetail }) => {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      room.onWaitlist
        ? api.delete(`/v1/rooms/${room.id}/waitlist`)
        : api.post(`/v1/rooms/${room.id}/waitlist`),
    onSuccess: () => {
      toast.success(
        room.onWaitlist ? 'Removed from the waitlist' : 'We will tell you the moment it opens',
      );
      return queryClient.invalidateQueries({ queryKey: ['room', room.id] });
    },
    onError: toastError,
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Opens {shortDate(room.startsAt)}. {room.waitlistCount}{' '}
        {room.waitlistCount === 1 ? 'person is' : 'people are'} waiting.
      </p>
      <Button
        className="w-full"
        variant={room.onWaitlist ? 'ghost' : 'primary'}
        loading={toggle.isPending}
        onClick={() => toggle.mutate()}
      >
        <BellRing className="size-4" aria-hidden />
        {room.onWaitlist ? 'Leave the waitlist' : 'Join the waitlist'}
      </Button>
    </div>
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
    onError: toastError,
  });

  return (
    <div className="space-y-4">
      <ApplicationBadge status={application.status} />
      <p className="text-sm text-muted">
        You appear here as <span className="font-medium text-cream">{application.alias}</span>.
      </p>

      {application.status === 'pending' && (
        <>
          <p className="text-sm text-muted">
            {application.admissionNote ?? 'The host is reviewing applications.'}
          </p>
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
        <LinkButton to={`/rooms/${application.roomId}/space`} className="w-full">
          Enter room
        </LinkButton>
      )}

      {application.status === 'rejected' && (
        <p className="text-sm text-muted">
          The host chose other applicants for this room. You have not been charged.
        </p>
      )}
      {application.status === 'removed' && (
        <p className="text-sm text-muted">
          You were removed from this room for breaking the rules.
        </p>
      )}
    </div>
  );
};

const ApplyForm = ({ room, code }: { room: RoomDetail; code: string | undefined }) => {
  const queryClient = useQueryClient();
  const form = useForm({
    resolver: zodResolver(applyInput),
    defaultValues: { message: '', inviteCode: code ?? '' },
  });

  const apply = useMutation({
    mutationFn: (body: { message: string; inviteCode?: string | undefined }) =>
      api.post<MyApplication>(`/v1/rooms/${room.id}/applications`, {
        message: body.message,
        ...(body.inviteCode ? { inviteCode: body.inviteCode } : {}),
      }),
    onSuccess: (result) => {
      toast.success(
        result.status === 'accepted'
          ? 'You have a seat. Pay to enter.'
          : 'Application sent to the host',
      );
      return queryClient.invalidateQueries();
    },
    onError: toastError,
  });

  return (
    <form onSubmit={form.handleSubmit((values) => apply.mutate(values))} className="space-y-4">
      {room.inviteCodeRequired && !code && (
        <Field label="Invite code" error={form.formState.errors.inviteCode?.message}>
          <input
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 font-mono tracking-widest uppercase focus:border-amber focus:outline-none"
            {...form.register('inviteCode')}
          />
        </Field>
      )}
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
        {room.admission === 'instant' ? 'Get a seat' : 'Apply to join'}
      </Button>
    </form>
  );
};

/** Old links pointed at the lobby; the room space replaced it. */
export const LobbyRedirect = () => {
  const { id = '' } = useParams();
  return <Navigate to={`/rooms/${id}/space`} replace />;
};

/** `/join/CODE` share links. */
export const JoinByCodePage = () => {
  const { code = '' } = useParams();
  const found = useQuery({
    queryKey: ['by-code', code],
    queryFn: () => api.get<{ roomId: string }>(`/v1/rooms/by-code/${encodeURIComponent(code)}`),
    retry: false,
  });
  if (found.isPending) return <Spinner />;
  if (found.isError) {
    return (
      <EmptyState
        title="That invite code did not work"
        body="Check it with the host. Codes are eight letters and numbers."
        action={<LinkButton to="/">Explore rooms</LinkButton>}
      />
    );
  }
  return (
    <Navigate
      to={`/rooms/${found.data.roomId}?code=${encodeURIComponent(code.toUpperCase())}`}
      replace
    />
  );
};

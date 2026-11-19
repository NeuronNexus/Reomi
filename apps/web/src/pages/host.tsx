import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, Clock3, Copy, Lock, Scale, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  createRoomInput,
  FEATURE,
  formatPaise,
  hostApplicationInput,
  ROOM_CATEGORIES,
} from '@reomi/shared';
import type {
  Applicant,
  Checkout,
  HostApplicationInput,
  HostRoom,
  HostRoomDashboard,
  Paginated,
  Plan,
} from '@reomi/shared';
import { AuraAvatar } from '../components/aura';
import { ApplicationBadge } from '../components/status';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  LinkButton,
  PageTitle,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';
import { useAuth } from '../lib/auth';
import { CheckoutCancelled, useCheckout } from '../lib/checkout';
import { api } from '../lib/client';
import { shortDate, timeLeft } from '../lib/format';
import { CATEGORY_LABELS, GENDER_LABELS, INTEREST_LABELS } from '../lib/labels';
import { toastError } from '../lib/upload';

/* Host home --------------------------------------------------------------------------------- */

const usePayPlan = () => {
  const pay = useCheckout();
  const queryClient = useQueryClient();
  return async (checkout: Checkout) => {
    try {
      const result = await pay(checkout);
      if (result.processing) toast.info('Payment received. Your room opens once it is confirmed.');
      else if (result.status === 'paid') toast.success('Your room is live');
      return result;
    } catch (error) {
      if (error instanceof CheckoutCancelled) {
        toast.info('Payment cancelled. You can finish it from Hosting.');
        return null;
      }
      throw error;
    } finally {
      await queryClient.invalidateQueries();
    }
  };
};

const statusBadge = (room: HostRoom) => {
  if (room.status === 'pending_payment') return <Badge tone="ember">Awaiting payment</Badge>;
  if (room.upcoming) return <Badge tone="ember">Scheduled</Badge>;
  return room.live ? <Badge tone="success">Live</Badge> : <Badge>Ended</Badge>;
};

export const HostHomePage = () => {
  const { me } = useAuth();
  const verified = me?.host?.status === 'verified';
  const rooms = useQuery({
    queryKey: ['host-rooms'],
    queryFn: () => api.get<HostRoom[]>('/v1/host/rooms'),
    enabled: Boolean(me?.host),
  });

  if (!me?.host) {
    return (
      <EmptyState
        title="Host your own room"
        body="Hosts run the room, set the ticket price and bring people together. Apply once and our team will review you."
        action={<LinkButton to="/host/apply">Apply to host</LinkButton>}
      />
    );
  }

  return (
    <>
      <PageTitle
        title="Hosting"
        subtitle={`You host as ${me.host.displayName}.`}
        action={verified ? <LinkButton to="/host/new">Create room</LinkButton> : undefined}
      />
      {!verified && <VerificationNotice />}
      {rooms.isPending && <Spinner />}
      {rooms.isError && <ErrorNotice error={rooms.error} />}
      {verified && rooms.data?.length === 0 && (
        <EmptyState
          title="No rooms yet"
          body="Pick a plan and open your first room."
          action={<LinkButton to="/host/new">Create room</LinkButton>}
        />
      )}
      <ul className="grid gap-4 md:grid-cols-2">
        {rooms.data?.map((room) => (
          <li key={room.id}>
            <Link
              to={`/host/rooms/${room.id}`}
              className="block rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-faint"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-xl leading-snug">{room.title}</h2>
                {statusBadge(room)}
              </div>
              <p className="mt-1 text-sm text-muted">
                {room.planName} plan
                {room.live && room.endsAt && `, ${timeLeft(room.endsAt)}`}
              </p>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <Stat label="To review" value={room.counts.pending} />
                <Stat label="Awaiting pay" value={room.counts.accepted} />
                <Stat label="Joined" value={`${room.counts.joined}/${room.capacity}`} />
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
};

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <dt className="text-faint">{label}</dt>
    <dd className="font-display text-2xl">{value}</dd>
  </div>
);

const VerificationNotice = () => {
  const { me } = useAuth();
  const status = me?.host?.status;
  const copy = {
    pending: 'Your application is with our team. You can create rooms once it is approved.',
    rejected: 'Your application was not approved this time.',
    revoked: 'Your host access has been removed. Contact support for details.',
    verified: '',
  }[status ?? 'verified'];

  return (
    <div className="mb-6 flex gap-3 rounded-2xl border border-line bg-surface p-5">
      <Clock3 className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
      <div>
        <p>{copy}</p>
        {me?.host?.reviewNote && (
          <p className="mt-1 text-sm text-muted">Note from the team: {me.host.reviewNote}</p>
        )}
      </div>
    </div>
  );
};

/* Applying to host -------------------------------------------------------------------------- */

export const HostApplyPage = () => {
  const { me } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = me?.host?.status;

  const form = useForm<HostApplicationInput>({
    resolver: zodResolver(hostApplicationInput),
    defaultValues: { displayName: me?.host?.displayName ?? '', about: '' },
  });

  const submit = useMutation({
    mutationFn: (values: HostApplicationInput) => api.post('/v1/host/application', values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success('Application sent');
      await navigate('/host');
    },
  });

  if (status === 'verified') {
    return (
      <EmptyState
        title="You are a verified host"
        action={<LinkButton to="/host/new">Create room</LinkButton>}
      />
    );
  }
  if (status === 'pending' || status === 'revoked') {
    return (
      <div className="mx-auto max-w-xl">
        <PageTitle title="Host verification" />
        <VerificationNotice />
      </div>
    );
  }

  const { errors } = form.formState;

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title="Become a host"
        subtitle="Only verified hosts can create rooms. Tell us about yourself and our team will review your application."
      />
      {status === 'rejected' && <VerificationNotice />}
      <form onSubmit={form.handleSubmit((values) => submit.mutate(values))} className="space-y-5">
        <Field
          label="Host name"
          error={errors.displayName?.message}
          hint="Public on your rooms. Your real name stays private."
        >
          <Input {...form.register('displayName')} />
        </Field>
        <Field label="Why do you want to host?" error={errors.about?.message}>
          <Textarea
            placeholder="What kind of rooms would you run? Have you brought people together before?"
            {...form.register('about')}
          />
        </Field>
        {submit.isError && <ErrorNotice error={submit.error} />}
        <Button type="submit" loading={submit.isPending}>
          Submit application
        </Button>
      </form>
    </div>
  );
};

/* Creating a room --------------------------------------------------------------------------- */

const roomForm = createRoomInput
  .omit({ planId: true, ticketPricePaise: true, scheduledFor: true })
  .extend({
    ticketRupees: z.coerce
      .number<string>('Enter an amount')
      .min(1, 'Ticket must be at least ₹1')
      .max(100_000, 'Ticket cannot exceed ₹1,00,000'),
    opensAt: z.string().optional(),
  });

type RoomFormInput = z.input<typeof roomForm>;
type RoomFormValues = z.output<typeof roomForm>;

export const NewRoomPage = () => {
  const navigate = useNavigate();
  const payPlan = usePayPlan();
  const [planId, setPlanId] = useState<string | null>(null);

  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/v1/plans') });
  const plan = plans.data?.find((entry) => entry.id === planId);

  const form = useForm<RoomFormInput, unknown, RoomFormValues>({
    resolver: zodResolver(roomForm),
    defaultValues: {
      title: '',
      summary: '',
      description: '',
      category: 'dating',
      ticketRupees: '',
      visibility: 'public',
      admission: 'approval',
      balanceMode: 'balanced',
      opensAt: '',
    },
  });
  const category = form.watch('category');

  const create = useMutation({
    mutationFn: async ({ ticketRupees, opensAt, ...values }: RoomFormValues) => {
      const created = await api.post<{ roomId: string; checkout: Checkout }>('/v1/host/rooms', {
        ...values,
        planId,
        ticketPricePaise: Math.round(ticketRupees * 100),
        scheduledFor: opensAt ? new Date(opensAt).toISOString() : null,
      });
      await payPlan(created.checkout);
      return created.roomId;
    },
    onSuccess: (roomId) => navigate(`/host/rooms/${roomId}`),
  });

  if (plans.isPending) return <Spinner />;
  if (plans.isError) return <ErrorNotice error={plans.error} />;

  if (!plan) {
    return (
      <>
        <PageTitle
          title="Choose a plan"
          subtitle="Your plan sets how long the room runs, how many people it holds and which tools you get."
        />
        <div className="grid gap-5 md:grid-cols-3">
          {plans.data.map((entry) => (
            <PlanCard key={entry.id} plan={entry} onChoose={() => setPlanId(entry.id)} />
          ))}
        </div>
      </>
    );
  }

  const { errors } = form.formState;

  return (
    <div className="mx-auto max-w-xl">
      <button
        type="button"
        onClick={() => setPlanId(null)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-cream"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Change plan
      </button>
      <PageTitle
        title="Your room"
        subtitle={`${plan.name} plan: ${plan.durationDays} days, up to ${plan.capacity} people.`}
      />
      <form onSubmit={form.handleSubmit((values) => create.mutate(values))} className="space-y-5">
        <Field label="Room name" error={errors.title?.message}>
          <Input {...form.register('title')} />
        </Field>
        <Field
          label="One-line summary"
          error={errors.summary?.message}
          hint="Shown on the room card."
        >
          <Input {...form.register('summary')} />
        </Field>
        <Field label="Description" error={errors.description?.message}>
          <Textarea {...form.register('description')} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Category" error={errors.category?.message}>
            <Select {...form.register('category')}>
              {ROOM_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Ticket price (₹)"
            error={errors.ticketRupees?.message}
            hint={`Up to ${formatPaise(plan.maxTicketPaise)} (reference ${formatPaise(plan.referenceTicketPaise)} + 10%). Platform fee ${plan.platformFeeBps / 100}%.`}
          >
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              max={plan.maxTicketPaise / 100}
              {...form.register('ticketRupees')}
            />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Who can find it"
            hint="Private rooms are only reachable with your invite code."
          >
            <Select {...form.register('visibility')}>
              <option value="public">Listed on Explore</option>
              <option value="private">Private, invite code only</option>
            </Select>
          </Field>
          <Field
            label="How people get in"
            hint="Instant: seats are offered automatically within the balance rules."
          >
            <Select {...form.register('admission')}>
              <option value="approval">I review every request</option>
              <option value="instant">Instant seats</option>
            </Select>
          </Field>
        </div>
        <Field
          label="Interest balancing"
          hint={
            category === 'dating'
              ? 'Dating rooms always balance who wants to meet whom. This cannot be turned off.'
              : 'Keeps the room from tipping heavily toward one kind of seeker.'
          }
        >
          <Select {...form.register('balanceMode')} disabled={category === 'dating'}>
            <option value="balanced">Balanced admissions</option>
            <option value="open">Off, admit anyone</option>
          </Select>
        </Field>
        <Field
          label="Open later (optional)"
          hint="Scheduled rooms show on Explore as opening soon, with a waitlist."
        >
          <Input type="datetime-local" {...form.register('opensAt')} />
        </Field>
        {create.isError && <ErrorNotice error={create.error} />}
        <Button type="submit" className="w-full" loading={create.isPending}>
          Pay {formatPaise(plan.pricePaise)} and open room
        </Button>
        <p className="text-center text-sm text-faint">
          The room goes live as soon as the plan is paid, or at the time you scheduled.
        </p>
      </form>
    </div>
  );
};

const PlanCard = ({ plan, onChoose }: { plan: Plan; onChoose: () => void }) => (
  <section
    className={clsx(
      'flex flex-col rounded-2xl border bg-surface p-6',
      plan.slug === 'growth' ? 'border-ember' : 'border-line',
    )}
  >
    <h2 className="font-display text-2xl">{plan.name}</h2>
    <p className="mt-1 min-h-10 text-sm text-muted">{plan.description}</p>
    <p className="mt-4 font-display text-4xl">{formatPaise(plan.pricePaise)}</p>
    <p className="mt-1 text-sm text-muted">
      {plan.durationDays} days, up to {plan.capacity} people
    </p>
    <p className="mt-1 text-sm text-faint">Tickets up to {formatPaise(plan.maxTicketPaise)}</p>
    <ul className="mt-5 flex-1 space-y-2.5 text-sm">
      {plan.features.map((feature) => (
        <li key={feature.key} className="flex items-start gap-2">
          {feature.isLive ? (
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          ) : (
            <Clock3 className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
          )}
          <span className={feature.isLive ? '' : 'text-faint'}>
            {feature.name}
            {!feature.isLive && ' (coming soon)'}
          </span>
        </li>
      ))}
    </ul>
    <Button
      variant={plan.slug === 'growth' ? 'primary' : 'ghost'}
      className="mt-6 w-full"
      onClick={onChoose}
    >
      Choose {plan.name}
    </Button>
  </section>
);

/* Running a room ---------------------------------------------------------------------------- */

export const HostRoomPage = () => {
  const { id = '' } = useParams();
  const { me } = useAuth();
  const payPlan = usePayPlan();

  const dashboard = useQuery({
    queryKey: ['host-room', id],
    queryFn: () => api.get<HostRoomDashboard>(`/v1/host/rooms/${id}`),
  });
  const applicants = useQuery({
    queryKey: ['host-room-applicants', id],
    queryFn: () =>
      api.get<Paginated<Applicant>>(`/v1/host/rooms/${id}/applications`, { pageSize: 100 }),
  });

  const finishPayment = useMutation({
    mutationFn: async () => payPlan(await api.post<Checkout>(`/v1/host/rooms/${id}/checkout`)),
    onError: (error) => toast.error(error.message),
  });
  const queryClient = useQueryClient();
  const endRoom = useMutation({
    mutationFn: () => api.post(`/v1/host/rooms/${id}/end`),
    onSuccess: () => {
      toast.success('Room ended. Members can now rate it.');
      return queryClient.invalidateQueries();
    },
    onError: toastError,
  });

  if (dashboard.isPending) return <Spinner />;
  if (dashboard.isError) return <ErrorNotice error={dashboard.error} />;

  const room = dashboard.data;
  const canDecide = me?.host?.status === 'verified' && room.live;

  return (
    <>
      <Link
        to="/host"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-cream"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Hosting
      </Link>
      <PageTitle
        title={room.title}
        subtitle={`${room.planName} plan, ${formatPaise(room.ticketPricePaise)} ticket${
          room.live && room.endsAt ? `, ${timeLeft(room.endsAt)}` : ''
        }`}
        action={
          room.live ? (
            <div className="flex flex-wrap gap-2">
              <LinkButton to={`/rooms/${room.id}/space`}>Enter room</LinkButton>
              <Button
                variant="danger"
                loading={endRoom.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      'End this room now? Chat closes and members are asked to rate it.',
                    )
                  )
                    endRoom.mutate();
                }}
              >
                End room
              </Button>
            </div>
          ) : undefined
        }
      />

      {room.status !== 'pending_payment' && <ShareRoom room={room} />}

      {room.status === 'pending_payment' && (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-ember/50 bg-surface p-5">
          <p>This room is not live yet. Pay for the plan to open it.</p>
          <Button loading={finishPayment.isPending} onClick={() => finishPayment.mutate()}>
            Finish payment
          </Button>
        </div>
      )}

      <dl className="mb-8 grid grid-cols-2 gap-4 rounded-2xl border border-line bg-surface p-5 md:grid-cols-4">
        <Stat label="To review" value={room.counts.pending} />
        <Stat label="Awaiting payment" value={room.counts.accepted} />
        <Stat label="Joined" value={room.counts.joined} />
        <Stat
          label="Seats left"
          value={room.capacity - room.counts.joined - room.counts.accepted}
        />
        <Stat label="Waitlist" value={room.waitlistCount} />
        <Stat label="Mutual reveals" value={room.connections.reveals} />
        <Stat label="Confirmed connections" value={room.connections.verified} />
        <Stat
          label="Rating"
          value={room.ratings.average ? `${room.ratings.average} (${room.ratings.count})` : '—'}
        />
      </dl>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section>
          <h2 className="mb-4 font-display text-2xl">Applicants</h2>
          {applicants.isPending && <Spinner />}
          {applicants.isError && <ErrorNotice error={applicants.error} />}
          {applicants.data?.items.length === 0 && (
            <EmptyState title="No applicants yet" body="They will appear here as they apply." />
          )}
          <ul className="space-y-3">
            {applicants.data?.items.map((applicant) => (
              <ApplicantRow
                key={applicant.id}
                roomId={room.id}
                applicant={applicant}
                canDecide={canDecide}
              />
            ))}
          </ul>
        </section>
        <Insights room={room} />
      </div>
    </>
  );
};

const ApplicantRow = ({
  roomId,
  applicant,
  canDecide,
}: {
  roomId: string;
  applicant: Applicant;
  canDecide: boolean;
}) => {
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (decision: 'accept' | 'reject') =>
      api.post(`/v1/host/rooms/${roomId}/applications/${applicant.id}/decision`, { decision }),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (error) => toast.error(error.message),
  });

  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <AuraAvatar seed={applicant.alias} />
        <div className="min-w-40 flex-1">
          <p className="font-medium">{applicant.alias}</p>
          <p className="text-sm text-muted">
            {applicant.gender ? GENDER_LABELS[applicant.gender] : 'Not stated'}, wants to meet{' '}
            {applicant.interestedIn
              .map((value) => INTEREST_LABELS[value])
              .join(', ')
              .toLowerCase()}
          </p>
        </div>
        <ApplicationBadge status={applicant.status} viewer="host" />
      </div>
      <p className="mt-3 text-muted">{applicant.message}</p>
      {applicant.status === 'accepted' && applicant.paymentDueAt && (
        <p className="mt-2 text-sm text-faint">
          Seat held until {shortDate(applicant.paymentDueAt)}
        </p>
      )}
      {applicant.status === 'pending' && !applicant.admissible && (
        <p className="mt-3 flex gap-2 rounded-xl bg-raised p-3 text-sm text-muted">
          <Scale className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
          {applicant.blockedReason} You can accept once the room balances.
        </p>
      )}
      {applicant.status === 'pending' && canDecide && (
        <div className="mt-4 flex gap-3">
          <Button
            loading={decide.isPending && decide.variables === 'accept'}
            disabled={decide.isPending || !applicant.admissible}
            onClick={() => decide.mutate('accept')}
          >
            Accept
          </Button>
          <Button
            variant="ghost"
            loading={decide.isPending && decide.variables === 'reject'}
            disabled={decide.isPending}
            onClick={() => decide.mutate('reject')}
          >
            Decline
          </Button>
        </div>
      )}
    </li>
  );
};

const Locked = ({ title }: { title: string }) => (
  <div className="rounded-2xl border border-dashed border-line p-5">
    <h3 className="flex items-center gap-2 font-medium">
      <Lock className="size-4 text-faint" aria-hidden />
      {title}
    </h3>
    <p className="mt-1 text-sm text-muted">Not included in this room's plan.</p>
  </div>
);

const GROUP_LABELS = { women: 'Women', men: 'Men', non_binary: 'Non-binary' } as const;

const BalancePanel = ({ room }: { room: HostRoomDashboard }) => {
  const groups = room.balance.groups.filter((g) => g.demand > 0 || g.supply > 0);
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="flex items-center gap-2 font-medium">
        <Scale className="size-4 text-amber" aria-hidden />
        Room balance
        <Badge tone={room.balance.healthy ? 'success' : 'ember'}>
          {room.balance.healthy ? 'Healthy' : 'Strained'}
        </Badge>
      </h3>
      <p className="mt-1 text-sm text-faint">
        {room.balanceMode === 'balanced'
          ? 'Seekers of a group are paused when they outnumber that group by more than two to one.'
          : 'Balancing is off for this room.'}
      </p>
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nobody holds a seat yet.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {groups.map((g) => (
            <li key={g.group} className="flex justify-between gap-3">
              <span>{GROUP_LABELS[g.group]}</span>
              <span className="text-muted">
                {g.supply} here · {g.demand} looking
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const ShareRoom = ({ room }: { room: HostRoomDashboard }) => {
  const link = `${window.location.origin}/join/${room.inviteCode}`;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Could not copy. Select it instead.');
    }
  };
  return (
    <div className="mb-8 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-5">
      <Share2 className="size-5 text-amber" aria-hidden />
      <div className="min-w-48 flex-1">
        <p className="font-medium">
          {room.visibility === 'private'
            ? 'Private room: share the code to let people in'
            : 'Invite people'}
        </p>
        <p className="mt-1 font-mono text-lg tracking-widest">{room.inviteCode}</p>
      </div>
      <Button variant="ghost" className="px-4!" onClick={() => void copy(room.inviteCode, 'Code')}>
        <Copy className="size-4" aria-hidden />
        Code
      </Button>
      <Button variant="ghost" className="px-4!" onClick={() => void copy(link, 'Link')}>
        <Copy className="size-4" aria-hidden />
        Link
      </Button>
    </div>
  );
};

const Insights = ({ room }: { room: HostRoomDashboard }) => (
  <aside className="space-y-4">
    <h2 className="font-display text-2xl">Insights</h2>
    <BalancePanel room={room} />

    {room.entitlements.includes(FEATURE.analyticsDetailed) && room.demand ? (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <h3 className="font-medium">Who wants to meet whom</h3>
        <p className="mt-1 text-sm text-faint">Across active applicants</p>
        {room.demand.seeking.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No data yet.</p>
        ) : (
          <>
            <Bars
              title="Seeking"
              rows={room.demand.seeking.map((row) => ({
                label: INTEREST_LABELS[row.interest],
                count: row.count,
              }))}
            />
            <Bars
              title="Identify as"
              rows={room.demand.gender.map((row) => ({
                label: GENDER_LABELS[row.gender],
                count: row.count,
              }))}
            />
          </>
        )}
      </div>
    ) : (
      <Locked title="Detailed analytics" />
    )}

    {room.entitlements.includes(FEATURE.analyticsAdvanced) && room.funnel ? (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <h3 className="font-medium">Funnel and earnings</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Applied" value={room.funnel.applied} />
          <Row label="Accepted" value={room.funnel.accepted} />
          <Row label="Joined" value={room.funnel.joined} />
          <Row label="Ticket sales" value={formatPaise(room.funnel.grossPaise)} />
          <Row label="Platform fee" value={formatPaise(room.funnel.platformFeePaise)} />
          <Row label="Your share" value={formatPaise(room.funnel.hostEarningsPaise)} strong />
        </dl>
      </div>
    ) : (
      <Locked title="Advanced analytics" />
    )}
  </aside>
);

const Row = ({
  label,
  value,
  strong,
}: {
  label: string;
  value: string | number;
  strong?: boolean;
}) => (
  <div className="flex justify-between gap-4">
    <dt className="text-muted">{label}</dt>
    <dd className={strong ? 'font-semibold text-amber' : ''}>{value}</dd>
  </div>
);

const Bars = ({ title, rows }: { title: string; rows: { label: string; count: number }[] }) => {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="mt-4">
      <h4 className="text-sm text-faint">{title}</h4>
      <ul className="mt-2 space-y-2">
        {rows.map((row) => (
          <li key={row.label} className="text-sm">
            <div className="flex justify-between">
              <span>{row.label}</span>
              <span className="text-muted">{row.count}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-ember"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

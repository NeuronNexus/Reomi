import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellOff, Crown, Star, Trophy } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { formatPaise } from '@reomi/shared';
import type {
  HostProfile,
  LeaderboardEntry,
  Paginated,
  Plan,
  RoomCard as Room,
} from '@reomi/shared';
import { AuraAvatar, AuraPanel } from '../components/aura';
import { HostBadges, Rating } from '../components/reputation';
import { RoomCard } from '../components/room-card';
import { Button, EmptyState, ErrorNotice, LinkButton, PageTitle, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { timeAgo, timeLeft } from '../lib/format';
import { CATEGORY_LABELS } from '../lib/labels';
import { toastError } from '../lib/upload';

export const HostProfilePage = () => {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ['host-profile', id, session?.user.id],
    queryFn: () => api.get<HostProfile>(`/v1/hosts/${id}`),
  });

  const follow = useMutation({
    mutationFn: (on: boolean) =>
      on ? api.post(`/v1/hosts/${id}/follow`) : api.delete(`/v1/hosts/${id}/follow`),
    onSuccess: (_, on) => {
      toast.success(on ? 'You will hear when this host opens a room' : 'Unfollowed');
      return queryClient.invalidateQueries({ queryKey: ['host-profile', id] });
    },
    onError: toastError,
  });

  if (profile.isPending) return <Spinner />;
  if (profile.isError) return <ErrorNotice error={profile.error} />;
  const { host, stats, about } = profile.data;
  const totalRatings = stats.ratingDistribution.reduce((a, b) => a + b, 0);

  return (
    <article>
      <Link
        to="/leaderboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-cream"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Top hosts
      </Link>
      <header className="relative overflow-hidden rounded-3xl border border-line p-6 md:p-10">
        <AuraPanel seed={host.id} animated className="absolute inset-0 opacity-40" />
        <div className="relative flex flex-wrap items-end gap-6">
          <div className="min-w-0 flex-1">
            {stats.rank && (
              <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-ink/70 px-3 py-1 text-sm text-amber backdrop-blur">
                <Trophy className="size-4" aria-hidden />#{stats.rank} on the leaderboard
              </p>
            )}
            <h1 className="font-display text-4xl leading-tight md:text-6xl">{host.displayName}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Rating value={host.rating} count={host.ratingCount} size="lg" />
              <HostBadges badges={host.badges} />
            </div>
          </div>
          {!profile.data.isYou && (
            <Button
              variant={profile.data.isFollowing ? 'ghost' : 'primary'}
              loading={follow.isPending}
              onClick={() => {
                if (!session) {
                  void navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
                  return;
                }
                follow.mutate(!profile.data.isFollowing);
              }}
            >
              {profile.data.isFollowing ? (
                <BellOff className="size-4" aria-hidden />
              ) : (
                <Bell className="size-4" aria-hidden />
              )}
              {profile.data.isFollowing ? 'Following' : 'Follow for new rooms'}
            </Button>
          )}
        </div>
      </header>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-line bg-surface p-5 md:grid-cols-5">
        <Stat label="Rooms hosted" value={stats.roomsHosted} />
        <Stat label="Participants" value={stats.participantsServed} />
        <Stat label="Confirmed connections" value={stats.verifiedConnections} />
        <Stat label="Mutual reveals" value={stats.revealsFacilitated} />
        <Stat label="Followers" value={stats.followers} />
      </dl>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-10">
          <section>
            <h2 className="font-display text-2xl">About</h2>
            <p className="mt-2 leading-relaxed whitespace-pre-line text-muted">{about}</p>
          </section>
          {profile.data.live.length > 0 && (
            <section>
              <h2 className="mb-4 font-display text-2xl">Open now</h2>
              <div className="grid gap-5 sm:grid-cols-2">
                {profile.data.live.map((room) => (
                  <RoomCard key={room.id} room={room} />
                ))}
              </div>
            </section>
          )}
          {profile.data.upcoming.length > 0 && (
            <section>
              <h2 className="mb-4 font-display text-2xl">Opening soon</h2>
              <div className="grid gap-5 sm:grid-cols-2">
                {profile.data.upcoming.map((room) => (
                  <RoomCard key={room.id} room={room} />
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-4 font-display text-2xl">What people said</h2>
            {profile.data.reviews.length === 0 ? (
              <p className="text-muted">
                No written reviews yet. Ratings appear after each room ends.
              </p>
            ) : (
              <ul className="space-y-3">
                {profile.data.reviews.map((review) => (
                  <li
                    key={`${review.createdAt}-${review.comment}`}
                    className="rounded-2xl border border-line p-4"
                  >
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex gap-0.5" aria-label={`${review.stars} stars`}>
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star
                            key={i}
                            className={
                              i < review.stars ? 'size-4 fill-amber text-amber' : 'size-4 text-line'
                            }
                            aria-hidden
                          />
                        ))}
                      </span>
                      <span className="text-faint">{timeAgo(review.createdAt)}</span>
                    </div>
                    <p className="mt-2">{review.comment}</p>
                    <p className="mt-1 text-xs text-faint">{review.roomTitle}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-medium">Rating breakdown</h2>
            <p className="mt-1 text-sm text-faint">
              From {totalRatings} participant{totalRatings === 1 ? '' : 's'} after rooms ended
            </p>
            <ul className="mt-4 space-y-2">
              {[5, 4, 3, 2, 1].map((stars) => {
                const count = stats.ratingDistribution[stars - 1] ?? 0;
                return (
                  <li key={stars} className="flex items-center gap-2 text-sm">
                    <span className="w-6 text-muted">{stars}★</span>
                    <span className="h-2 flex-1 rounded-full bg-raised">
                      <span
                        className="block h-full rounded-full bg-amber"
                        style={{ width: `${totalRatings ? (count / totalRatings) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="w-6 text-right text-faint">{count}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          {profile.data.past.length > 0 && (
            <div className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="font-medium">Past rooms</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {profile.data.past.map((room) => (
                  <li key={room.id} className="flex justify-between gap-3">
                    <span className="truncate">{room.title}</span>
                    <span className="shrink-0 text-faint">{room.participants} joined</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </article>
  );
};

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <dt className="text-sm text-faint">{label}</dt>
    <dd className="font-display text-3xl">{value}</dd>
  </div>
);

export const LeaderboardPage = () => {
  const board = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => api.get<LeaderboardEntry[]>('/v1/leaderboard'),
  });
  return (
    <>
      <PageTitle
        title="Top hosts"
        subtitle="Ranked on ratings, confirmed connections relative to room size, completed rooms, consistency and keeping to the rules. Paying for a bigger plan does not buy a place here."
      />
      {board.isPending && <Spinner />}
      {board.isError && <ErrorNotice error={board.error} />}
      {board.data?.length === 0 && (
        <EmptyState
          title="No ranked hosts yet"
          body="Hosts appear here once they have run a room."
          action={<LinkButton to="/host">Become a host</LinkButton>}
        />
      )}
      <ol className="space-y-3">
        {board.data?.map((entry) => (
          <li key={entry.host.id}>
            <Link
              to={`/hosts/${entry.host.id}`}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-faint"
            >
              <span className="grid w-10 place-items-center font-display text-3xl text-faint">
                {entry.rank <= 3 ? (
                  <Crown
                    className={entry.rank === 1 ? 'size-7 text-amber' : 'size-6 text-muted'}
                    aria-label={`Rank ${entry.rank}`}
                  />
                ) : (
                  entry.rank
                )}
              </span>
              <AuraAvatar seed={entry.host.id} size="lg" />
              <div className="min-w-48 flex-1">
                <p className="font-display text-xl">{entry.host.displayName}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Rating value={entry.host.rating} count={entry.host.ratingCount} />
                  <HostBadges badges={entry.host.badges} compact />
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-4 text-right text-sm">
                <div>
                  <dt className="text-faint">Rooms</dt>
                  <dd className="font-medium">{entry.stats.roomsHosted}</dd>
                </div>
                <div>
                  <dt className="text-faint">Connections</dt>
                  <dd className="font-medium">{entry.stats.verifiedConnections}</dd>
                </div>
                <div>
                  <dt className="text-faint">Score</dt>
                  <dd className="font-medium text-amber">{entry.stats.score}</dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
};

export const ComparePage = () => {
  const [params] = useSearchParams();
  const ids = params.get('ids') ?? '';
  const rooms = useQuery({
    queryKey: ['compare', ids],
    queryFn: () => api.get<Paginated<Room>>('/v1/rooms', { ids, pageSize: 6 }),
    enabled: ids.length > 0,
  });

  if (!ids)
    return (
      <EmptyState
        title="Pick rooms to compare"
        action={<LinkButton to="/">Explore rooms</LinkButton>}
      />
    );
  if (rooms.isPending) return <Spinner />;
  if (rooms.isError) return <ErrorNotice error={rooms.error} />;
  const list = rooms.data.items;

  const rows: { label: string; render: (room: Room) => React.ReactNode }[] = [
    {
      label: 'Host',
      render: (room) => (
        <Link to={`/hosts/${room.host.id}`} className="hover:text-amber">
          {room.host.displayName}
        </Link>
      ),
    },
    {
      label: 'Ticket',
      render: (room) => (
        <span className="font-display text-2xl">{formatPaise(room.ticketPricePaise)}</span>
      ),
    },
    {
      label: 'Host rating',
      render: (room) => <Rating value={room.host.rating} count={room.host.ratingCount} />,
    },
    { label: 'Confirmed connections', render: (room) => room.host.verifiedConnections },
    { label: 'Rooms hosted', render: (room) => room.host.roomsHosted },
    { label: 'Room length', render: (room) => `${room.durationDays} days` },
    {
      label: 'Time left',
      render: (room) => (room.upcoming ? 'Not open yet' : timeLeft(room.endsAt)),
    },
    { label: 'Seats left', render: (room) => `${room.seatsLeft} of ${room.capacity}` },
    { label: 'Category', render: (room) => CATEGORY_LABELS[room.category] },
    {
      label: 'Fit for you',
      render: (room) =>
        room.fit === 'good' ? 'Balanced for you' : room.fit === 'paused' ? 'Paused for now' : '—',
    },
  ];

  return (
    <>
      <PageTitle
        title="Compare rooms"
        subtitle="A higher price is not automatically a better room. Look at the host's record too."
      />
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="p-4 font-normal text-faint" scope="col">
                <span className="sr-only">Detail</span>
              </th>
              {list.map((room) => (
                <th key={room.id} scope="col" className="p-4 align-top">
                  <Link
                    to={`/rooms/${room.id}`}
                    className="font-display text-xl leading-snug hover:text-amber"
                  >
                    {room.title}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-line/60 last:border-0">
                <th scope="row" className="p-4 font-normal text-faint">
                  {row.label}
                </th>
                {list.map((room) => (
                  <td key={room.id} className="p-4">
                    {row.render(room)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td />
              {list.map((room) => (
                <td key={room.id} className="p-4">
                  <LinkButton to={`/rooms/${room.id}`} className="w-full">
                    View room
                  </LinkButton>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
};

export const PricingPage = () => {
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/v1/plans') });
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title="Fair pricing"
        subtitle="Hosts pay for a plan to run a room. Members pay one ticket for one room, never a subscription. Here is exactly how prices are kept fair."
      />
      {plans.isPending && <Spinner />}
      {plans.data && (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-faint">
                <th className="p-4 font-normal">Plan</th>
                <th className="p-4 font-normal">Host pays</th>
                <th className="p-4 font-normal">Room</th>
                <th className="p-4 font-normal">Reference ticket</th>
                <th className="p-4 font-normal">Ticket cap</th>
              </tr>
            </thead>
            <tbody>
              {plans.data.map((plan) => (
                <tr key={plan.id} className="border-b border-line/60 last:border-0">
                  <td className="p-4 font-medium">{plan.name}</td>
                  <td className="p-4">{formatPaise(plan.pricePaise)}</td>
                  <td className="p-4 text-muted">
                    {plan.durationDays} days, {plan.capacity} people
                  </td>
                  <td className="p-4">{formatPaise(plan.referenceTicketPaise)}</td>
                  <td className="p-4 text-amber">{formatPaise(plan.maxTicketPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="mt-8 space-y-4 text-muted">
        <h2 className="font-display text-2xl text-cream">How the cap works</h2>
        <p>
          Every plan publishes a reference ticket price. A host can price a group room up to 10%
          above that reference, and no higher. There are no extra mandatory charges: the ticket is
          the whole price, and the platform fee is already inside it.
        </p>
        <p>
          You always see the ticket price, how long access lasts and the refund terms before you
          pay. If a room closes before you get in, or your seat cannot be honoured, the ticket is
          refunded.
        </p>
      </section>
    </div>
  );
};

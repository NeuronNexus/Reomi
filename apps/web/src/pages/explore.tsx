import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { KeyRound, Scale, Search, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ROOM_CATEGORIES } from '@reomi/shared';
import type { Paginated, RoomCard as Room } from '@reomi/shared';
import { AuraPanel } from '../components/aura';
import { RoomCard } from '../components/room-card';
import { Button, EmptyState, ErrorNotice, Input, LinkButton, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { CATEGORY_LABELS } from '../lib/labels';
import type { RoomCategory } from '../lib/labels';

const PAGE_SIZE = 24;
type When = 'live' | 'upcoming';

export const ExplorePage = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [category, setCategory] = useState<RoomCategory | undefined>();
  const [when, setWhen] = useState<When>('live');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [compare, setCompare] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const q = useDeferredValue(search.trim());

  const rooms = useQuery({
    queryKey: ['rooms', { category, q, page, when, signedIn: Boolean(session) }],
    queryFn: () =>
      api.get<Paginated<Room>>('/v1/rooms', { category, q, page, when, pageSize: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

  const findByCode = useMutation({
    mutationFn: () =>
      api.get<{ roomId: string }>(`/v1/rooms/by-code/${encodeURIComponent(code.trim())}`),
    onSuccess: ({ roomId }) =>
      navigate(`/rooms/${roomId}?code=${encodeURIComponent(code.trim().toUpperCase())}`),
    onError: () => toast.error('No room with that code. Check it with the host.'),
  });

  const choose = (next: RoomCategory | undefined) => {
    setCategory(next);
    setPage(1);
  };

  const toggleCompare = (id: string) =>
    setCompare((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= 3
          ? current
          : [...current, id],
    );

  const pages = rooms.data ? Math.ceil(rooms.data.total / PAGE_SIZE) : 1;

  return (
    <>
      <section className="relative -mx-4 -mt-8 mb-10 overflow-hidden px-4 pt-14 pb-12 md:-mt-12 md:pt-24 md:pb-16">
        <AuraPanel
          seed="hero-glow"
          animated
          className="absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_50%_100%_at_50%_0%,black,transparent)]"
        />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-end">
          <div className="max-w-3xl">
            <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-balance md:text-7xl">
              Meet the vibe before the face.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Anonymous rooms run by hosts who know how to get people talking. Rooms stay balanced
              by who wants to meet whom, and nobody sees a name or photo unless you both say yes.
            </p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim().length >= 4) findByCode.mutate();
            }}
            className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur"
          >
            <label htmlFor="invite-code" className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4 text-amber" aria-hidden />
              Have an invite code?
            </label>
            <div className="mt-3 flex gap-2">
              <Input
                id="invite-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="e.g. 7F3K9QAB"
                maxLength={12}
                className="font-mono tracking-widest uppercase"
              />
              <Button type="submit" loading={findByCode.isPending} className="px-4!">
                Go
              </Button>
            </div>
          </form>
        </div>
      </section>

      <section aria-label="Find a room" className="mb-8 space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div
            className="flex w-fit rounded-full border border-line p-1"
            role="tablist"
            aria-label="When"
          >
            {(['live', 'upcoming'] as const).map((value) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={when === value}
                onClick={() => {
                  setWhen(value);
                  setPage(1);
                }}
                className={clsx(
                  'min-h-9 rounded-full px-4 text-sm transition-colors',
                  when === value ? 'bg-cream text-ink' : 'text-muted hover:text-cream',
                )}
              >
                {value === 'live' ? 'Open now' : 'Opening soon'}
              </button>
            ))}
          </div>
          <div className="relative md:ml-auto md:w-72">
            <Search
              className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search rooms"
              placeholder="Search rooms"
              className="pl-10!"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <CategoryChip active={!category} onClick={() => choose(undefined)}>
            All rooms
          </CategoryChip>
          {ROOM_CATEGORIES.map((value) => (
            <CategoryChip key={value} active={category === value} onClick={() => choose(value)}>
              {CATEGORY_LABELS[value]}
            </CategoryChip>
          ))}
        </div>
      </section>

      {rooms.isPending && <Spinner label="Loading rooms" />}
      {rooms.isError && <ErrorNotice error={rooms.error} />}
      {rooms.data?.items.length === 0 && (
        <EmptyState
          title={when === 'live' ? 'No rooms match yet' : 'Nothing scheduled yet'}
          body={
            when === 'live'
              ? 'Try another category, check what is opening soon, or start the first one yourself.'
              : 'Hosts announce rooms here before they open. Follow a host to hear first.'
          }
          action={
            <LinkButton to="/leaderboard" variant="ghost">
              See top hosts
            </LinkButton>
          }
        />
      )}
      {rooms.data && rooms.data.items.length > 0 && (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.data.items.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                selected={compare.includes(room.id)}
                onToggleCompare={() => toggleCompare(room.id)}
              />
            ))}
          </div>
          {pages > 1 && (
            <nav className="mt-10 flex items-center justify-center gap-4" aria-label="Pagination">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-sm text-muted">
                Page {page} of {pages}
              </span>
              <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </nav>
          )}
        </>
      )}

      {compare.length > 0 && (
        <div className="fixed inset-x-4 bottom-20 z-30 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-amber/60 bg-surface p-3 shadow-2xl lg:bottom-6">
          <Scale className="ml-1 size-5 shrink-0 text-amber" aria-hidden />
          <p className="flex-1 text-sm">
            {compare.length} room{compare.length === 1 ? '' : 's'} selected
            <span className="text-faint"> (up to 3)</span>
          </p>
          <Button
            variant="quiet"
            aria-label="Clear"
            className="px-2!"
            onClick={() => setCompare([])}
          >
            <X className="size-4" aria-hidden />
          </Button>
          <LinkButton
            to={`/compare?ids=${compare.join(',')}`}
            className={clsx(compare.length < 2 && 'pointer-events-none opacity-50')}
          >
            Compare
          </LinkButton>
        </div>
      )}
    </>
  );
};

const CategoryChip = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={clsx(
      'min-h-10 shrink-0 rounded-full border px-4 text-sm transition-colors',
      active
        ? 'border-cream bg-cream text-ink'
        : 'border-line text-muted hover:border-faint hover:text-cream',
    )}
  >
    {children}
  </button>
);

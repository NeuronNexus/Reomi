import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { ROOM_CATEGORIES } from '@agnipath/shared';
import type { Paginated, RoomCard as Room } from '@agnipath/shared';
import { AuraPanel } from '../components/aura';
import { RoomCard } from '../components/room-card';
import { Button, EmptyState, ErrorNotice, Input, Spinner } from '../components/ui';
import { api } from '../lib/client';
import { CATEGORY_LABELS } from '../lib/labels';
import type { RoomCategory } from '../lib/labels';

const PAGE_SIZE = 24;

export const ExplorePage = () => {
  const [category, setCategory] = useState<RoomCategory | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDeferredValue(search.trim());

  const rooms = useQuery({
    queryKey: ['rooms', { category, q, page }],
    queryFn: () =>
      api.get<Paginated<Room>>('/v1/rooms', { category, q, page, pageSize: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

  const choose = (next: RoomCategory | undefined) => {
    setCategory(next);
    setPage(1);
  };

  const pages = rooms.data ? Math.ceil(rooms.data.total / PAGE_SIZE) : 1;

  return (
    <>
      <section className="relative -mx-4 -mt-8 mb-10 overflow-hidden px-4 pt-16 pb-14 md:-mt-12 md:pt-24 md:pb-20">
        <AuraPanel
          seed="hero-glow"
          animated
          className="absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_50%_100%_at_50%_0%,black,transparent)]"
        />
        <div className="relative max-w-3xl">
          <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-balance md:text-7xl">
            Meet the vibe before the face.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Join anonymous rooms run by people who know how to get a conversation going. Nobody sees
            a name or a photo unless you both say yes.
          </p>
        </div>
      </section>

      <section
        aria-label="Find a room"
        className="mb-8 flex flex-col gap-4 md:flex-row md:items-center"
      >
        <div className="flex gap-2 overflow-x-auto pb-1 md:flex-1">
          <CategoryChip active={!category} onClick={() => choose(undefined)}>
            All rooms
          </CategoryChip>
          {ROOM_CATEGORIES.map((value) => (
            <CategoryChip key={value} active={category === value} onClick={() => choose(value)}>
              {CATEGORY_LABELS[value]}
            </CategoryChip>
          ))}
        </div>
        <div className="relative md:w-72">
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
      </section>

      {rooms.isPending && <Spinner label="Loading rooms" />}
      {rooms.isError && <ErrorNotice error={rooms.error} />}
      {rooms.data?.items.length === 0 && (
        <EmptyState
          title="No rooms match yet"
          body="Try another category, or start the first one yourself."
        />
      )}
      {rooms.data && rooms.data.items.length > 0 && (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.data.items.map((room) => (
              <RoomCard key={room.id} room={room} />
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

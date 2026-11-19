import clsx from 'clsx';
import { CalendarClock, Lock, Scale } from 'lucide-react';
import { Link } from 'react-router';
import { formatPaise } from '@reomi/shared';
import type { RoomCard as Room } from '@reomi/shared';
import { opensIn, timeLeft } from '../lib/format';
import { CATEGORY_LABELS } from '../lib/labels';
import { AuraPanel } from './aura';
import { HostLine } from './reputation';
import { Badge } from './ui';

export const RoomCard = ({
  room,
  selected,
  onToggleCompare,
}: {
  room: Room;
  selected?: boolean;
  onToggleCompare?: (() => void) | undefined;
}) => {
  const full = room.seatsLeft === 0;
  return (
    <article
      className={clsx(
        'group relative flex flex-col overflow-hidden rounded-2xl border bg-surface transition-colors',
        selected ? 'border-amber' : 'border-line hover:border-faint',
      )}
    >
      <Link to={`/rooms/${room.id}`} className="absolute inset-0 z-0" aria-label={room.title} />
      <div className="pointer-events-none relative h-32">
        <AuraPanel seed={room.id} className="absolute inset-0" />
        <span className="absolute top-3 left-3 flex gap-1.5">
          <span className="rounded-full bg-ink/70 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
            {CATEGORY_LABELS[room.category]}
          </span>
          {room.visibility === 'private' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-ink/70 px-2.5 py-0.5 text-xs backdrop-blur">
              <Lock className="size-3" aria-hidden />
              Private
            </span>
          )}
        </span>
        {room.upcoming && (
          <span className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-full bg-ink/80 px-2.5 py-1 text-xs text-amber backdrop-blur">
            <CalendarClock className="size-3.5" aria-hidden />
            {opensIn(room.startsAt)}
          </span>
        )}
      </div>
      <div className="pointer-events-none relative flex flex-1 flex-col p-5">
        <h2 className="font-display text-xl leading-snug group-hover:text-amber">{room.title}</h2>
        <p className="mt-2 line-clamp-2 text-sm text-muted">{room.summary}</p>
        <div className="pointer-events-auto mt-3">
          <HostLine host={room.host} />
        </div>
        {room.fit && (
          <p
            className={clsx(
              'mt-3 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs',
              room.fit === 'good' ? 'bg-success/15 text-success' : 'bg-raised text-muted',
            )}
          >
            <Scale className="size-3.5" aria-hidden />
            {room.fit === 'good' ? 'Balanced for you' : 'Paused for your preferences'}
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <div>
            <span className="font-display text-2xl">{formatPaise(room.ticketPricePaise)}</span>
            <span className="ml-1 text-xs text-faint">one time</span>
          </div>
          <div className="text-right text-xs text-muted">
            {room.upcoming ? (
              <p>{room.waitlistCount} waiting</p>
            ) : full ? (
              <Badge tone="danger">Full</Badge>
            ) : (
              <p>
                {room.seatsLeft} of {room.capacity} seats left
              </p>
            )}
            <p className="mt-1 text-faint">
              {room.upcoming ? `${room.durationDays} days` : timeLeft(room.endsAt)}
            </p>
          </div>
        </div>
        {onToggleCompare && (
          <label className="pointer-events-auto mt-4 flex w-fit cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={Boolean(selected)}
              onChange={onToggleCompare}
              className="size-4 accent-[#ff6a33]"
            />
            Compare
          </label>
        )}
      </div>
    </article>
  );
};

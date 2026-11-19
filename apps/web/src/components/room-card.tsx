import { Link } from 'react-router';
import { formatPaise } from '@agnipath/shared';
import type { RoomCard as Room } from '@agnipath/shared';
import { timeLeft } from '../lib/format';
import { CATEGORY_LABELS } from '../lib/labels';
import { AuraPanel } from './aura';
import { Badge } from './ui';

export const RoomCard = ({ room }: { room: Room }) => {
  const full = room.seatsLeft === 0;
  return (
    <Link
      to={`/rooms/${room.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-faint"
    >
      <div className="relative h-36">
        <AuraPanel seed={room.id} className="absolute inset-0" />
        <span className="absolute top-3 left-3 rounded-full bg-ink/70 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
          {CATEGORY_LABELS[room.category]}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h2 className="font-display text-xl leading-snug group-hover:text-amber">{room.title}</h2>
        <p className="mt-2 line-clamp-2 text-sm text-muted">{room.summary}</p>
        <p className="mt-3 text-sm text-faint">
          Hosted by <span className="text-muted">{room.host.displayName}</span>
        </p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <div>
            <span className="font-display text-2xl">{formatPaise(room.ticketPricePaise)}</span>
            <span className="ml-1 text-xs text-faint">one time</span>
          </div>
          <div className="text-right text-xs text-muted">
            {full ? (
              <Badge tone="danger">Full</Badge>
            ) : (
              <p>
                {room.seatsLeft} of {room.capacity} seats left
              </p>
            )}
            <p className="mt-1 text-faint">{timeLeft(room.endsAt)}</p>
          </div>
        </div>
      </div>
    </Link>
  );
};

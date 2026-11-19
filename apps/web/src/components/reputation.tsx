import clsx from 'clsx';
import { BadgeCheck, Crown, Flame, Star, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import type { HostSummary } from '@reomi/shared';

const BADGES = {
  verified: { label: 'Verified host', icon: BadgeCheck, className: 'text-success' },
  top_host: { label: 'Top host', icon: Flame, className: 'text-amber' },
  celebrity: { label: 'Celebrity host', icon: Crown, className: 'text-amber' },
  rising: { label: 'Rising host', icon: TrendingUp, className: 'text-ember' },
} as const;

export const HostBadges = ({
  badges,
  compact = false,
}: {
  badges: HostSummary['badges'];
  compact?: boolean;
}) => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    {badges.map((badge) => {
      const { label, icon: Icon, className } = BADGES[badge];
      return compact ? (
        <Icon key={badge} className={clsx('size-4', className)} aria-label={label}>
          <title>{label}</title>
        </Icon>
      ) : (
        <span
          key={badge}
          className="inline-flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-xs text-muted"
        >
          <Icon className={clsx('size-3.5', className)} aria-hidden />
          {label}
        </span>
      );
    })}
  </span>
);

export const Rating = ({
  value,
  count,
  size = 'sm',
}: {
  value: number | null;
  count: number;
  size?: 'sm' | 'lg';
}) =>
  value === null ? (
    <span className={clsx('text-faint', size === 'lg' ? 'text-base' : 'text-xs')}>New host</span>
  ) : (
    <span
      className={clsx('inline-flex items-center gap-1', size === 'lg' ? 'text-base' : 'text-xs')}
    >
      <Star
        className={clsx('fill-amber text-amber', size === 'lg' ? 'size-5' : 'size-3.5')}
        aria-hidden
      />
      <span className="font-medium text-cream">{value.toFixed(1)}</span>
      <span className="text-faint">({count})</span>
    </span>
  );

export const HostLine = ({ host }: { host: HostSummary }) => (
  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
    <Link
      to={`/hosts/${host.id}`}
      className="text-muted hover:text-amber"
      onClick={(e) => e.stopPropagation()}
    >
      {host.displayName}
    </Link>
    <HostBadges badges={host.badges} compact />
    <Rating value={host.rating} count={host.ratingCount} />
    {host.verifiedConnections > 0 && (
      <span className="text-xs text-faint">{host.verifiedConnections} connections</span>
    )}
  </span>
);

export const StarPicker = ({
  value,
  onChange,
}: {
  value: number;
  onChange: (stars: number) => void;
}) => (
  <div className="flex gap-1" role="radiogroup" aria-label="Rating">
    {[1, 2, 3, 4, 5].map((stars) => (
      <button
        key={stars}
        type="button"
        role="radio"
        aria-checked={value === stars}
        aria-label={`${stars} star${stars === 1 ? '' : 's'}`}
        onClick={() => onChange(stars)}
        className="grid size-11 place-items-center"
      >
        <Star
          className={clsx('size-7', stars <= value ? 'fill-amber text-amber' : 'text-line')}
          aria-hidden
        />
      </button>
    ))}
  </div>
);

import clsx from 'clsx';

/**
 * The product has no photos, so identity is drawn instead: every room and alias gets a warm
 * gradient derived from its id or name. Same seed, same aura.
 */

const hash = (seed: string): number => {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value = Math.imul(value ^ seed.charCodeAt(index), 16777619);
  }
  return value >>> 0;
};

const PALETTES = [
  ['#ff6a33', '#ffc56b', '#7a1f4e'],
  ['#ff4d6d', '#ff9e5e', '#3a1c71'],
  ['#ffb347', '#ff5e62', '#5b2a86'],
  ['#ff8552', '#e8467c', '#20306e'],
  ['#f7b267', '#f25c54', '#1f4e5f'],
  ['#ffd166', '#ef476f', '#2b2d6e'],
];

const auraStyle = (seed: string) => {
  const value = hash(seed);
  const [a, b, c] = PALETTES[value % PALETTES.length] as [string, string, string];
  const x = 15 + (value % 70);
  const y = 15 + ((value >>> 8) % 70);
  const x2 = 100 - x;
  const y2 = 100 - y;
  return {
    background: [
      `radial-gradient(circle at ${x}% ${y}%, ${a} 0%, transparent 55%)`,
      `radial-gradient(circle at ${x2}% ${y2}%, ${b} 0%, transparent 50%)`,
      `linear-gradient(135deg, ${c}, #120d0b)`,
    ].join(','),
  };
};

export const AuraPanel = ({
  seed,
  animated = false,
  className,
}: {
  seed: string;
  animated?: boolean;
  className?: string;
}) => (
  <div className={clsx('overflow-hidden', className)} aria-hidden>
    <div
      className={clsx('absolute -inset-1/4 blur-2xl', animated && 'aura-drift')}
      style={auraStyle(seed)}
    />
  </div>
);

export const AuraAvatar = ({ seed, size = 'md' }: { seed: string; size?: 'md' | 'lg' }) => (
  <span
    aria-hidden
    className={clsx('inline-block shrink-0 rounded-full', size === 'md' ? 'size-10' : 'size-14')}
    style={auraStyle(seed)}
  />
);

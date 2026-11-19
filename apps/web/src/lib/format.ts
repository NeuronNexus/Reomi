const DAY = 86_400_000;
const HOUR = 3_600_000;

export const timeLeft = (iso: string): string => {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'Ended';
  if (ms >= 2 * DAY) return `${Math.floor(ms / DAY)} days left`;
  if (ms >= DAY) return '1 day left';
  const hours = Math.max(Math.floor(ms / HOUR), 1);
  return `${hours} hour${hours === 1 ? '' : 's'} left`;
};

export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

export const timeAgo = (iso: string): string => {
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export const opensIn = (iso: string): string => {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'Open now';
  if (ms >= 2 * DAY) return `Opens in ${Math.floor(ms / DAY)} days`;
  if (ms >= HOUR) return `Opens in ${Math.floor(ms / HOUR)}h`;
  return `Opens in ${Math.max(Math.floor(ms / 60_000), 1)}m`;
};

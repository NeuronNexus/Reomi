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

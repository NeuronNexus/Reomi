import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { Notifications } from '@reomi/shared';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { timeAgo } from '../lib/format';
import { useChannel } from '../lib/realtime';

export const NotificationBell = () => {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const list = useQuery({
    queryKey: ['notifications', userId],
    queryFn: () => api.get<Notifications>('/v1/me/notifications'),
    enabled: Boolean(userId),
    refetchInterval: 120_000,
  });

  const markRead = useMutation({
    mutationFn: () => api.post('/v1/me/notifications/read', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useChannel(userId ? `user:${userId}` : null, (event) => {
    if (event.kind === 'notification') {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      const { title, body, link } = event.notification;
      toast(title, {
        description: body || undefined,
        action: link ? { label: 'Open', onClick: () => void navigate(link) } : undefined,
      });
      // Anything about rooms, reveals or hosting may change what is on screen.
      void queryClient.invalidateQueries({ queryKey: ['room'] });
      void queryClient.invalidateQueries({ queryKey: ['my-applications'] });
      void queryClient.invalidateQueries({ queryKey: ['host-room-applicants'] });
    }
    if (event.kind === 'reveals') {
      void queryClient.invalidateQueries({ queryKey: ['space'] });
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    }
    if (event.kind === 'threads') void queryClient.invalidateQueries({ queryKey: ['threads'] });
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!userId) return null;
  const unread = list.data?.unread ?? 0;

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && unread > 0) markRead.mutate();
        }}
        className="relative grid size-11 place-items-center rounded-full text-muted hover:text-cream"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 grid min-w-4.5 place-items-center rounded-full bg-ember px-1 text-[10px] font-bold text-ink">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          <p className="border-b border-line px-4 py-3 text-sm font-medium">Notifications</p>
          <ul className="max-h-[60vh] overflow-y-auto">
            {list.data?.items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted">Nothing yet.</li>
            )}
            {list.data?.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!item.link}
                  onClick={() => {
                    setOpen(false);
                    if (item.link) void navigate(item.link);
                  }}
                  className={clsx(
                    'block w-full border-b border-line/60 px-4 py-3 text-left transition-colors',
                    item.link && 'hover:bg-raised',
                    !item.read && 'bg-ember/5',
                  )}
                >
                  <p className="text-sm font-medium">{item.title}</p>
                  {item.body && <p className="mt-0.5 text-sm text-muted">{item.body}</p>}
                  <p className="mt-1 text-xs text-faint">{timeAgo(item.createdAt)}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

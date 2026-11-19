import { useQueryClient } from '@tanstack/react-query';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RealtimeEvent } from '@reomi/shared';
import { useAuth } from './auth';

type Handler = (event: RealtimeEvent) => void;

interface RealtimeState {
  connected: boolean;
  subscribe: (channel: string, handler: Handler) => () => void;
}

const RealtimeContext = createContext<RealtimeState | null>(null);

const socketUrl = (): string =>
  `${String(import.meta.env.VITE_API_URL)
    .replace(/^http/, 'ws')
    .replace(/\/$/, '')}/v1/realtime`;

/** Query keys whose data arrives live; refetched after a reconnect so nothing is missed. */
const LIVE_KEYS = new Set(['messages', 'thread-messages', 'space', 'notifications', 'threads']);

/**
 * One WebSocket for the whole app. Components subscribe to channels with `useChannel`; the
 * provider authenticates with the current access token, resubscribes after reconnecting and
 * backs off exponentially while the API is asleep or unreachable.
 */
export const RealtimeProvider = ({ children }: { children: ReactNode }) => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = session?.access_token ?? null;

  const handlers = useRef(new Map<string, Set<Handler>>());
  const socketRef = useRef<WebSocket | null>(null);
  const readyRef = useRef(false);
  const [connected, setConnected] = useState(false);

  const send = (frame: object) => {
    const socket = socketRef.current;
    if (socket && readyRef.current && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  };

  useEffect(() => {
    if (!userId) return;
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        if (tokenRef.current)
          socket.send(JSON.stringify({ type: 'auth', token: tokenRef.current }));
      };
      socket.onmessage = (raw) => {
        let frame: { type: string; channel?: string; event?: RealtimeEvent };
        try {
          frame = JSON.parse(String(raw.data));
        } catch {
          return;
        }
        if (frame.type === 'ready') {
          attempt = 0;
          readyRef.current = true;
          setConnected(true);
          for (const channel of handlers.current.keys()) {
            if (!channel.startsWith('user:'))
              socket.send(JSON.stringify({ type: 'subscribe', channel }));
          }
          void queryClient.invalidateQueries({
            predicate: (query) => LIVE_KEYS.has(String(query.queryKey[0])),
          });
        } else if (frame.type === 'event' && frame.channel && frame.event) {
          handlers.current.get(frame.channel)?.forEach((handler) => handler(frame.event!));
        }
      };
      socket.onclose = () => {
        readyRef.current = false;
        setConnected(false);
        if (closed) return;
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        attempt += 1;
        retry = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
      readyRef.current = false;
    };
  }, [userId, queryClient]);

  const subscribe = useCallback((channel: string, handler: Handler) => {
    let set = handlers.current.get(channel);
    const fresh = !set;
    if (!set) {
      set = new Set();
      handlers.current.set(channel, set);
    }
    set.add(handler);
    if (fresh && !channel.startsWith('user:')) send({ type: 'subscribe', channel });
    return () => {
      const current = handlers.current.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        handlers.current.delete(channel);
        if (!channel.startsWith('user:')) send({ type: 'unsubscribe', channel });
      }
    };
  }, []);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);
  return <RealtimeContext value={value}>{children}</RealtimeContext>;
};

export const useRealtime = (): RealtimeState => {
  const context = use(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used inside RealtimeProvider');
  return context;
};

/** Calls `handler` for every event on `channel` while the component is mounted. */
export const useChannel = (channel: string | null, handler: Handler) => {
  const { subscribe } = useRealtime();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!channel) return;
    return subscribe(channel, (event) => latest.current(event));
  }, [channel, subscribe]);
};

import { useQueryClient } from '@tanstack/react-query';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RealtimeEvent } from '@reomi/shared';
import { useAuth } from './auth';

type Handler = (event: RealtimeEvent) => void;

/** `live`: events stream over the socket. `polling`: the socket is unusable, so data is refetched. */
export type RealtimeMode = 'connecting' | 'live' | 'polling';

interface RealtimeState {
  connected: boolean;
  mode: RealtimeMode;
  subscribe: (channel: string, handler: Handler) => () => void;
}

const RealtimeContext = createContext<RealtimeState | null>(null);

const socketUrl = (): string =>
  `${String(import.meta.env.VITE_API_URL)
    .replace(/^http/, 'ws')
    .replace(/\/$/, '')}/v1/realtime`;

/** Query keys whose data arrives live; refetched after a reconnect so nothing is missed. */
const LIVE_KEYS = new Set(['messages', 'thread-messages', 'space', 'notifications', 'threads']);
/** Slower-moving screens refreshed while polling, since their nudges normally come as events. */
const SLOW_KEYS = new Set([
  'room',
  'my-applications',
  'host-room',
  'host-room-applicants',
  'connections',
]);

/** How long an open socket may take to confirm authentication before polling takes over. */
const READY_TIMEOUT_MS = 6000;
const POLL_MS = 4000;
const SLOW_POLL_MS = 15_000;
const SOCKET_RETRY_MS = 120_000;

/**
 * One WebSocket for the whole app. Components subscribe to channels with `useChannel`; the
 * provider authenticates with the current access token, resubscribes after reconnecting and
 * backs off while the API is asleep.
 *
 * Some proxies accept the upgrade but never pass frames along (Render's free tier does this). If
 * the socket does not become ready in time, the app falls back to refetching live data every few
 * seconds through the normal REST endpoints, and keeps trying the socket in the background.
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
  const [mode, setMode] = useState<RealtimeMode>('connecting');

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
    let readyTimer: ReturnType<typeof setTimeout> | undefined;

    const fallBack = (socket: WebSocket) => {
      setMode('polling');
      socket.onclose = null;
      socket.close();
      if (!closed) retry = setTimeout(connect, SOCKET_RETRY_MS);
    };

    const connect = () => {
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        if (tokenRef.current)
          socket.send(JSON.stringify({ type: 'auth', token: tokenRef.current }));
        readyTimer = setTimeout(() => {
          if (!readyRef.current) fallBack(socket);
        }, READY_TIMEOUT_MS);
      };
      socket.onmessage = (raw) => {
        let frame: { type: string; channel?: string; event?: RealtimeEvent };
        try {
          frame = JSON.parse(String(raw.data));
        } catch {
          return;
        }
        if (frame.type === 'ready') {
          clearTimeout(readyTimer);
          attempt = 0;
          readyRef.current = true;
          setMode('live');
          for (const channel of handlers.current.keys()) {
            if (!channel.startsWith('user:')) {
              socket.send(JSON.stringify({ type: 'subscribe', channel }));
            }
          }
          void queryClient.invalidateQueries({
            predicate: (query) => LIVE_KEYS.has(String(query.queryKey[0])),
          });
        } else if (frame.type === 'event' && frame.channel && frame.event) {
          handlers.current.get(frame.channel)?.forEach((handler) => handler(frame.event!));
        }
      };
      socket.onclose = () => {
        clearTimeout(readyTimer);
        readyRef.current = false;
        if (closed) return;
        attempt += 1;
        // A few failed attempts in a row usually means the network path is the problem.
        setMode((current) => (current === 'live' || attempt < 3 ? 'connecting' : 'polling'));
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt));
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(readyTimer);
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close();
      }
      socketRef.current = null;
      readyRef.current = false;
      setMode('connecting');
    };
  }, [userId, queryClient]);

  // Polling fallback: refresh whatever live data is on screen.
  useEffect(() => {
    if (!userId || mode !== 'polling') return;
    const refresh = (keys: Set<string>) =>
      void queryClient.invalidateQueries({
        predicate: (query) => keys.has(String(query.queryKey[0])),
      });
    const fast = setInterval(() => refresh(LIVE_KEYS), POLL_MS);
    const slow = setInterval(() => refresh(SLOW_KEYS), SLOW_POLL_MS);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
    };
  }, [userId, mode, queryClient]);

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

  const value = useMemo(() => ({ connected: mode === 'live', mode, subscribe }), [mode, subscribe]);
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

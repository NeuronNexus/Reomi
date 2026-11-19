import { createClient } from '@supabase/supabase-js';
import { createApiClient } from '@reomi/shared';

const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`${name} is not set. See apps/web/.env.example.`);
  return value;
};

export const supabase = createClient(
  required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  required('VITE_SUPABASE_KEY', import.meta.env.VITE_SUPABASE_KEY),
);

/**
 * Tracks requests that take unusually long. On Render's free plan the API sleeps when idle and the
 * first request after that waits up to a minute, which deserves an explanation on screen.
 */
const SLOW_MS = 3000;
let inFlight = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let slow = false;
const listeners = new Set<() => void>();
const setSlow = (value: boolean) => {
  if (slow === value) return;
  slow = value;
  listeners.forEach((listener) => listener());
};

export const serverWaking = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => slow,
};

export const api = createApiClient(
  required('VITE_API_URL', import.meta.env.VITE_API_URL),
  async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  {
    onStart: () => {
      inFlight += 1;
      if (inFlight === 1) slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
    },
    onEnd: () => {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0) {
        clearTimeout(slowTimer);
        setSlow(false);
      }
    },
  },
);

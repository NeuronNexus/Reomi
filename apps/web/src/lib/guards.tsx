import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Spinner } from '../components/ui';
import { useAuth } from './auth';

/** Where the Create room button leads, which is the host verification check itself. */
export const useCreateRoomRoute = (): string => {
  const { session, me } = useAuth();
  if (!session) return '/login?next=/host/new';
  if (me && !me.onboarded) return '/onboarding?next=/host/new';
  return me?.host?.status === 'verified' ? '/host/new' : '/host/apply';
};

export const RequireAuth = () => {
  const { ready, session, me } = useAuth();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;

  if (!ready) return <Spinner />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
  if (me && !me.onboarded && location.pathname !== '/onboarding') {
    return <Navigate to={`/onboarding?next=${encodeURIComponent(here)}`} replace />;
  }
  return <Outlet />;
};

export const RequireVerifiedHost = ({ children }: { children: ReactNode }) => {
  const { me } = useAuth();
  if (me?.host?.status !== 'verified') return <Navigate to="/host/apply" replace />;
  return children;
};

/** Only allows redirects inside this app, so a crafted link cannot bounce people off-site. */
export const safeNext = (next: string | null, fallback = '/'): string =>
  next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;

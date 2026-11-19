import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  CreditCard,
  DoorOpen,
  Layers,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router';
import { APP_NAME } from '@agnipath/shared';
import type { AdminStats, Me } from '@agnipath/shared';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { HostsPage } from './pages/hosts';
import { OverviewPage } from './pages/overview';
import { PaymentsPage } from './pages/payments';
import { PlansPage } from './pages/plans';
import { RoomsPage } from './pages/rooms';
import { UsersPage } from './pages/users';
import { Button } from './ui';

const Centered = ({ children }: { children: ReactNode }) => (
  <main className="grid min-h-dvh place-items-center p-4">{children}</main>
);

const NAV = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/hosts', label: 'Hosts', icon: ShieldCheck },
  { to: '/admin/rooms', label: 'Rooms', icon: DoorOpen },
  { to: '/admin/plans', label: 'Plans & features', icon: Layers },
  { to: '/admin/payments', label: 'Payments', icon: CreditCard },
];

const Shell = ({ me, onSignOut }: { me: Me; onSignOut: () => void }) => {
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<AdminStats>('/v1/admin/stats'),
  });
  const pendingHosts = stats.data?.hosts.pending ?? 0;
  const refundsDue = (stats.data?.revenue.refundsDuePaise ?? 0) > 0;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-panel md:sticky md:top-0 md:h-dvh md:w-56 md:border-r md:border-b-0">
        <p className="px-4 py-3 font-semibold md:py-4">{APP_NAME} CMS</p>
        <nav
          aria-label="CMS"
          className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:pb-0"
        >
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 whitespace-nowrap',
                  isActive ? 'bg-page font-medium' : 'text-muted hover:bg-page hover:text-ink',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
              {to === '/admin/hosts' && pendingHosts > 0 && (
                <span className="ml-auto rounded bg-accent px-1.5 text-xs font-medium text-white">
                  {pendingHosts}
                </span>
              )}
              {to === '/admin/payments' && refundsDue && (
                <span className="ml-auto size-2 rounded-full bg-bad">
                  <span className="sr-only">Refunds due</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <Link to="/" className="hidden px-4 py-3 text-xs text-muted hover:text-ink md:block">
          Back to the site
        </Link>
        <div className="hidden items-center justify-between gap-2 border-t border-line p-3 md:flex">
          <span className="truncate text-xs text-muted">{me.email}</span>
          <button type="button" aria-label="Sign out" onClick={onSignOut} className="text-muted">
            <LogOut className="size-4" aria-hidden />
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-6">
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="users" element={<UsersPage me={me} />} />
          <Route path="hosts" element={<HostsPage />} />
          <Route path="rooms" element={<RoomsPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
};

/** The CMS at /admin. It only hides the screens: the API enforces admin access on every call. */
export const CmsApp = () => {
  const { ready, session, me, signOut } = useAuth();
  const navigate = useNavigate();

  const leave = () => {
    void signOut().then(() => navigate('/'));
  };

  let content: ReactNode;
  if (!ready) {
    content = (
      <Centered>
        <LoaderCircle className="size-5 animate-spin text-muted" aria-label="Loading" />
      </Centered>
    );
  } else if (!session) {
    return <Navigate to="/login?next=/admin" replace />;
  } else if (me?.role !== 'admin') {
    content = (
      <Centered>
        <div className="max-w-sm rounded-lg border border-line bg-panel p-6 text-center">
          <h1 className="font-semibold">No CMS access</h1>
          <p className="mt-1 text-muted">This account is not an administrator.</p>
          <Button className="mt-4" onClick={() => void navigate('/')}>
            Back to the site
          </Button>
        </div>
      </Centered>
    );
  } else {
    content = <Shell me={me} onSignOut={leave} />;
  }

  return <div className="cms min-h-dvh">{content}</div>;
};

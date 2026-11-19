import clsx from 'clsx';
import {
  Compass,
  DoorOpen,
  Heart,
  LogOut,
  MessagesSquare,
  Plus,
  Trophy,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { APP_NAME } from '@reomi/shared';
import { useAuth } from '../lib/auth';
import { useCreateRoomRoute } from '../lib/guards';
import { useRealtime } from '../lib/realtime';
import { AuraAvatar } from './aura';
import { NotificationBell } from './notifications';
import { Button, LinkButton } from './ui';

const navClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'text-sm whitespace-nowrap transition-colors',
    isActive ? 'text-cream' : 'text-muted hover:text-cream',
  );

const MOBILE_TABS = [
  { to: '/', label: 'Rooms', icon: Compass, end: true },
  { to: '/communities', label: 'Circles', icon: UsersRound },
  { to: '/messages', label: 'Messages', icon: MessagesSquare },
  { to: '/connections', label: 'Reveals', icon: Heart },
  { to: '/profile', label: 'You', icon: UserRound },
];

export const Layout = () => {
  const { session, me, signOut } = useAuth();
  const { connected } = useRealtime();
  const navigate = useNavigate();
  const createRoomRoute = useCreateRoomRoute();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-ink/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-5 px-4">
          <Link to="/" className="flex items-center gap-2 font-display text-xl tracking-tight">
            <span
              className="inline-block size-6 rounded-full bg-[radial-gradient(circle_at_30%_30%,#ffc56b,#ff6a33_55%,#7a1f4e)]"
              aria-hidden
            />
            {APP_NAME}
          </Link>
          <nav className="hidden items-center gap-5 lg:flex" aria-label="Main">
            <NavLink to="/" end className={navClass}>
              Rooms
            </NavLink>
            <NavLink to="/communities" className={navClass}>
              Communities
            </NavLink>
            <NavLink to="/leaderboard" className={navClass}>
              Top hosts
            </NavLink>
            {session && (
              <>
                <NavLink to="/messages" className={navClass}>
                  Messages
                </NavLink>
                <NavLink to="/connections" className={navClass}>
                  Reveals
                </NavLink>
                <NavLink to="/my-rooms" className={navClass}>
                  My rooms
                </NavLink>
                <NavLink to="/host" className={navClass}>
                  Hosting
                </NavLink>
                {me?.role === 'admin' && (
                  <NavLink to="/admin" className={navClass}>
                    CMS
                  </NavLink>
                )}
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <LinkButton to={createRoomRoute} className="px-4! max-sm:hidden!">
              <Plus className="size-4" aria-hidden />
              Create room
            </LinkButton>
            {session ? (
              <>
                <NotificationBell />
                <Link
                  to="/profile"
                  aria-label="Your profile"
                  className="relative hidden size-11 place-items-center sm:grid"
                  title={connected ? 'Live updates on' : 'Reconnecting'}
                >
                  {me?.avatarUrl ? (
                    <img src={me.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
                  ) : (
                    <span className="scale-80">
                      <AuraAvatar seed={me?.id ?? 'me'} />
                    </span>
                  )}
                  <span
                    className={clsx(
                      'absolute right-1.5 bottom-1.5 size-2.5 rounded-full border-2 border-ink',
                      connected ? 'bg-success' : 'bg-faint',
                    )}
                    aria-hidden
                  />
                </Link>
                <Button
                  variant="quiet"
                  aria-label="Sign out"
                  className="px-3!"
                  onClick={() => {
                    void signOut().then(() => navigate('/'));
                  }}
                >
                  <LogOut className="size-4" aria-hidden />
                </Button>
              </>
            ) : (
              <LinkButton to="/login" variant="ghost" className="px-4!">
                Sign in
              </LinkButton>
            )}
          </div>
        </div>
        <nav
          className="flex gap-5 overflow-x-auto border-t border-line/60 px-4 py-2 lg:hidden"
          aria-label="More"
        >
          <NavLink to="/leaderboard" className={navClass}>
            <Trophy className="mr-1 inline size-3.5" aria-hidden />
            Top hosts
          </NavLink>
          {session && (
            <>
              <NavLink to="/my-rooms" className={navClass}>
                <DoorOpen className="mr-1 inline size-3.5" aria-hidden />
                My rooms
              </NavLink>
              <NavLink to="/host" className={navClass}>
                Hosting
              </NavLink>
              <NavLink to="/feed" className={navClass}>
                Feed
              </NavLink>
              <NavLink to={createRoomRoute} className={navClass}>
                Create room
              </NavLink>
              {me?.role === 'admin' && (
                <NavLink to="/admin" className={navClass}>
                  CMS
                </NavLink>
              )}
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pb-28 md:py-12 lg:pb-12">
        <Outlet />
      </main>

      <footer className="hidden border-t border-line/60 lg:block">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-sm text-faint">
          <span>
            Dating starts with the vibe, not the looks. Socialising starts with shared interests.
          </span>
          <span>
            <Link to="/pricing" className="hover:text-cream">
              Fair pricing
            </Link>{' '}
            · 18+ only
          </span>
        </div>
      </footer>

      {session && (
        <nav
          aria-label="Tabs"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          {MOBILE_TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]',
                  isActive ? 'text-amber' : 'text-faint',
                )
              }
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
};

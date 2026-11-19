import clsx from 'clsx';
import { LogOut, Plus } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { APP_NAME } from '@reomi/shared';
import { useAuth } from '../lib/auth';
import { useCreateRoomRoute } from '../lib/guards';
import { Button, LinkButton } from './ui';

const navClass = ({ isActive }: { isActive: boolean }) =>
  clsx('text-sm transition-colors', isActive ? 'text-cream' : 'text-muted hover:text-cream');

export const Layout = () => {
  const { session, me, signOut } = useAuth();
  const navigate = useNavigate();
  const createRoomRoute = useCreateRoomRoute();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-ink/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="font-display text-xl tracking-tight">
            {APP_NAME}
          </Link>
          <nav className="hidden items-center gap-6 sm:flex" aria-label="Main">
            <NavLink to="/" end className={navClass}>
              Explore
            </NavLink>
            {session && (
              <>
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
          <div className="ml-auto flex items-center gap-2">
            <LinkButton to={createRoomRoute} className="px-4!">
              <Plus className="size-4" aria-hidden />
              Create room
            </LinkButton>
            {session ? (
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
            ) : (
              <LinkButton to="/login" variant="ghost" className="px-4!">
                Sign in
              </LinkButton>
            )}
          </div>
        </div>
        {session && (
          <nav
            className="flex gap-6 border-t border-line/60 px-4 py-2 sm:hidden"
            aria-label="Main mobile"
          >
            <NavLink to="/" end className={navClass}>
              Explore
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
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-12">
        <Outlet />
      </main>

      <footer className="border-t border-line/60">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-sm text-faint">
          <span>Dating starts with the vibe, not the looks.</span>
          <span>18+ only</span>
        </div>
      </footer>
    </div>
  );
};

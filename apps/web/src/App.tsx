import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { Layout } from './components/layout';
import { Button, EmptyState, LinkButton, Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { RequireAuth, RequireVerifiedHost } from './lib/guards';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/auth';
import { ExplorePage } from './pages/explore';
import { OnboardingPage } from './pages/onboarding';
import { LobbyPage, RoomPage } from './pages/room';
import { MyRoomsPage } from './pages/my-rooms';

const HostHomePage = lazy(() => import('./pages/host').then((m) => ({ default: m.HostHomePage })));
const HostApplyPage = lazy(() =>
  import('./pages/host').then((m) => ({ default: m.HostApplyPage })),
);
const NewRoomPage = lazy(() => import('./pages/host').then((m) => ({ default: m.NewRoomPage })));
const HostRoomPage = lazy(() => import('./pages/host').then((m) => ({ default: m.HostRoomPage })));

const CmsApp = lazy(() => import('./cms/cms-app').then((m) => ({ default: m.CmsApp })));

const NotFound = () => (
  <EmptyState
    title="Nothing here"
    body="This page does not exist, or the room has closed."
    action={<LinkButton to="/">Back to Explore</LinkButton>}
  />
);

export const App = () => {
  const { suspended, signOut } = useAuth();

  if (suspended) {
    return (
      <main className="mx-auto max-w-lg px-4 py-24">
        <EmptyState
          title="Your account is suspended"
          body="Your access has been paused by our team. Contact support if you think this is a mistake."
          action={
            <Button variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="admin/*" element={<CmsApp />} />
        <Route element={<Layout />}>
          <Route index element={<ExplorePage />} />
          <Route path="rooms/:id" element={<RoomPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />

          <Route element={<RequireAuth />}>
            <Route path="onboarding" element={<OnboardingPage />} />
            <Route path="my-rooms" element={<MyRoomsPage />} />
            <Route path="rooms/:id/lobby" element={<LobbyPage />} />
            <Route path="host" element={<HostHomePage />} />
            <Route path="host/apply" element={<HostApplyPage />} />
            <Route
              path="host/new"
              element={
                <RequireVerifiedHost>
                  <NewRoomPage />
                </RequireVerifiedHost>
              }
            />
            <Route path="host/rooms/:id" element={<HostRoomPage />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

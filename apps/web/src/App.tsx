import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { Layout } from './components/layout';
import { Button, EmptyState, LinkButton, Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { RequireAuth, RequireVerifiedHost } from './lib/guards';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/auth';
import { ExplorePage } from './pages/explore';
import { MyRoomsPage } from './pages/my-rooms';
import { OnboardingPage } from './pages/onboarding';
import { JoinByCodePage, LobbyRedirect, RoomPage } from './pages/room';

const page = <K extends string>(loader: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => loader().then((module) => ({ default: module[name] })));

const HostHomePage = page(() => import('./pages/host'), 'HostHomePage');
const HostApplyPage = page(() => import('./pages/host'), 'HostApplyPage');
const NewRoomPage = page(() => import('./pages/host'), 'NewRoomPage');
const HostRoomPage = page(() => import('./pages/host'), 'HostRoomPage');
const RoomSpacePage = page(() => import('./pages/space'), 'RoomSpacePage');
const MessagesPage = page(() => import('./pages/messages'), 'MessagesPage');
const ThreadPage = page(() => import('./pages/messages'), 'ThreadPage');
const ConnectionsPage = page(() => import('./pages/people'), 'ConnectionsPage');
const ProfilePage = page(() => import('./pages/people'), 'ProfilePage');
const HostProfilePage = page(() => import('./pages/hosts-public'), 'HostProfilePage');
const LeaderboardPage = page(() => import('./pages/hosts-public'), 'LeaderboardPage');
const ComparePage = page(() => import('./pages/hosts-public'), 'ComparePage');
const PricingPage = page(() => import('./pages/hosts-public'), 'PricingPage');
const CommunitiesPage = page(() => import('./pages/communities'), 'CommunitiesPage');
const NewCommunityPage = page(() => import('./pages/communities'), 'NewCommunityPage');
const CommunityPage = page(() => import('./pages/communities'), 'CommunityPage');
const FeedPage = page(() => import('./pages/communities'), 'FeedPage');
const ReelsPage = page(() => import('./pages/communities'), 'ReelsPage');
const CmsApp = page(() => import('./cms/cms-app'), 'CmsApp');

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
          body="Your access has been paused by our team, usually after repeated moderation strikes. Contact support if you think this is a mistake."
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
          <Route path="join/:code" element={<JoinByCodePage />} />
          <Route path="hosts/:id" element={<HostProfilePage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="compare" element={<ComparePage />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="communities" element={<CommunitiesPage />} />
          <Route path="c/:slug/*" element={<CommunityPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />

          <Route element={<RequireAuth />}>
            <Route path="onboarding" element={<OnboardingPage />} />
            <Route path="my-rooms" element={<MyRoomsPage />} />
            <Route path="rooms/:id/lobby" element={<LobbyRedirect />} />
            <Route path="rooms/:id/space" element={<RoomSpacePage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="messages/:id" element={<ThreadPage />} />
            <Route path="connections" element={<ConnectionsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="communities/new" element={<NewCommunityPage />} />
            <Route path="feed" element={<FeedPage />} />
            <Route path="reels" element={<ReelsPage />} />
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

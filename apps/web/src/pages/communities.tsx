import { zodResolver } from '@hookform/resolvers/zod';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeft,
  Globe,
  Heart,
  Lock,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { COMMUNITY_TOPICS, createCommunityInput } from '@reomi/shared';
import type {
  Community,
  CommunityDetail,
  CreateCommunityInput,
  Member,
  Paginated,
  Post,
  StoryGroup,
} from '@reomi/shared';
import { AuraAvatar, AuraPanel } from '../components/aura';
import { AuthorAvatar, PostCard, PostComposer, StoriesBar } from '../components/social';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  LinkButton,
  PageTitle,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { TOPIC_LABELS } from '../lib/labels';
import type { CommunityTopic } from '../lib/labels';
import { toastError } from '../lib/upload';

/* Directory ---------------------------------------------------------------------------------- */

export const CommunitiesPage = () => {
  const { session } = useAuth();
  const [topic, setTopic] = useState<CommunityTopic | undefined>();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());

  const mine = useQuery({
    queryKey: ['communities', 'mine'],
    queryFn: () => api.get<Paginated<Community>>('/v1/communities', { mine: true, pageSize: 48 }),
    enabled: Boolean(session),
  });
  const all = useQuery({
    queryKey: ['communities', { topic, q, signedIn: Boolean(session) }],
    queryFn: () => api.get<Paginated<Community>>('/v1/communities', { topic, q, pageSize: 48 }),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <section className="relative -mx-4 -mt-8 mb-10 overflow-hidden px-4 pt-14 pb-12 md:-mt-12 md:pt-20">
        <AuraPanel
          seed="communities-glow"
          animated
          className="absolute inset-0 opacity-25 [mask-image:radial-gradient(ellipse_60%_100%_at_50%_0%,black,transparent)]"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <h1 className="font-display text-5xl leading-[1.05] tracking-tight md:text-6xl">
              Share with people who get it.
            </h1>
            <p className="mt-4 text-lg text-muted">
              Private circles built around what you love. Post photos, reels and stories to the
              people who care, not to the whole internet. Use a different name in every circle if
              you like.
            </p>
          </div>
          <div className="flex gap-2">
            {session && (
              <LinkButton to="/feed" variant="ghost">
                Your feed
              </LinkButton>
            )}
            <LinkButton to={session ? '/communities/new' : '/login?next=/communities/new'}>
              <Plus className="size-4" aria-hidden />
              Start a community
            </LinkButton>
          </div>
        </div>
      </section>

      {mine.data && mine.data.items.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-4 font-display text-2xl">Your communities</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.data.items.map((community) => (
              <CommunityCard key={community.id} community={community} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center">
          <h2 className="font-display text-2xl">Discover</h2>
          <div className="relative md:ml-auto md:w-72">
            <Search
              className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search communities"
              placeholder="Search communities"
              className="pl-10!"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
          <Chip active={!topic} onClick={() => setTopic(undefined)}>
            Everything
          </Chip>
          {COMMUNITY_TOPICS.map((value) => (
            <Chip key={value} active={topic === value} onClick={() => setTopic(value)}>
              {TOPIC_LABELS[value]}
            </Chip>
          ))}
        </div>
        {all.isPending && <Spinner />}
        {all.isError && <ErrorNotice error={all.error} />}
        {all.data?.items.length === 0 && (
          <EmptyState
            title="No communities here yet"
            body="Start one for the thing you love most."
            action={<LinkButton to="/communities/new">Start a community</LinkButton>}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {all.data?.items.map((community) => (
            <CommunityCard key={community.id} community={community} />
          ))}
        </div>
      </section>
    </>
  );
};

const Chip = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={clsx(
      'min-h-10 shrink-0 rounded-full border px-4 text-sm transition-colors',
      active
        ? 'border-cream bg-cream text-ink'
        : 'border-line text-muted hover:border-faint hover:text-cream',
    )}
  >
    {children}
  </button>
);

const CommunityCard = ({ community }: { community: Community }) => (
  <Link
    to={`/c/${community.slug}`}
    className="group overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-faint"
  >
    <div className="relative h-20">
      <AuraPanel seed={community.slug} className="absolute inset-0" />
    </div>
    <div className="p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-xl leading-snug group-hover:text-amber">
          {community.name}
        </h3>
        {community.visibility === 'private' ? (
          <Lock className="mt-1 size-4 shrink-0 text-faint" aria-label="Private" />
        ) : (
          <Globe className="mt-1 size-4 shrink-0 text-faint" aria-label="Open" />
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-muted">{community.tagline}</p>
      <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-faint">
        <span>{TOPIC_LABELS[community.topic]}</span>
        <span>{community.memberCount} members</span>
        <span>{community.postCount} posts</span>
        {community.myStatus === 'active' && <Badge tone="success">Joined</Badge>}
        {community.myStatus === 'pending' && <Badge>Requested</Badge>}
      </p>
    </div>
  </Link>
);

/* Create ------------------------------------------------------------------------------------- */

export const NewCommunityPage = () => {
  const navigate = useNavigate();
  const { me } = useAuth();
  const form = useForm<z.input<typeof createCommunityInput>, unknown, CreateCommunityInput>({
    resolver: zodResolver(createCommunityInput),
    defaultValues: {
      name: '',
      tagline: '',
      description: '',
      rules:
        "Be kind. Talk about the work, never about bodies. No sharing anyone else's photos or details.",
      topic: 'fashion',
      visibility: 'open',
      displayName: me?.fullName?.split(' ')[0] ?? '',
    },
  });
  const create = useMutation({
    mutationFn: (values: CreateCommunityInput) =>
      api.post<{ slug: string }>('/v1/communities', values),
    onSuccess: ({ slug }) => {
      toast.success('Your community is ready');
      return navigate(`/c/${slug}`);
    },
    onError: toastError,
  });
  const { errors } = form.formState;

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title="Start a community"
        subtitle="A private space for one interest. You will be its owner and first moderator."
      />
      <form onSubmit={form.handleSubmit((values) => create.mutate(values))} className="space-y-5">
        <Field label="Name" error={errors.name?.message}>
          <Input {...form.register('name')} placeholder="e.g. Street Style Bengaluru" />
        </Field>
        <Field label="Tagline" error={errors.tagline?.message}>
          <Input {...form.register('tagline')} placeholder="One line about what you share here" />
        </Field>
        <Field label="Description" error={errors.description?.message}>
          <Textarea {...form.register('description')} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Topic">
            <Select {...form.register('topic')}>
              {COMMUNITY_TOPICS.map((value) => (
                <option key={value} value={value}>
                  {TOPIC_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Who can join" hint="Private communities approve each member.">
            <Select {...form.register('visibility')}>
              <option value="open">Anyone can join</option>
              <option value="private">By approval</option>
            </Select>
          </Field>
        </div>
        <Field label="House rules" error={errors.rules?.message}>
          <Textarea {...form.register('rules')} />
        </Field>
        <Field
          label="Your name here"
          error={errors.displayName?.message}
          hint="Shown only inside this community."
        >
          <Input {...form.register('displayName')} />
        </Field>
        <Button type="submit" loading={create.isPending}>
          Create community
        </Button>
      </form>
    </div>
  );
};

/* A community -------------------------------------------------------------------------------- */

const usePosts = (key: unknown[], path: string, enabled = true) =>
  useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api.get<Post[]>(path, { before: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === 20 ? last.at(-1)?.createdAt : undefined),
    enabled,
  });

const PostList = ({
  query,
  showCommunity,
  empty,
}: {
  query: ReturnType<typeof usePosts>;
  showCommunity?: boolean;
  empty: React.ReactNode;
}) => {
  const posts = query.data?.pages.flat() ?? [];
  if (query.isPending) return <Spinner />;
  if (query.isError) return <ErrorNotice error={query.error} />;
  if (posts.length === 0) return <>{empty}</>;
  return (
    <div className="space-y-5">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          showCommunity={showCommunity}
          onChanged={() => void query.refetch()}
        />
      ))}
      {query.hasNextPage && (
        <div className="text-center">
          <Button
            variant="ghost"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
};

export const CommunityPage = () => {
  const { slug = '' } = useParams();
  const { session } = useAuth();
  const community = useQuery({
    queryKey: ['community', slug, session?.user.id],
    queryFn: () => api.get<CommunityDetail>(`/v1/communities/${slug}`),
  });

  if (community.isPending) return <Spinner />;
  if (community.isError) return <ErrorNotice error={community.error} />;
  const data = community.data;
  const member = data.myStatus === 'active';
  const mod = member && (data.myRole === 'owner' || data.myRole === 'moderator');

  const tab = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'min-h-10 rounded-full px-4 text-sm leading-10 whitespace-nowrap',
      isActive ? 'bg-cream text-ink' : 'text-muted hover:text-cream',
    );

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/communities"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-cream"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Communities
      </Link>
      <header className="relative mb-6 overflow-hidden rounded-3xl border border-line p-6">
        <AuraPanel seed={data.slug} animated className="absolute inset-0 opacity-40" />
        <div className="relative">
          <p className="text-sm text-muted">{TOPIC_LABELS[data.topic]}</p>
          <h1 className="mt-1 font-display text-4xl leading-tight">{data.name}</h1>
          <p className="mt-2 text-muted">{data.tagline}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Users className="size-4" aria-hidden />
              {data.memberCount} members
            </span>
            {data.visibility === 'private' ? (
              <Badge>
                <Lock className="mr-1 size-3" aria-hidden />
                Private
              </Badge>
            ) : (
              <Badge>Open</Badge>
            )}
            {member && <span className="text-muted">You are {data.myDisplayName} here</span>}
            <div className="ml-auto">
              <Membership community={data} />
            </div>
          </div>
        </div>
      </header>

      {member ? (
        <>
          <nav className="mb-6 flex gap-1 overflow-x-auto" aria-label="Community">
            <NavLink to={`/c/${slug}`} end className={tab}>
              Posts
            </NavLink>
            <NavLink to={`/c/${slug}/reels`} className={tab}>
              Reels
            </NavLink>
            <NavLink to={`/c/${slug}/members`} className={tab}>
              Members{mod && data.pendingRequests > 0 ? ` (${data.pendingRequests} waiting)` : ''}
            </NavLink>
            <NavLink to={`/c/${slug}/about`} className={tab}>
              About
            </NavLink>
          </nav>
          <Routes>
            <Route index element={<CommunityPosts slug={slug} />} />
            <Route path="reels" element={<CommunityReels slug={slug} />} />
            <Route path="members" element={<Members community={data} canModerate={mod} />} />
            <Route path="about" element={<About community={data} />} />
          </Routes>
        </>
      ) : (
        <About community={data} />
      )}
    </div>
  );
};

const Membership = ({ community }: { community: CommunityDetail }) => {
  const { session, me } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState(me?.fullName?.split(' ')[0] ?? '');
  const [asking, setAsking] = useState(false);
  const [photo, setPhoto] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['community', community.slug] });

  const join = useMutation({
    mutationFn: () =>
      api.post<{ status: string }>(`/v1/communities/${community.slug}/join`, {
        displayName: name.trim(),
        useProfilePhoto: photo,
      }),
    onSuccess: ({ status }) => {
      toast.success(
        status === 'active' ? `Welcome to ${community.name}` : 'Request sent to the moderators',
      );
      setAsking(false);
      void queryClient.invalidateQueries({ queryKey: ['communities'] });
      return refresh();
    },
    onError: toastError,
  });
  const leave = useMutation({
    mutationFn: () => api.delete(`/v1/communities/${community.slug}/membership`),
    onSuccess: refresh,
    onError: toastError,
  });

  if (community.myStatus === 'active') {
    return community.myRole === 'owner' ? (
      <Badge tone="ember">
        <ShieldCheck className="mr-1 size-3" aria-hidden />
        Owner
      </Badge>
    ) : (
      <Button
        variant="ghost"
        className="px-4!"
        loading={leave.isPending}
        onClick={() => window.confirm('Leave this community?') && leave.mutate()}
      >
        Leave
      </Button>
    );
  }
  if (community.myStatus === 'pending') return <Badge>Request pending</Badge>;
  if (community.myStatus === 'banned') return <Badge tone="danger">Removed</Badge>;
  if (!session) {
    return (
      <Button onClick={() => void navigate(`/login?next=${encodeURIComponent(location.pathname)}`)}>
        Sign in to join
      </Button>
    );
  }
  if (!asking)
    return (
      <Button onClick={() => setAsking(true)}>
        {community.visibility === 'open' ? 'Join' : 'Ask to join'}
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-2xl bg-ink/80 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim().length >= 2) join.mutate();
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder="Your name in this community"
        className="w-56!"
      />
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={photo}
          onChange={(e) => setPhoto(e.target.checked)}
          className="size-4 accent-[#ff6a33]"
        />
        Show my profile photo
      </label>
      <Button type="submit" loading={join.isPending}>
        Join
      </Button>
    </form>
  );
};

const CommunityPosts = ({ slug }: { slug: string }) => {
  const posts = usePosts(['posts', slug], `/v1/communities/${slug}/posts`);
  const stories = useQuery({
    queryKey: ['stories', slug],
    queryFn: () => api.get<StoryGroup[]>(`/v1/communities/${slug}/stories`),
  });
  return (
    <>
      <StoriesBar
        groups={stories.data ?? []}
        slug={slug}
        onChanged={() => void stories.refetch()}
      />
      <div className="mb-6">
        <PostComposer slug={slug} onPosted={() => void posts.refetch()} />
      </div>
      <PostList
        query={posts}
        empty={<EmptyState title="Nothing posted yet" body="Be the first to share something." />}
      />
    </>
  );
};

const CommunityReels = ({ slug }: { slug: string }) => {
  const posts = usePosts(['posts', slug], `/v1/communities/${slug}/posts`);
  const reels = (posts.data?.pages.flat() ?? []).filter((post) => post.kind === 'reel');
  if (posts.isPending) return <Spinner />;
  if (reels.length === 0)
    return (
      <EmptyState
        title="No reels yet"
        body="Post a short vertical video and tick “Post as a reel”."
      />
    );
  return <ReelStack posts={reels} />;
};

const Members = ({
  community,
  canModerate,
}: {
  community: CommunityDetail;
  canModerate: boolean;
}) => {
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ['members', community.slug],
    queryFn: () => api.get<Member[]>(`/v1/communities/${community.slug}/members`),
  });
  const requests = useQuery({
    queryKey: ['members', community.slug, 'pending'],
    queryFn: () =>
      api.get<Member[]>(`/v1/communities/${community.slug}/members`, { status: 'pending' }),
    enabled: canModerate,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.patch(`/v1/communities/${community.slug}/members/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', community.slug] });
      return queryClient.invalidateQueries({ queryKey: ['community', community.slug] });
    },
    onError: toastError,
  });

  return (
    <div className="space-y-8">
      {canModerate && requests.data && requests.data.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-xl">Join requests</h2>
          <ul className="space-y-2">
            {requests.data.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-3 rounded-xl border border-line p-3"
              >
                <AuraAvatar seed={member.id} />
                <span className="flex-1">{member.displayName}</span>
                <Button
                  className="px-4!"
                  onClick={() => update.mutate({ id: member.id, body: { status: 'active' } })}
                >
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  className="px-4!"
                  onClick={() => update.mutate({ id: member.id, body: { status: 'banned' } })}
                >
                  Decline
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="mb-3 font-display text-xl">Members</h2>
        {members.isPending && <Spinner />}
        <ul className="space-y-2">
          {members.data?.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center gap-3 rounded-xl p-2 hover:bg-raised/50"
            >
              <AuthorAvatar
                author={{
                  memberId: member.id,
                  displayName: member.displayName,
                  avatarUrl: member.avatarUrl,
                  role: member.role,
                }}
              />
              <span className="flex-1">
                {member.displayName}
                {member.isYou && <span className="text-faint"> (you)</span>}
              </span>
              {member.role !== 'member' && (
                <Badge tone="ember">{member.role === 'owner' ? 'Owner' : 'Moderator'}</Badge>
              )}
              {canModerate && !member.isYou && member.role !== 'owner' && (
                <>
                  {community.myRole === 'owner' && (
                    <Button
                      variant="quiet"
                      className="px-3!"
                      onClick={() =>
                        update.mutate({
                          id: member.id,
                          body: { role: member.role === 'moderator' ? 'member' : 'moderator' },
                        })
                      }
                    >
                      {member.role === 'moderator' ? 'Remove mod' : 'Make mod'}
                    </Button>
                  )}
                  <Button
                    variant="quiet"
                    className="px-3! text-danger!"
                    onClick={() =>
                      window.confirm(`Remove ${member.displayName}?`) &&
                      update.mutate({ id: member.id, body: { status: 'banned' } })
                    }
                  >
                    Remove
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

const About = ({ community }: { community: CommunityDetail }) => (
  <div className="space-y-6">
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-display text-xl">About</h2>
      <p className="mt-2 leading-relaxed whitespace-pre-line text-muted">{community.description}</p>
    </section>
    {community.rules && (
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display text-xl">House rules</h2>
        <p className="mt-2 leading-relaxed whitespace-pre-line text-muted">{community.rules}</p>
      </section>
    )}
    <section className="rounded-2xl border border-line p-5 text-sm text-muted">
      <p className="flex items-center gap-2 font-medium text-cream">
        <ShieldCheck className="size-4 text-success" aria-hidden />
        Members only
      </p>
      <p className="mt-1">
        Posts here are visible to members of this community only. Insults about looks, bodies or sex
        lives are blocked before they are posted.
      </p>
    </section>
  </div>
);

/* Feed and reels ----------------------------------------------------------------------------- */

export const FeedPage = () => {
  const posts = usePosts(['feed'], '/v1/feed');
  const stories = useQuery({
    queryKey: ['stories', 'all'],
    queryFn: () => api.get<StoryGroup[]>('/v1/stories'),
  });
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        title="Your feed"
        subtitle="Everything from the communities you belong to."
        action={
          <LinkButton to="/reels" variant="ghost">
            Watch reels
          </LinkButton>
        }
      />
      <StoriesBar groups={stories.data ?? []} onChanged={() => void stories.refetch()} />
      <PostList
        query={posts}
        showCommunity
        empty={
          <EmptyState
            title="Your feed is quiet"
            body="Join a few communities to fill it up."
            action={<LinkButton to="/communities">Find communities</LinkButton>}
          />
        }
      />
    </div>
  );
};

export const ReelsPage = () => {
  const posts = usePosts(['reels'], '/v1/reels');
  const reels = posts.data?.pages.flat() ?? [];
  if (posts.isPending) return <Spinner />;
  if (posts.isError) return <ErrorNotice error={posts.error} />;
  if (reels.length === 0) {
    return (
      <EmptyState
        title="No reels yet"
        body="Reels from your communities show up here."
        action={<LinkButton to="/communities">Find communities</LinkButton>}
      />
    );
  }
  return <ReelStack posts={reels} />;
};

const ReelStack = ({ posts }: { posts: Post[] }) => (
  <div className="reel-feed mx-auto h-[calc(100dvh-12rem)] max-w-sm space-y-4 overflow-y-auto rounded-3xl">
    {posts.map((post) => (
      <Reel key={post.id} post={post} />
    ))}
  </div>
);

const Reel = ({ post }: { post: Post }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [liked, setLiked] = useState(post.likedByYou);
  const [likes, setLikes] = useState(post.likeCount);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void element.play().catch(() => {});
        else element.pause();
      },
      { threshold: 0.6 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const like = useMutation({
    mutationFn: (on: boolean) =>
      on ? api.post(`/v1/posts/${post.id}/like`) : api.delete(`/v1/posts/${post.id}/like`),
    onMutate: (on) => {
      setLiked(on);
      setLikes((n) => n + (on ? 1 : -1));
    },
    onError: toastError,
  });

  const media = post.media[0];
  return (
    <div className="relative h-full overflow-hidden rounded-3xl bg-black">
      {media && (
        <video
          ref={video}
          src={media.url}
          loop
          muted
          playsInline
          className="h-full w-full object-cover"
          onClick={(e) => (e.currentTarget.muted = !e.currentTarget.muted)}
        />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-16">
        <div className="flex items-center gap-2">
          <span className="scale-75">
            <AuthorAvatar author={post.author} />
          </span>
          <span className="font-medium">{post.author.displayName}</span>
          <Link to={`/c/${post.community.slug}`} className="text-sm text-white/70 hover:text-amber">
            {post.community.name}
          </Link>
        </div>
        {post.body && <p className="mt-2 line-clamp-3 text-sm">{post.body}</p>}
      </div>
      <div className="absolute right-3 bottom-24 flex flex-col items-center gap-4">
        <button
          type="button"
          aria-pressed={liked}
          onClick={() => like.mutate(!liked)}
          className="flex flex-col items-center text-xs"
        >
          <Heart
            className={clsx('size-8', liked ? 'fill-ember text-ember' : 'text-white')}
            aria-hidden
          />
          {likes}
        </button>
        <span className="flex flex-col items-center text-xs">
          <MessageSquare className="size-8" aria-hidden />
          {post.commentCount}
        </span>
      </div>
    </div>
  );
};

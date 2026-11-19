import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { STORY_TTL_HOURS } from '@reomi/shared';
import type {
  Author,
  Comment,
  Community,
  CommunityDetail,
  communityListQuery,
  CreateCommunityInput,
  CreatePostInput,
  Member,
  Post,
  StoryGroup,
} from '@reomi/shared';
import {
  communities,
  communityMembers,
  messages,
  postComments,
  postLikes,
  posts,
  profiles,
  stories,
} from '../db/schema';
import { AppError, conflict, forbidden, isUniqueViolation, notFound } from '../lib/errors';
import { scanCommunityText } from '../lib/moderation';
import type { Ctx } from './common';
import { iso, likeTerm, pageOffset } from './common';
import { claimMedia, loadMedia, signPaths } from './media.service';
import { assertNotMuted, enforce, report } from './moderation.service';
import { notify } from './notify.service';

type CommunityRow = typeof communities.$inferSelect;
type MemberRow = typeof communityMembers.$inferSelect;
type Profile = typeof profiles.$inferSelect;

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'community';

const memberCountSql = sql<number>`(select count(*)::int from community_members m
  where m.community_id = communities.id and m.status = 'active')`;
const postCountSql = sql<number>`(select count(*)::int from posts p
  where p.community_id = communities.id and p.removed_at is null)`;

const membershipOf = async (ctx: Ctx, communityId: string, userId: string | undefined) => {
  if (!userId) return null;
  const [row] = await ctx.db
    .select()
    .from(communityMembers)
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
  return row ?? null;
};

const bySlug = async (ctx: Ctx, slug: string) => {
  const [row] = await ctx.db.select().from(communities).where(eq(communities.slug, slug));
  if (!row) throw notFound('Community');
  return row;
};

/** Content is for members only. Open communities let anyone join, private ones need approval. */
const requireMember = async (ctx: Ctx, community: CommunityRow, userId: string) => {
  const membership = await membershipOf(ctx, community.id, userId);
  if (!membership || membership.status !== 'active') {
    throw forbidden('not_a_member', 'Join this community to see and share posts');
  }
  return membership;
};

const isModerator = (membership: MemberRow | null) =>
  membership?.status === 'active' &&
  (membership.role === 'owner' || membership.role === 'moderator');

const toCommunity = (
  row: CommunityRow,
  counts: { members: number; posts: number },
  membership: MemberRow | null,
): Community => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  tagline: row.tagline,
  topic: row.topic,
  visibility: row.visibility,
  memberCount: counts.members,
  postCount: counts.posts,
  myStatus: membership?.status ?? null,
  myRole: membership?.role ?? null,
});

export const listCommunities = async (
  ctx: Ctx,
  query: z.infer<typeof communityListQuery>,
  viewerId?: string,
) => {
  const mine =
    query.mine && viewerId
      ? sql`exists (select 1 from community_members m where m.community_id = communities.id
        and m.user_id = ${viewerId} and m.status in ('active', 'pending'))`
      : undefined;
  const where = and(
    query.topic ? eq(communities.topic, query.topic) : undefined,
    query.q
      ? or(
          ilike(communities.name, likeTerm(query.q)),
          ilike(communities.tagline, likeTerm(query.q)),
        )
      : undefined,
    mine,
  );
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({ community: communities, members: memberCountSql, posts: postCountSql })
      .from(communities)
      .where(where)
      .orderBy(desc(memberCountSql), desc(communities.createdAt))
      .limit(query.pageSize)
      .offset(pageOffset(query)),
    ctx.db.select({ value: count() }).from(communities).where(where),
  ]);
  const memberships =
    viewerId && rows.length
      ? await ctx.db
          .select()
          .from(communityMembers)
          .where(
            and(
              eq(communityMembers.userId, viewerId),
              inArray(
                communityMembers.communityId,
                rows.map((r) => r.community.id),
              ),
            ),
          )
      : [];
  return {
    items: rows.map((row) =>
      toCommunity(
        row.community,
        row,
        memberships.find((m) => m.communityId === row.community.id) ?? null,
      ),
    ),
    total: total?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export const getCommunity = async (
  ctx: Ctx,
  slug: string,
  viewerId?: string,
): Promise<CommunityDetail> => {
  const [row] = await ctx.db
    .select({ community: communities, members: memberCountSql, posts: postCountSql })
    .from(communities)
    .where(eq(communities.slug, slug));
  if (!row) throw notFound('Community');
  const membership = await membershipOf(ctx, row.community.id, viewerId);
  let pendingRequests = 0;
  if (isModerator(membership)) {
    const [pending] = await ctx.db
      .select({ value: count() })
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityId, row.community.id),
          eq(communityMembers.status, 'pending'),
        ),
      );
    pendingRequests = pending?.value ?? 0;
  }
  return {
    ...toCommunity(row.community, row, membership),
    description: row.community.description,
    rules: row.community.rules,
    myDisplayName: membership?.displayName ?? null,
    pendingRequests,
    createdAt: iso(row.community.createdAt),
  };
};

export const createCommunity = async (ctx: Ctx, userId: string, input: CreateCommunityInput) => {
  for (const text of [input.name, input.tagline, input.description, input.rules]) {
    const verdict = scanCommunityText(text);
    if (verdict.verdict === 'block') {
      await enforce(ctx, { userId, context: 'post', excerpt: text }, verdict);
    }
  }
  const base = slugify(input.name);
  let slug = base;
  for (let attempt = 2; ; attempt += 1) {
    const [taken] = await ctx.db
      .select({ id: communities.id })
      .from(communities)
      .where(eq(communities.slug, slug));
    if (!taken) break;
    slug = `${base}-${attempt}`;
  }
  try {
    return await ctx.db.transaction(async (tx) => {
      const [community] = await tx
        .insert(communities)
        .values({
          slug,
          name: input.name,
          tagline: input.tagline,
          description: input.description,
          rules: input.rules,
          topic: input.topic,
          visibility: input.visibility,
          createdBy: userId,
        })
        .returning();
      await tx.insert(communityMembers).values({
        communityId: community!.id,
        userId,
        role: 'owner',
        status: 'active',
        displayName: input.displayName,
      });
      return { slug: community!.slug };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict('community_name_taken', 'A community with that name exists');
    throw error;
  }
};

export const joinCommunity = async (
  ctx: Ctx,
  slug: string,
  userId: string,
  input: { displayName: string; useProfilePhoto: boolean },
) => {
  const community = await bySlug(ctx, slug);
  const existing = await membershipOf(ctx, community.id, userId);
  if (existing?.status === 'banned')
    throw forbidden('forbidden', 'You cannot rejoin this community');
  if (existing) return { status: existing.status };
  const status: MemberRow['status'] = community.visibility === 'open' ? 'active' : 'pending';
  try {
    await ctx.db.insert(communityMembers).values({
      communityId: community.id,
      userId,
      displayName: input.displayName,
      useProfilePhoto: input.useProfilePhoto,
      status,
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict('display_name_taken', 'Someone here already uses that name');
    throw error;
  }
  if (status === 'pending') {
    const mods = await ctx.db
      .select({ userId: communityMembers.userId })
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityId, community.id),
          eq(communityMembers.status, 'active'),
          inArray(communityMembers.role, ['owner', 'moderator']),
        ),
      );
    await notify(
      ctx,
      mods.map((m) => m.userId),
      {
        kind: 'community_request',
        title: `${input.displayName} asked to join ${community.name}`,
        link: `/c/${community.slug}/members`,
      },
    );
  }
  return { status };
};

export const leaveCommunity = async (ctx: Ctx, slug: string, userId: string) => {
  const community = await bySlug(ctx, slug);
  const membership = await membershipOf(ctx, community.id, userId);
  if (!membership || membership.status === 'banned') return;
  if (membership.role === 'owner') {
    throw new AppError(
      409,
      'conflict',
      'Owners cannot leave. Make someone else a moderator first.',
    );
  }
  await ctx.db.delete(communityMembers).where(eq(communityMembers.id, membership.id));
};

const authorFrom = (member: MemberRow, avatarUrl: string | null): Author => ({
  memberId: member.id,
  displayName: member.displayName,
  avatarUrl,
  role: member.role,
});

/** Avatar URLs for members who chose to show their profile photo in a community. */
const memberAvatars = async (ctx: Ctx, members: MemberRow[]) => {
  const userIds = [...new Set(members.filter((m) => m.useProfilePhoto).map((m) => m.userId))];
  if (userIds.length === 0) return new Map<string, string>();
  const rows = await ctx.db
    .select({ id: profiles.id, avatarPath: profiles.avatarPath })
    .from(profiles)
    .where(inArray(profiles.id, userIds));
  const urls = await signPaths(
    ctx,
    rows.map((r) => r.avatarPath),
  );
  const byMember = new Map<string, string>();
  for (const member of members) {
    if (!member.useProfilePhoto) continue;
    const path = rows.find((r) => r.id === member.userId)?.avatarPath;
    const url = path ? urls.get(path) : undefined;
    if (url) byMember.set(member.id, url);
  }
  return byMember;
};

export const listMembers = async (
  ctx: Ctx,
  slug: string,
  viewerId: string,
  status: 'active' | 'pending' = 'active',
): Promise<Member[]> => {
  const community = await bySlug(ctx, slug);
  const membership = await requireMember(ctx, community, viewerId);
  if (status === 'pending' && !isModerator(membership)) {
    throw forbidden('forbidden', 'Only moderators can see join requests');
  }
  const rows = await ctx.db
    .select()
    .from(communityMembers)
    .where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.status, status)))
    .orderBy(
      sql`case ${communityMembers.role} when 'owner' then 0 when 'moderator' then 1 else 2 end`,
      asc(communityMembers.joinedAt),
    )
    .limit(500);
  const avatars = await memberAvatars(ctx, rows);
  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    avatarUrl: avatars.get(row.id) ?? null,
    isYou: row.userId === viewerId,
    joinedAt: iso(row.joinedAt),
  }));
};

export const updateMember = async (
  ctx: Ctx,
  slug: string,
  viewerId: string,
  memberId: string,
  patch: { role?: 'moderator' | 'member' | undefined; status?: MemberRow['status'] | undefined },
) => {
  const community = await bySlug(ctx, slug);
  const membership = await requireMember(ctx, community, viewerId);
  if (!isModerator(membership)) throw forbidden('forbidden', 'Only moderators can manage members');
  const [target] = await ctx.db
    .select()
    .from(communityMembers)
    .where(and(eq(communityMembers.id, memberId), eq(communityMembers.communityId, community.id)));
  if (!target) throw notFound('Member');
  if (target.role === 'owner') throw forbidden('forbidden', 'The owner cannot be changed');
  if (patch.role && membership.role !== 'owner')
    throw forbidden('forbidden', 'Only the owner can appoint moderators');
  await ctx.db
    .update(communityMembers)
    .set({
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    })
    .where(eq(communityMembers.id, target.id));
  if (target.status === 'pending' && patch.status === 'active') {
    await notify(ctx, [target.userId], {
      kind: 'community_approved',
      title: `You are in: ${community.name}`,
      link: `/c/${community.slug}`,
    });
  }
};

/* Posts ------------------------------------------------------------------------------------ */

type PostScope =
  | { kind: 'community'; communityId: string }
  | { kind: 'feed'; userId: string }
  | { kind: 'reels'; userId: string };

const myCommunitiesSql = (userId: string) => sql`${posts.communityId} in (
  select community_id from community_members where user_id = ${userId} and status = 'active')`;

export const buildPosts = async (
  ctx: Ctx,
  where: ReturnType<typeof and>,
  viewerId: string,
  limit: number,
): Promise<Post[]> => {
  const rows = await ctx.db
    .select({
      post: posts,
      member: communityMembers,
      community: { slug: communities.slug, name: communities.name, id: communities.id },
      likeCount: sql<number>`(select count(*)::int from post_likes l where l.post_id = ${posts.id})`,
      commentCount: sql<number>`(select count(*)::int from post_comments c
        where c.post_id = ${posts.id} and c.removed_at is null)`,
      liked: sql<boolean>`exists (select 1 from post_likes l where l.post_id = ${posts.id}
        and l.user_id = ${viewerId})`,
      viewerRole: sql<string | null>`(select m.role::text from community_members m
        where m.community_id = ${posts.communityId} and m.user_id = ${viewerId} and m.status = 'active')`,
    })
    .from(posts)
    .innerJoin(communityMembers, eq(communityMembers.id, posts.memberId))
    .innerJoin(communities, eq(communities.id, posts.communityId))
    .where(and(isNull(posts.removedAt), where))
    .orderBy(desc(posts.createdAt))
    .limit(limit);
  const [mediaMap, avatars] = await Promise.all([
    loadMedia(
      ctx,
      rows.flatMap((row) => row.post.mediaIds),
    ),
    memberAvatars(
      ctx,
      rows.map((row) => row.member),
    ),
  ]);
  return rows.map((row) => ({
    id: row.post.id,
    community: { slug: row.community.slug, name: row.community.name },
    kind: row.post.kind,
    body: row.post.body,
    media: row.post.mediaIds.flatMap((id) => {
      const item = mediaMap.get(id);
      return item ? [item] : [];
    }),
    author: authorFrom(row.member, avatars.get(row.member.id) ?? null),
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    likedByYou: row.liked,
    canDelete:
      row.post.authorId === viewerId ||
      row.viewerRole === 'owner' ||
      row.viewerRole === 'moderator',
    createdAt: iso(row.post.createdAt),
  }));
};

export const listPosts = async (
  ctx: Ctx,
  scope: PostScope,
  viewerId: string,
  query: { before?: string | undefined; limit: number },
) => {
  const before = query.before ? lt(posts.createdAt, new Date(query.before)) : undefined;
  if (scope.kind === 'community') {
    return buildPosts(
      ctx,
      and(eq(posts.communityId, scope.communityId), before),
      viewerId,
      query.limit,
    );
  }
  if (scope.kind === 'reels') {
    return buildPosts(
      ctx,
      and(myCommunitiesSql(scope.userId), eq(posts.kind, 'reel'), before),
      viewerId,
      query.limit,
    );
  }
  return buildPosts(ctx, and(myCommunitiesSql(scope.userId), before), viewerId, query.limit);
};

export const communityPosts = async (
  ctx: Ctx,
  slug: string,
  viewerId: string,
  query: { before?: string | undefined; limit: number },
) => {
  const community = await bySlug(ctx, slug);
  await requireMember(ctx, community, viewerId);
  return listPosts(ctx, { kind: 'community', communityId: community.id }, viewerId, query);
};

export const createPost = async (
  ctx: Ctx,
  slug: string,
  profile: Profile,
  input: CreatePostInput,
) => {
  const community = await bySlug(ctx, slug);
  const membership = await requireMember(ctx, community, profile.id);
  assertNotMuted(profile);
  if (input.body) {
    const verdict = scanCommunityText(input.body);
    if (verdict.verdict === 'block') {
      await enforce(
        ctx,
        { userId: profile.id, context: 'post', excerpt: input.body, communityId: community.id },
        verdict,
      );
    }
  }
  const id = await ctx.db.transaction(async (tx) => {
    const files = await claimMedia(tx, profile.id, input.mediaIds, 'post');
    const videos = files.filter((f) => f.contentType.startsWith('video/'));
    if (
      (input.kind === 'video' || input.kind === 'reel') &&
      (videos.length !== 1 || files.length !== 1)
    ) {
      throw new AppError(400, 'media_invalid', 'Videos and reels take exactly one video');
    }
    if (input.kind === 'photo' && videos.length > 0) {
      throw new AppError(400, 'media_invalid', 'Photo posts take images only');
    }
    const [post] = await tx
      .insert(posts)
      .values({
        communityId: community.id,
        memberId: membership.id,
        authorId: profile.id,
        kind: input.kind,
        body: input.body,
        mediaIds: files.map((f) => f.id),
      })
      .returning({ id: posts.id });
    return post!.id;
  });
  const [post] = await buildPosts(ctx, and(eq(posts.id, id)), profile.id, 1);
  return post!;
};

const postWithAccess = async (ctx: Ctx, postId: string, viewerId: string) => {
  const [row] = await ctx.db
    .select({ post: posts, community: communities })
    .from(posts)
    .innerJoin(communities, eq(communities.id, posts.communityId))
    .where(and(eq(posts.id, postId), isNull(posts.removedAt)));
  if (!row) throw notFound('Post');
  const membership = await requireMember(ctx, row.community, viewerId);
  return { ...row, membership };
};

export const deletePost = async (ctx: Ctx, postId: string, viewerId: string) => {
  const { post, membership } = await postWithAccess(ctx, postId, viewerId);
  if (post.authorId !== viewerId && !isModerator(membership)) {
    throw forbidden('forbidden', 'You can delete only your own posts');
  }
  await ctx.db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, postId));
};

export const setLike = async (ctx: Ctx, postId: string, viewerId: string, liked: boolean) => {
  await postWithAccess(ctx, postId, viewerId);
  if (liked)
    await ctx.db.insert(postLikes).values({ postId, userId: viewerId }).onConflictDoNothing();
  else
    await ctx.db
      .delete(postLikes)
      .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, viewerId)));
};

export const listComments = async (
  ctx: Ctx,
  postId: string,
  viewerId: string,
): Promise<Comment[]> => {
  const { membership } = await postWithAccess(ctx, postId, viewerId);
  const rows = await ctx.db
    .select({ comment: postComments, member: communityMembers })
    .from(postComments)
    .innerJoin(communityMembers, eq(communityMembers.id, postComments.memberId))
    .where(and(eq(postComments.postId, postId), isNull(postComments.removedAt)))
    .orderBy(asc(postComments.createdAt))
    .limit(200);
  const avatars = await memberAvatars(
    ctx,
    rows.map((r) => r.member),
  );
  return rows.map(({ comment, member }) => ({
    id: comment.id,
    body: comment.body,
    author: authorFrom(member, avatars.get(member.id) ?? null),
    canDelete: comment.authorId === viewerId || isModerator(membership),
    createdAt: iso(comment.createdAt),
  }));
};

export const createComment = async (ctx: Ctx, postId: string, profile: Profile, body: string) => {
  const { post, membership, community } = await postWithAccess(ctx, postId, profile.id);
  assertNotMuted(profile);
  const verdict = scanCommunityText(body);
  if (verdict.verdict === 'block') {
    await enforce(
      ctx,
      { userId: profile.id, context: 'comment', excerpt: body, communityId: community.id },
      verdict,
    );
  }
  await ctx.db
    .insert(postComments)
    .values({ postId, memberId: membership.id, authorId: profile.id, body });
  if (post.authorId !== profile.id) {
    await notify(ctx, [post.authorId], {
      kind: 'comment',
      title: `${membership.displayName} commented on your post`,
      body: body.slice(0, 120),
      link: `/c/${community.slug}`,
    });
  }
  return listComments(ctx, postId, profile.id);
};

export const deleteComment = async (ctx: Ctx, commentId: string, viewerId: string) => {
  const [row] = await ctx.db.select().from(postComments).where(eq(postComments.id, commentId));
  if (!row || row.removedAt) throw notFound('Comment');
  const { membership } = await postWithAccess(ctx, row.postId, viewerId);
  if (row.authorId !== viewerId && !isModerator(membership)) {
    throw forbidden('forbidden', 'You can delete only your own comments');
  }
  await ctx.db
    .update(postComments)
    .set({ removedAt: new Date() })
    .where(eq(postComments.id, commentId));
};

/* Stories ---------------------------------------------------------------------------------- */

export const listStories = async (
  ctx: Ctx,
  viewerId: string,
  slug?: string,
): Promise<StoryGroup[]> => {
  let scope;
  if (slug) {
    const community = await bySlug(ctx, slug);
    await requireMember(ctx, community, viewerId);
    scope = eq(stories.communityId, community.id);
  } else {
    scope = sql`${stories.communityId} in (select community_id from community_members
      where user_id = ${viewerId} and status = 'active')`;
  }
  const rows = await ctx.db
    .select({
      story: stories,
      member: communityMembers,
      community: { slug: communities.slug, name: communities.name },
    })
    .from(stories)
    .innerJoin(communityMembers, eq(communityMembers.id, stories.memberId))
    .innerJoin(communities, eq(communities.id, stories.communityId))
    .where(and(scope, gt(stories.expiresAt, sql`now()`)))
    .orderBy(asc(stories.createdAt))
    .limit(300);
  const [mediaMap, avatars] = await Promise.all([
    loadMedia(
      ctx,
      rows.map((r) => r.story.mediaId),
    ),
    memberAvatars(
      ctx,
      rows.map((r) => r.member),
    ),
  ]);
  const groups = new Map<string, StoryGroup>();
  for (const row of rows) {
    const media = mediaMap.get(row.story.mediaId);
    if (!media) continue;
    let group = groups.get(row.member.id);
    if (!group) {
      group = {
        community: row.community,
        author: authorFrom(row.member, avatars.get(row.member.id) ?? null),
        stories: [],
      };
      groups.set(row.member.id, group);
    }
    group.stories.push({
      id: row.story.id,
      media,
      caption: row.story.caption,
      createdAt: iso(row.story.createdAt),
      expiresAt: iso(row.story.expiresAt),
    });
  }
  // Most recent storytellers first.
  return [...groups.values()].sort((a, b) =>
    b.stories.at(-1)!.createdAt.localeCompare(a.stories.at(-1)!.createdAt),
  );
};

export const createStory = async (
  ctx: Ctx,
  slug: string,
  profile: Profile,
  input: { mediaId: string; caption: string },
) => {
  const community = await bySlug(ctx, slug);
  const membership = await requireMember(ctx, community, profile.id);
  assertNotMuted(profile);
  if (input.caption) {
    const verdict = scanCommunityText(input.caption);
    if (verdict.verdict === 'block') {
      await enforce(
        ctx,
        { userId: profile.id, context: 'post', excerpt: input.caption, communityId: community.id },
        verdict,
      );
    }
  }
  await ctx.db.transaction(async (tx) => {
    const [file] = await claimMedia(tx, profile.id, [input.mediaId], 'story');
    await tx.insert(stories).values({
      communityId: community.id,
      memberId: membership.id,
      authorId: profile.id,
      mediaId: file!.id,
      caption: input.caption,
      expiresAt: new Date(Date.now() + STORY_TTL_HOURS * 3_600_000),
    });
  });
};

/* Reports ---------------------------------------------------------------------------------- */

export const reportContent = async (
  ctx: Ctx,
  reporterId: string,
  input: { targetType: 'post' | 'comment' | 'message'; targetId: string; reason: string },
) => {
  if (input.targetType === 'post') {
    const { post, community } = await postWithAccess(ctx, input.targetId, reporterId);
    await report(ctx, {
      reporterId,
      userId: post.authorId,
      excerpt: post.body || '(media post)',
      context: 'post',
      communityId: community.id,
      reason: input.reason,
    });
    return;
  }
  if (input.targetType === 'comment') {
    const [comment] = await ctx.db
      .select()
      .from(postComments)
      .where(eq(postComments.id, input.targetId));
    if (!comment) throw notFound('Comment');
    const { community } = await postWithAccess(ctx, comment.postId, reporterId);
    await report(ctx, {
      reporterId,
      userId: comment.authorId,
      excerpt: comment.body,
      context: 'comment',
      communityId: community.id,
      reason: input.reason,
    });
    return;
  }
  const [message] = await ctx.db.select().from(messages).where(eq(messages.id, input.targetId));
  if (!message || !message.senderId) throw notFound('Message');
  const { canSubscribe } = await import('./space.service');
  const channel = message.roomId ? `room:${message.roomId}` : `thread:${message.threadId}`;
  if (!(await canSubscribe(ctx, reporterId, channel))) throw notFound('Message');
  await report(ctx, {
    reporterId,
    userId: message.senderId,
    excerpt: message.body,
    context: message.roomId ? 'room' : 'thread',
    roomId: message.roomId,
    reason: input.reason,
  });
};

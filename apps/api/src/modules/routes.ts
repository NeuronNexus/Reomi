import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ACTIVITY_LIBRARY,
  activityDto,
  activityRespondInput,
  applicantDto,
  applyInput,
  checkoutDto,
  commentDto,
  communityDetailDto,
  communityDto,
  communityListQuery,
  confirmConnectionInput,
  confirmPaymentInput,
  createActivityInput,
  createCommentInput,
  createCommunityInput,
  createPostInput,
  createRoomInput,
  createRoomResponse,
  createStoryInput,
  cursorQuery,
  decisionInput,
  followDto,
  hostApplicationInput,
  hostProfileDto,
  hostRoomDashboardDto,
  hostRoomDto,
  joinCommunityInput,
  leaderboardEntryDto,
  lobbyDto,
  mediaUploadDto,
  mediaUploadInput,
  meResponse,
  memberDto,
  memberPatch,
  messageDto,
  myApplicationDto,
  notificationsDto,
  onboardingInput,
  paginated,
  paginationQuery,
  paymentResultDto,
  planDto,
  postDto,
  profileInput,
  ratingInput,
  reportInput,
  revealDto,
  revealRequestInput,
  revealRespondInput,
  roomCardDto,
  roomDetailDto,
  roomListQuery,
  sendMessageInput,
  slugParam,
  spaceDto,
  storyGroupDto,
  threadDto,
  uuidParam,
  whisperInput,
} from '@reomi/shared';
import { features, planFeatures, plans } from '../db/schema';
import { currentUser } from '../plugins/auth';
import * as account from './account.service';
import { toFeature } from './admin.service';
import type { Ctx } from './common';
import * as communities from './communities.service';
import { maxTicketFor } from './host.service';
import * as host from './host.service';
import * as hosts from './hosts.service';
import * as media from './media.service';
import * as notifications from './notify.service';
import * as payments from './payments.service';
import * as reveals from './reveals.service';
import * as rooms from './rooms.service';
import * as space from './space.service';

const noContent = { 204: z.null() };
const idOnly = z.object({ threadId: z.uuid() });

export const contextOf = (app: FastifyInstance): Ctx => ({
  db: app.db,
  hub: app.realtime,
  storage: app.storage,
  config: app.config,
  provider: app.payments,
});

export const publicRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = contextOf(app);

  app.get(
    '/plans',
    { schema: { tags: ['catalogue'], response: { 200: z.array(planDto) } } },
    async () => {
      const rows = await app.db
        .select()
        .from(plans)
        .where(eq(plans.isActive, true))
        .orderBy(asc(plans.sortOrder));
      const links = await app.db
        .select({ planId: planFeatures.planId, feature: features })
        .from(planFeatures)
        .innerJoin(features, eq(features.key, planFeatures.featureKey))
        .orderBy(asc(features.sortOrder));
      return rows.map((plan) => ({
        ...plan,
        maxTicketPaise: maxTicketFor(plan),
        features: links.filter((link) => link.planId === plan.id).map((l) => toFeature(l.feature)),
      }));
    },
  );

  app.get(
    '/activity-library',
    {
      schema: {
        tags: ['catalogue'],
        response: {
          200: z.array(z.object({ kind: z.string(), title: z.string(), options: z.array(z.string()) })),
        },
      },
    },
    async () => ACTIVITY_LIBRARY,
  );

  app.get(
    '/rooms',
    {
      onRequest: [app.optionalAuth],
      schema: { tags: ['rooms'], querystring: roomListQuery, response: { 200: paginated(roomCardDto) } },
    },
    async (request) => rooms.listRooms(ctx, request.query, request.auth?.profile.id),
  );

  app.get(
    '/rooms/by-code/:code',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['rooms'],
        params: z.object({ code: z.string().trim().min(4).max(20) }),
        response: { 200: z.object({ roomId: z.uuid() }) },
      },
    },
    async (request) => rooms.findRoomByCode(ctx, request.params.code),
  );

  app.get(
    '/rooms/:id',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['rooms'],
        params: uuidParam,
        querystring: z.object({ code: z.string().max(20).optional() }),
        response: { 200: roomDetailDto },
      },
    },
    async (request) =>
      rooms.getRoom(ctx, request.params.id, request.auth?.profile.id, request.query.code),
  );

  app.get(
    '/hosts/:id',
    {
      onRequest: [app.optionalAuth],
      schema: { tags: ['hosts'], params: uuidParam, response: { 200: hostProfileDto } },
    },
    async (request) => {
      const viewerId = request.auth?.profile.id;
      const base = await hosts.hostProfileBase(ctx, request.params.id, viewerId);
      const query = { page: 1, pageSize: 24, hostId: request.params.id };
      const [live, upcoming] = await Promise.all([
        rooms.listRooms(ctx, { ...query, when: 'live' }, viewerId),
        rooms.listRooms(ctx, { ...query, when: 'upcoming' }, viewerId),
      ]);
      return { ...base, live: live.items, upcoming: upcoming.items };
    },
  );

  app.get(
    '/leaderboard',
    { schema: { tags: ['hosts'], response: { 200: z.array(leaderboardEntryDto) } } },
    async () => hosts.leaderboard(ctx),
  );

  app.get(
    '/communities',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['communities'],
        querystring: communityListQuery,
        response: { 200: paginated(communityDto) },
      },
    },
    async (request) => communities.listCommunities(ctx, request.query, request.auth?.profile.id),
  );

  app.get(
    '/communities/:slug',
    {
      onRequest: [app.optionalAuth],
      schema: { tags: ['communities'], params: slugParam, response: { 200: communityDetailDto } },
    },
    async (request) => communities.getCommunity(ctx, request.params.slug, request.auth?.profile.id),
  );
};

export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  const ctx = contextOf(app);
  const me = (request: Parameters<typeof currentUser>[0]) => currentUser(request).profile;
  const chatLimit = { rateLimit: { max: 40, timeWindow: '1 minute' } };

  /* Account -------------------------------------------------------------------------------- */

  app.get('/me', { schema: { tags: ['account'], response: { 200: meResponse } } }, (request) =>
    account.toMe(ctx, currentUser(request)),
  );

  app.put(
    '/me/profile',
    { schema: { tags: ['account'], body: onboardingInput, response: noContent } },
    async (request, reply) => {
      await account.updateOnboarding(ctx, me(request).id, request.body);
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/me/details',
    {
      onRequest: [app.requireOnboarded],
      schema: { tags: ['account'], body: profileInput, response: noContent },
    },
    async (request, reply) => {
      await account.updateProfile(ctx, me(request).id, request.body);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me/applications',
    { schema: { tags: ['account'], response: { 200: z.array(myApplicationDto) } } },
    async (request) => rooms.listMyApplications(ctx, me(request).id),
  );

  app.get(
    '/me/notifications',
    { schema: { tags: ['account'], response: { 200: notificationsDto } } },
    async (request) => notifications.listNotifications(ctx, me(request).id),
  );

  app.post(
    '/me/notifications/read',
    {
      schema: {
        tags: ['account'],
        body: z.object({ ids: z.array(z.uuid()).max(100).optional() }),
        response: noContent,
      },
    },
    async (request, reply) => {
      await notifications.markRead(ctx, me(request).id, request.body.ids);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me/connections',
    { schema: { tags: ['account'], response: { 200: z.array(revealDto) } } },
    async (request) => reveals.listConnections(ctx, me(request).id),
  );

  app.get(
    '/me/following',
    { schema: { tags: ['account'], response: { 200: z.array(followDto) } } },
    async (request) => reveals.listFollowing(ctx, me(request).id),
  );

  app.post(
    '/media/uploads',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['media'], body: mediaUploadInput, response: { 201: mediaUploadDto } },
    },
    async (request, reply) =>
      reply.status(201).send(await media.createUpload(ctx, me(request).id, request.body)),
  );

  app.post(
    '/reports',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['moderation'], body: reportInput, response: noContent },
    },
    async (request, reply) => {
      await communities.reportContent(ctx, me(request).id, request.body);
      return reply.status(204).send(null);
    },
  );

  /* Rooms ---------------------------------------------------------------------------------- */

  app.post(
    '/rooms/:id/applications',
    {
      onRequest: [app.requireOnboarded],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['rooms'],
        params: uuidParam,
        body: applyInput,
        response: { 201: myApplicationDto },
      },
    },
    async (request, reply) => {
      const created = await rooms.applyToRoom(ctx, {
        roomId: request.params.id,
        userId: me(request).id,
        message: request.body.message,
        inviteCode: request.body.inviteCode,
      });
      return reply.status(201).send(created);
    },
  );

  app.delete(
    '/applications/:id',
    { schema: { tags: ['rooms'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await rooms.withdrawApplication(ctx, request.params.id, me(request).id);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/rooms/:id/waitlist',
    {
      onRequest: [app.requireOnboarded],
      schema: { tags: ['rooms'], params: uuidParam, response: noContent },
    },
    async (request, reply) => {
      await rooms.joinWaitlist(ctx, request.params.id, me(request).id);
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/rooms/:id/waitlist',
    { schema: { tags: ['rooms'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await rooms.leaveWaitlist(ctx, request.params.id, me(request).id);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/rooms/:id/lobby',
    { schema: { tags: ['rooms'], params: uuidParam, response: { 200: lobbyDto } } },
    async (request) => {
      const view = await space.getSpace(ctx, request.params.id, me(request));
      return {
        roomId: view.roomId,
        title: view.title,
        endsAt: view.endsAt,
        yourAlias: view.isHost ? null : view.you.name,
        members: view.members.map(({ alias }) => ({ alias })),
      };
    },
  );

  app.get(
    '/rooms/:id/space',
    { schema: { tags: ['space'], params: uuidParam, response: { 200: spaceDto } } },
    async (request) => space.getSpace(ctx, request.params.id, me(request)),
  );

  app.get(
    '/rooms/:id/messages',
    {
      schema: {
        tags: ['space'],
        params: uuidParam,
        querystring: cursorQuery,
        response: { 200: z.array(messageDto) },
      },
    },
    async (request) => space.listRoomMessages(ctx, request.params.id, me(request).id, request.query),
  );

  app.post(
    '/rooms/:id/messages',
    {
      config: chatLimit,
      schema: {
        tags: ['space'],
        params: uuidParam,
        body: sendMessageInput,
        response: { 201: messageDto },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await space.sendRoomMessage(ctx, request.params.id, me(request), request.body.body)),
  );

  app.post(
    '/rooms/:id/leave',
    { schema: { tags: ['space'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await rooms.leaveRoom(ctx, request.params.id, me(request).id);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/rooms/:id/rating',
    {
      schema: { tags: ['space'], params: uuidParam, body: ratingInput, response: noContent },
    },
    async (request, reply) => {
      await hosts.rateHost(ctx, { roomId: request.params.id, userId: me(request).id, ...request.body });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/rooms/:id/reveals',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['reveals'], params: uuidParam, body: revealRequestInput, response: noContent },
    },
    async (request, reply) => {
      await reveals.requestReveal(ctx, { roomId: request.params.id, userId: me(request).id, ...request.body });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/reveals/:id/respond',
    {
      schema: { tags: ['reveals'], params: uuidParam, body: revealRespondInput, response: noContent },
    },
    async (request, reply) => {
      await reveals.respondToReveal(ctx, {
        revealId: request.params.id,
        userId: me(request).id,
        ...request.body,
      });
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/reveals/:id',
    { schema: { tags: ['reveals'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await reveals.cancelReveal(ctx, request.params.id, me(request).id);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/reveals/:id/confirm',
    {
      schema: { tags: ['reveals'], params: uuidParam, body: confirmConnectionInput, response: noContent },
    },
    async (request, reply) => {
      await reveals.confirmConnection(ctx, request.params.id, me(request).id, request.body.stage);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/rooms/:id/whispers',
    {
      schema: { tags: ['threads'], params: uuidParam, body: whisperInput, response: { 200: idOnly } },
    },
    async (request) => space.openWhisper(ctx, request.params.id, me(request).id, request.body.toAlias),
  );

  app.post(
    '/users/:id/dm',
    { schema: { tags: ['threads'], params: uuidParam, response: { 200: idOnly } } },
    async (request) => space.openDirect(ctx, me(request).id, request.params.id),
  );

  app.post(
    '/hosts/:id/follow',
    { schema: { tags: ['hosts'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await hosts.followHost(ctx, me(request).id, request.params.id, true);
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/hosts/:id/follow',
    { schema: { tags: ['hosts'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await hosts.followHost(ctx, me(request).id, request.params.id, false);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/users/:id/follow',
    { schema: { tags: ['hosts'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await hosts.follow(ctx, me(request).id, request.params.id);
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/users/:id/follow',
    { schema: { tags: ['hosts'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await hosts.unfollow(ctx, me(request).id, request.params.id);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/threads',
    { schema: { tags: ['threads'], response: { 200: z.array(threadDto) } } },
    async (request) => space.listThreads(ctx, me(request).id),
  );

  app.get(
    '/threads/:id',
    { schema: { tags: ['threads'], params: uuidParam, response: { 200: threadDto } } },
    async (request) => space.getThread(ctx, request.params.id, me(request).id),
  );

  app.get(
    '/threads/:id/messages',
    {
      schema: {
        tags: ['threads'],
        params: uuidParam,
        querystring: cursorQuery,
        response: { 200: z.array(messageDto) },
      },
    },
    async (request) =>
      space.listThreadMessages(ctx, request.params.id, me(request).id, request.query),
  );

  app.post(
    '/threads/:id/messages',
    {
      config: chatLimit,
      schema: {
        tags: ['threads'],
        params: uuidParam,
        body: sendMessageInput,
        response: { 201: messageDto },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await space.sendThreadMessage(ctx, request.params.id, me(request), request.body.body)),
  );

  app.post(
    '/activities/:id/respond',
    {
      config: chatLimit,
      schema: {
        tags: ['space'],
        params: uuidParam,
        body: activityRespondInput,
        response: { 200: activityDto },
      },
    },
    async (request) => space.respondToActivity(ctx, request.params.id, me(request), request.body),
  );

  /* Payments ------------------------------------------------------------------------------- */

  app.post(
    '/applications/:id/checkout',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['payments'], params: uuidParam, response: { 200: checkoutDto } },
    },
    async (request) => payments.openTicketCheckout(ctx, request.params.id, me(request).id),
  );

  app.post(
    '/payments/:id/confirm',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['payments'],
        params: uuidParam,
        body: confirmPaymentInput,
        response: { 200: paymentResultDto },
      },
    },
    async (request) =>
      payments.confirmPayment(ctx, {
        paymentId: request.params.id,
        userId: me(request).id,
        ...request.body,
      }),
  );

  app.post(
    '/host/application',
    {
      onRequest: [app.requireOnboarded],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags: ['host'], body: hostApplicationInput, response: noContent },
    },
    async (request, reply) => {
      await host.submitHostApplication(ctx, currentUser(request), request.body);
      return reply.status(204).send(null);
    },
  );

  /* Communities ---------------------------------------------------------------------------- */

  app.post(
    '/communities',
    {
      onRequest: [app.requireOnboarded],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['communities'],
        body: createCommunityInput,
        response: { 201: z.object({ slug: z.string() }) },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await communities.createCommunity(ctx, me(request).id, request.body)),
  );

  app.post(
    '/communities/:slug/join',
    {
      onRequest: [app.requireOnboarded],
      schema: {
        tags: ['communities'],
        params: slugParam,
        body: joinCommunityInput,
        response: { 200: z.object({ status: z.enum(['active', 'pending', 'banned']) }) },
      },
    },
    async (request) =>
      communities.joinCommunity(ctx, request.params.slug, me(request).id, request.body),
  );

  app.delete(
    '/communities/:slug/membership',
    { schema: { tags: ['communities'], params: slugParam, response: noContent } },
    async (request, reply) => {
      await communities.leaveCommunity(ctx, request.params.slug, me(request).id);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/communities/:slug/members',
    {
      schema: {
        tags: ['communities'],
        params: slugParam,
        querystring: z.object({ status: z.enum(['active', 'pending']).default('active') }),
        response: { 200: z.array(memberDto) },
      },
    },
    async (request) =>
      communities.listMembers(ctx, request.params.slug, me(request).id, request.query.status),
  );

  app.patch(
    '/communities/:slug/members/:memberId',
    {
      schema: {
        tags: ['communities'],
        params: slugParam.extend({ memberId: z.uuid() }),
        body: memberPatch,
        response: noContent,
      },
    },
    async (request, reply) => {
      await communities.updateMember(
        ctx,
        request.params.slug,
        me(request).id,
        request.params.memberId,
        request.body,
      );
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/communities/:slug/posts',
    {
      schema: {
        tags: ['communities'],
        params: slugParam,
        querystring: cursorQuery,
        response: { 200: z.array(postDto) },
      },
    },
    async (request) =>
      communities.communityPosts(ctx, request.params.slug, me(request).id, request.query),
  );

  app.post(
    '/communities/:slug/posts',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['communities'],
        params: slugParam,
        body: createPostInput,
        response: { 201: postDto },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await communities.createPost(ctx, request.params.slug, me(request), request.body)),
  );

  app.get(
    '/communities/:slug/stories',
    {
      schema: { tags: ['communities'], params: slugParam, response: { 200: z.array(storyGroupDto) } },
    },
    async (request) => communities.listStories(ctx, me(request).id, request.params.slug),
  );

  app.post(
    '/communities/:slug/stories',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['communities'], params: slugParam, body: createStoryInput, response: noContent },
    },
    async (request, reply) => {
      await communities.createStory(ctx, request.params.slug, me(request), request.body);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/feed',
    { schema: { tags: ['communities'], querystring: cursorQuery, response: { 200: z.array(postDto) } } },
    async (request) =>
      communities.listPosts(ctx, { kind: 'feed', userId: me(request).id }, me(request).id, request.query),
  );

  app.get(
    '/reels',
    { schema: { tags: ['communities'], querystring: cursorQuery, response: { 200: z.array(postDto) } } },
    async (request) =>
      communities.listPosts(ctx, { kind: 'reels', userId: me(request).id }, me(request).id, request.query),
  );

  app.get(
    '/stories',
    { schema: { tags: ['communities'], response: { 200: z.array(storyGroupDto) } } },
    async (request) => communities.listStories(ctx, me(request).id),
  );

  app.delete(
    '/posts/:id',
    { schema: { tags: ['communities'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await communities.deletePost(ctx, request.params.id, me(request).id);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/posts/:id/like',
    { schema: { tags: ['communities'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await communities.setLike(ctx, request.params.id, me(request).id, true);
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/posts/:id/like',
    { schema: { tags: ['communities'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await communities.setLike(ctx, request.params.id, me(request).id, false);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/posts/:id/comments',
    { schema: { tags: ['communities'], params: uuidParam, response: { 200: z.array(commentDto) } } },
    async (request) => communities.listComments(ctx, request.params.id, me(request).id),
  );

  app.post(
    '/posts/:id/comments',
    {
      config: chatLimit,
      schema: {
        tags: ['communities'],
        params: uuidParam,
        body: createCommentInput,
        response: { 201: z.array(commentDto) },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await communities.createComment(ctx, request.params.id, me(request), request.body.body)),
  );

  app.delete(
    '/comments/:id',
    { schema: { tags: ['communities'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await communities.deleteComment(ctx, request.params.id, me(request).id);
      return reply.status(204).send(null);
    },
  );
};

export const hostRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  const ctx = contextOf(app);

  app.get(
    '/rooms',
    { schema: { tags: ['host'], response: { 200: z.array(hostRoomDto) } } },
    async (request) => host.listHostRooms(ctx, currentUser(request).profile.id),
  );

  app.get(
    '/rooms/:id',
    { schema: { tags: ['host'], params: uuidParam, response: { 200: hostRoomDashboardDto } } },
    async (request) =>
      host.getHostRoomDashboard(ctx, request.params.id, currentUser(request).profile.id),
  );

  app.get(
    '/rooms/:id/applications',
    {
      schema: {
        tags: ['host'],
        params: uuidParam,
        querystring: paginationQuery,
        response: { 200: paginated(applicantDto) },
      },
    },
    async (request) =>
      host.listApplicants(ctx, request.params.id, currentUser(request).profile.id, request.query),
  );

  app.post(
    '/rooms',
    {
      onRequest: [app.requireVerifiedHost],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['host'], body: createRoomInput, response: { 201: createRoomResponse } },
    },
    async (request, reply) => {
      const created = await host.createRoom(ctx, currentUser(request).profile.id, request.body);
      return reply.status(201).send(created);
    },
  );

  app.post(
    '/rooms/:id/checkout',
    {
      onRequest: [app.requireVerifiedHost],
      schema: { tags: ['host'], params: uuidParam, response: { 200: checkoutDto } },
    },
    async (request) =>
      host.retryPlanCheckout(ctx, request.params.id, currentUser(request).profile.id),
  );

  app.post(
    '/rooms/:id/applications/:applicationId/decision',
    {
      onRequest: [app.requireVerifiedHost],
      schema: {
        tags: ['host'],
        params: uuidParam.extend({ applicationId: z.uuid() }),
        body: decisionInput,
        response: noContent,
      },
    },
    async (request, reply) => {
      await host.decideApplication(ctx, {
        roomId: request.params.id,
        applicationId: request.params.applicationId,
        hostId: currentUser(request).profile.id,
        decision: request.body.decision,
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/rooms/:id/end',
    { schema: { tags: ['host'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await host.endRoom(ctx, request.params.id, currentUser(request).profile.id);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/rooms/:id/activities',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['host'],
        params: uuidParam,
        body: createActivityInput,
        response: { 201: messageDto },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await space.createActivity(ctx, request.params.id, currentUser(request).profile.id, request.body),
        ),
  );
};

/**
 * Lives in its own plugin because it needs the raw request bytes. The signature covers them
 * exactly, and JSON parsing first would make verification fail on any re-serialisation.
 */
export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) =>
    done(null, body),
  );

  app.post('/razorpay', { config: { rateLimit: false } }, async (request, reply) => {
    const signature = request.headers['x-razorpay-signature'];
    const raw = request.body as Buffer;
    if (
      typeof signature !== 'string' ||
      !Buffer.isBuffer(raw) ||
      !app.payments.verifyWebhookSignature(raw, signature)
    ) {
      return reply.status(400).send({ ok: false });
    }

    await payments.handleProviderEvent(
      contextOf(app),
      JSON.parse(raw.toString('utf8')),
      request.log,
    );
    return { ok: true };
  });
};

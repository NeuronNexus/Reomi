import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  applicantDto,
  applyInput,
  checkoutDto,
  confirmPaymentInput,
  createRoomInput,
  createRoomResponse,
  decisionInput,
  hostApplicationInput,
  hostRoomDashboardDto,
  hostRoomDto,
  lobbyDto,
  meResponse,
  myApplicationDto,
  onboardingInput,
  paginated,
  paginationQuery,
  paymentResultDto,
  planDto,
  roomCardDto,
  roomDetailDto,
  roomListQuery,
  uuidParam,
} from '@agnipath/shared';
import { features, planFeatures, plans } from '../db/schema';
import { currentUser, isOnboarded } from '../plugins/auth';
import type { AuthContext } from '../plugins/auth';
import { toFeature } from './admin.service';
import * as host from './host.service';
import * as payments from './payments.service';
import * as rooms from './rooms.service';

const noContent = { 204: z.null() };

const toMe = ({ profile, host: verification }: AuthContext): z.infer<typeof meResponse> => ({
  id: profile.id,
  email: profile.email,
  fullName: profile.fullName,
  dateOfBirth: profile.dateOfBirth,
  gender: profile.gender,
  interestedIn: profile.interestedIn as z.infer<typeof meResponse>['interestedIn'],
  role: profile.role,
  onboarded: isOnboarded(profile),
  host: verification
    ? {
        status: verification.status,
        displayName: verification.displayName,
        reviewNote: verification.reviewNote,
      }
    : null,
});

export const publicRoutes: FastifyPluginAsyncZod = async (app) => {
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
        features: links.filter((link) => link.planId === plan.id).map((l) => toFeature(l.feature)),
      }));
    },
  );

  app.get(
    '/rooms',
    {
      schema: {
        tags: ['rooms'],
        querystring: roomListQuery,
        response: { 200: paginated(roomCardDto) },
      },
    },
    async (request) => rooms.listRooms(app.db, request.query),
  );

  app.get(
    '/rooms/:id',
    {
      onRequest: [app.optionalAuth],
      schema: { tags: ['rooms'], params: uuidParam, response: { 200: roomDetailDto } },
    },
    async (request) => rooms.getRoom(app.db, request.params.id, request.auth?.profile.id),
  );
};

export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/me', { schema: { tags: ['account'], response: { 200: meResponse } } }, (request) =>
    Promise.resolve(toMe(currentUser(request))),
  );

  app.put(
    '/me/profile',
    { schema: { tags: ['account'], body: onboardingInput, response: noContent } },
    async (request, reply) => {
      await rooms.updateOnboarding(app.db, currentUser(request).profile.id, request.body);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me/applications',
    { schema: { tags: ['account'], response: { 200: z.array(myApplicationDto) } } },
    async (request) => rooms.listMyApplications(app.db, currentUser(request).profile.id),
  );

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
      const created = await rooms.applyToRoom(app.db, {
        roomId: request.params.id,
        userId: currentUser(request).profile.id,
        message: request.body.message,
      });
      return reply.status(201).send(created);
    },
  );

  app.delete(
    '/applications/:id',
    { schema: { tags: ['rooms'], params: uuidParam, response: noContent } },
    async (request, reply) => {
      await rooms.withdrawApplication(app.db, request.params.id, currentUser(request).profile.id);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/rooms/:id/lobby',
    { schema: { tags: ['rooms'], params: uuidParam, response: { 200: lobbyDto } } },
    async (request) => rooms.getLobby(app.db, request.params.id, currentUser(request).profile.id),
  );

  app.post(
    '/applications/:id/checkout',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['payments'], params: uuidParam, response: { 200: checkoutDto } },
    },
    async (request) =>
      payments.openTicketCheckout(
        { db: app.db, provider: app.payments },
        request.params.id,
        currentUser(request).profile.id,
      ),
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
      payments.confirmPayment(
        { db: app.db, provider: app.payments },
        {
          paymentId: request.params.id,
          userId: currentUser(request).profile.id,
          ...request.body,
        },
      ),
  );

  app.post(
    '/host/application',
    {
      onRequest: [app.requireOnboarded],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags: ['host'], body: hostApplicationInput, response: noContent },
    },
    async (request, reply) => {
      await host.submitHostApplication(app.db, currentUser(request), request.body);
      return reply.status(204).send(null);
    },
  );
};

export const hostRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  const deps = () => ({ db: app.db, provider: app.payments });

  app.get(
    '/rooms',
    { schema: { tags: ['host'], response: { 200: z.array(hostRoomDto) } } },
    async (request) => host.listHostRooms(app.db, currentUser(request).profile.id),
  );

  app.get(
    '/rooms/:id',
    { schema: { tags: ['host'], params: uuidParam, response: { 200: hostRoomDashboardDto } } },
    async (request) =>
      host.getHostRoomDashboard(app.db, request.params.id, currentUser(request).profile.id),
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
      host.listApplicants(
        app.db,
        request.params.id,
        currentUser(request).profile.id,
        request.query,
      ),
  );

  app.post(
    '/rooms',
    {
      onRequest: [app.requireVerifiedHost],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['host'], body: createRoomInput, response: { 201: createRoomResponse } },
    },
    async (request, reply) => {
      const created = await host.createRoom(deps(), currentUser(request).profile.id, request.body);
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
      host.retryPlanCheckout(deps(), request.params.id, currentUser(request).profile.id),
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
      await host.decideApplication(app.db, {
        roomId: request.params.id,
        applicationId: request.params.applicationId,
        hostId: currentUser(request).profile.id,
        decision: request.body.decision,
        paymentWindowHours: app.config.PAYMENT_WINDOW_HOURS,
      });
      return reply.status(204).send(null);
    },
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
      { db: app.db, provider: app.payments },
      JSON.parse(raw.toString('utf8')),
      request.log,
    );
    return { ok: true };
  });
};

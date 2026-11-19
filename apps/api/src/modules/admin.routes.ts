import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  adminFeatureInput,
  adminFeaturePatch,
  adminHostDecision,
  adminHostDto,
  adminHostQuery,
  adminPaymentDto,
  adminPaymentQuery,
  adminPlanDto,
  adminPlanFeaturesInput,
  adminPlanInput,
  adminPlanPatch,
  adminRoomDto,
  adminRoomPatch,
  adminRoomQuery,
  adminStatsDto,
  adminUserDto,
  adminUserPatch,
  adminUserQuery,
  featureDto,
  paginated,
  uuidParam,
} from '@reomi/shared';
import { currentUser } from '../plugins/auth';
import * as admin from './admin.service';

const noContent = { 204: z.null() };
const tags = ['admin'];

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.requireAdmin);

  const adminId = (request: Parameters<typeof currentUser>[0]) => currentUser(request).profile.id;

  app.get('/stats', { schema: { tags, response: { 200: adminStatsDto } } }, async () =>
    admin.getStats(app.db),
  );

  app.get(
    '/users',
    { schema: { tags, querystring: adminUserQuery, response: { 200: paginated(adminUserDto) } } },
    async (request) => admin.listUsers(app.db, request.query),
  );

  app.patch(
    '/users/:id',
    { schema: { tags, params: uuidParam, body: adminUserPatch, response: noContent } },
    async (request, reply) => {
      await admin.setUserStatus(app.db, adminId(request), request.params.id, request.body.status);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/hosts',
    { schema: { tags, querystring: adminHostQuery, response: { 200: paginated(adminHostDto) } } },
    async (request) => admin.listHosts(app.db, request.query),
  );

  app.patch(
    '/hosts/:id',
    { schema: { tags, params: uuidParam, body: adminHostDecision, response: noContent } },
    async (request, reply) => {
      await admin.decideHost(app.db, adminId(request), request.params.id, request.body);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/rooms',
    { schema: { tags, querystring: adminRoomQuery, response: { 200: paginated(adminRoomDto) } } },
    async (request) => admin.listRooms(app.db, request.query),
  );

  app.patch(
    '/rooms/:id',
    { schema: { tags, params: uuidParam, body: adminRoomPatch, response: noContent } },
    async (request, reply) => {
      await admin.updateRoom(app.db, adminId(request), request.params.id, request.body);
      return reply.status(204).send(null);
    },
  );

  app.get('/plans', { schema: { tags, response: { 200: z.array(adminPlanDto) } } }, async () =>
    admin.listAdminPlans(app.db),
  );

  app.post(
    '/plans',
    { schema: { tags, body: adminPlanInput, response: noContent } },
    async (request, reply) => {
      await admin.createPlan(app.db, adminId(request), request.body);
      return reply.status(204).send(null);
    },
  );

  app.patch(
    '/plans/:id',
    { schema: { tags, params: uuidParam, body: adminPlanPatch, response: noContent } },
    async (request, reply) => {
      await admin.updatePlan(app.db, adminId(request), request.params.id, request.body);
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/plans/:id/features',
    { schema: { tags, params: uuidParam, body: adminPlanFeaturesInput, response: noContent } },
    async (request, reply) => {
      await admin.setPlanFeatures(
        app.db,
        adminId(request),
        request.params.id,
        request.body.featureKeys,
      );
      return reply.status(204).send(null);
    },
  );

  app.get('/features', { schema: { tags, response: { 200: z.array(featureDto) } } }, async () =>
    admin.listFeatures(app.db),
  );

  app.post(
    '/features',
    { schema: { tags, body: adminFeatureInput, response: noContent } },
    async (request, reply) => {
      await admin.createFeature(app.db, adminId(request), request.body);
      return reply.status(204).send(null);
    },
  );

  app.patch(
    '/features/:key',
    {
      schema: {
        tags,
        params: z.object({ key: z.string().max(60) }),
        body: adminFeaturePatch,
        response: noContent,
      },
    },
    async (request, reply) => {
      await admin.updateFeature(app.db, adminId(request), request.params.key, request.body);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/payments',
    {
      schema: {
        tags,
        querystring: adminPaymentQuery,
        response: { 200: paginated(adminPaymentDto) },
      },
    },
    async (request) => admin.listPayments(app.db, request.query),
  );

  app.post(
    '/payments/:id/mark-refunded',
    { schema: { tags, params: uuidParam, response: noContent } },
    async (request, reply) => {
      await admin.markRefunded(app.db, adminId(request), request.params.id);
      return reply.status(204).send(null);
    },
  );
};

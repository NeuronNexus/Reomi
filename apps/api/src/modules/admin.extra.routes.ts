import { count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  adminCommunityDto,
  adminFlagDto,
  adminFlagPatch,
  adminFlagQuery,
  paginated,
  paginationQuery,
  uuidParam,
} from '@reomi/shared';
import { communities, profiles } from '../db/schema';
import { currentUser } from '../plugins/auth';
import { iso, pageOffset } from './common';
import { listFlags, reviewFlag } from './moderation.service';
import { contextOf } from './routes';

const tags = ['admin'];

export const adminModerationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.requireAdmin);
  const ctx = contextOf(app);

  app.get(
    '/flags',
    { schema: { tags, querystring: adminFlagQuery, response: { 200: paginated(adminFlagDto) } } },
    async (request) => listFlags(ctx, request.query),
  );

  app.patch(
    '/flags/:id',
    { schema: { tags, params: uuidParam, body: adminFlagPatch, response: { 204: z.null() } } },
    async (request, reply) => {
      await reviewFlag(ctx, currentUser(request).profile.id, request.params.id, request.body);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/communities',
    {
      schema: {
        tags,
        querystring: paginationQuery,
        response: { 200: paginated(adminCommunityDto) },
      },
    },
    async (request) => {
      const members = sql<number>`(select count(*)::int from community_members m
        where m.community_id = ${communities.id} and m.status = 'active')`;
      const postCount = sql<number>`(select count(*)::int from posts p
        where p.community_id = ${communities.id} and p.removed_at is null)`;
      const [rows, [total]] = await Promise.all([
        app.db
          .select({ community: communities, owner: profiles.email, members, posts: postCount })
          .from(communities)
          .innerJoin(profiles, eq(profiles.id, communities.createdBy))
          .orderBy(desc(communities.createdAt))
          .limit(request.query.pageSize)
          .offset(pageOffset(request.query)),
        app.db.select({ value: count() }).from(communities),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.community.id,
          slug: row.community.slug,
          name: row.community.name,
          topic: row.community.topic,
          visibility: row.community.visibility,
          memberCount: row.members,
          postCount: row.posts,
          ownerEmail: row.owner,
          createdAt: iso(row.community.createdAt),
        })),
        total: total?.value ?? 0,
        page: request.query.page,
        pageSize: request.query.pageSize,
      };
    },
  );
};

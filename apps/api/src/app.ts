import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { APP_NAME } from '@reomi/shared';
import type { Config } from './config';
import type { Db } from './db/client';
import type { PaymentProvider } from './lib/payment-provider';
import { RealtimeHub } from './lib/realtime';
import type { MediaStorage } from './lib/storage';
import type { TokenVerifier } from './lib/token-verifier';
import { adminRoutes } from './modules/admin.routes';
import { adminModerationRoutes } from './modules/admin.extra.routes';
import { localMediaRoutes, realtimeRoutes } from './modules/realtime.routes';
import { hostRoutes, memberRoutes, publicRoutes, webhookRoutes } from './modules/routes';
import { authPlugin } from './plugins/auth';
import { errorsPlugin } from './plugins/errors';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    payments: PaymentProvider;
    verifyToken: TokenVerifier;
    realtime: RealtimeHub;
    storage: MediaStorage;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  payments: PaymentProvider;
  verifyToken: TokenVerifier;
  storage: MediaStorage;
  realtime?: RealtimeHub;
}

export const buildApp = async ({
  config,
  db,
  payments,
  verifyToken,
  storage,
  realtime = new RealtimeHub(),
}: AppDeps) => {
  const isProduction = config.NODE_ENV === 'production';

  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            ...(isProduction ? {} : { transport: { target: 'pino-pretty' } }),
          },
    // Render puts exactly one proxy in front of the service. Trusting more would let clients
    // spoof X-Forwarded-For and dodge per-IP rate limits.
    trustProxy: (_address, hop) => hop === 0,
    bodyLimit: 256 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('payments', payments);
  app.decorate('verifyToken', verifyToken);
  app.decorate('realtime', realtime);
  app.decorate('storage', storage);

  await app.register(errorsPlugin);
  await app.register(helmet, {
    contentSecurityPolicy: isProduction ? { directives: { defaultSrc: ["'none'"] } } : false,
  });
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // Mobile carriers in India put very large numbers of people behind one IP, so limiting
    // signed-in traffic by IP would throttle strangers. Routes that matter all reject a made-up
    // token, so rotating fake tokens gains nothing there.
    keyGenerator: (request) => request.headers.authorization ?? request.ip,
  });

  if (!isProduction) {
    await app.register(swagger, {
      openapi: { info: { title: `${APP_NAME} API`, version: '0.1.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  await app.register(authPlugin);
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  await app.register(publicRoutes, { prefix: '/v1' });
  await app.register(memberRoutes, { prefix: '/v1' });
  await app.register(hostRoutes, { prefix: '/v1/host' });
  await app.register(adminRoutes, { prefix: '/v1/admin' });
  await app.register(adminModerationRoutes, { prefix: '/v1/admin' });
  await app.register(realtimeRoutes, { prefix: '/v1' });
  await app.register(localMediaRoutes, { prefix: '/media' });
  await app.register(webhookRoutes, { prefix: '/webhooks' });

  return app;
};

import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { profiles } from '../db/schema';
import { LocalStorage } from '../lib/storage';
import { userChannel } from '../lib/realtime';
import { contextOf } from './routes';
import { canSubscribe } from './space.service';

interface ClientFrame {
  type?: string;
  token?: string;
  channel?: string;
}

/**
 * One socket per client. The first frame must carry the access token, which keeps it out of URLs
 * and logs. After that the client subscribes to channels, and each subscription is checked against
 * the same membership rules as the REST endpoints.
 */
export const realtimeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const ctx = contextOf(app);

  app.get('/realtime', { websocket: true, config: { rateLimit: false } }, (socket, request) => {
    let userId: string | null = null;
    const subscribed = new Set<string>();
    const send = (frame: object) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    };

    const authTimer = setTimeout(() => {
      if (!userId) socket.close(4401, 'Authenticate first');
    }, 10_000);
    const ping = setInterval(() => send({ type: 'ping' }), 25_000);

    socket.on('message', (raw: Buffer) => {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(raw.toString('utf8')) as ClientFrame;
      } catch {
        return;
      }

      void (async () => {
        if (frame.type === 'auth' && frame.token) {
          try {
            const token = await app.verifyToken(frame.token);
            const [profile] = await app.db
              .select({ id: profiles.id, status: profiles.status })
              .from(profiles)
              .where(eq(profiles.id, token.userId));
            if (!profile || profile.status !== 'active') {
              socket.close(4403, 'Not allowed');
              return;
            }
            userId = profile.id;
            clearTimeout(authTimer);
            const own = userChannel(profile.id);
            app.realtime.subscribe(own, socket);
            subscribed.add(own);
            send({ type: 'ready' });
          } catch {
            socket.close(4401, 'Invalid token');
          }
          return;
        }
        if (!userId || !frame.channel) return;
        if (frame.type === 'subscribe') {
          if (subscribed.has(frame.channel)) return;
          if (await canSubscribe(ctx, userId, frame.channel)) {
            app.realtime.subscribe(frame.channel, socket);
            subscribed.add(frame.channel);
            send({ type: 'subscribed', channel: frame.channel });
          } else {
            send({ type: 'denied', channel: frame.channel });
          }
        } else if (frame.type === 'unsubscribe') {
          app.realtime.unsubscribe(frame.channel, socket);
          subscribed.delete(frame.channel);
        }
      })().catch((err: unknown) => request.log.warn({ err }, 'Realtime frame failed'));
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(ping);
      app.realtime.drop(socket);
    });
  });
};

/** Serves uploads in development, where there is no Supabase Storage. */
export const localMediaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const storage = app.storage;
  if (!(storage instanceof LocalStorage)) return;

  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 60 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.put<{ Params: { token: string } }>(
    '/local/:token',
    { bodyLimit: 60 * 1024 * 1024, config: { rateLimit: false } },
    async (request, reply) => {
      const grant = storage.verify(request.params.token);
      if (!grant || grant.mode !== 'put') return reply.status(403).send({ ok: false });
      if (!Buffer.isBuffer(request.body)) return reply.status(400).send({ ok: false });
      await storage.write(grant.path, request.body, grant.contentType);
      return { ok: true };
    },
  );

  app.get<{ Params: { token: string } }>(
    '/local/:token',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const grant = storage.verify(request.params.token);
      if (!grant || grant.mode !== 'get') return reply.status(403).send({ ok: false });
      const file = await storage.read(grant.path);
      if (!file) return reply.status(404).send({ ok: false });
      return reply
        .header('content-type', file.contentType)
        .header('cache-control', 'private, max-age=3600')
        .header('cross-origin-resource-policy', 'cross-origin')
        .send(file.data);
    },
  );
};

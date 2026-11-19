import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import { hostVerifications, profiles } from '../db/schema';
import { AppError, forbidden, isForeignKeyViolation } from '../lib/errors';

type Profile = typeof profiles.$inferSelect;
type HostVerification = typeof hostVerifications.$inferSelect;

export interface AuthContext {
  profile: Profile;
  host: HostVerification | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    optionalAuth: (request: FastifyRequest) => Promise<void>;
    requireOnboarded: (request: FastifyRequest) => Promise<void>;
    requireVerifiedHost: (request: FastifyRequest) => Promise<void>;
    requireAdmin: (request: FastifyRequest) => Promise<void>;
  }
}

const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

export const isOnboarded = (profile: Profile): boolean =>
  Boolean(
    profile.fullName && profile.dateOfBirth && profile.gender && profile.interestedIn.length > 0,
  );

/** For use after `authenticate` has run. */
export const currentUser = (request: FastifyRequest): AuthContext => {
  if (!request.auth) throw new AppError(401, 'unauthorized', 'Sign in to continue');
  return request.auth;
};

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auth', null);

  const loadContext = async (userId: string, email: string): Promise<AuthContext> => {
    const select = () =>
      app.db
        .select({ profile: profiles, host: hostVerifications })
        .from(profiles)
        .leftJoin(hostVerifications, eq(hostVerifications.userId, profiles.id))
        .where(eq(profiles.id, userId));

    let [row] = await select();
    if (!row) {
      try {
        await app.db.insert(profiles).values({ id: userId, email }).onConflictDoNothing();
      } catch (error) {
        // The token outlived its user: deleted accounts stay signed until the token expires.
        if (isForeignKeyViolation(error))
          throw new AppError(401, 'unauthorized', 'Account not found');
        throw error;
      }
      [row] = await select();
    }
    if (!row) throw new AppError(401, 'unauthorized', 'Account not found');
    return row;
  };

  const touchLastSeen = (request: FastifyRequest, profile: Profile) => {
    const now = Date.now();
    if (profile.lastSeenAt && now - profile.lastSeenAt.getTime() < LAST_SEEN_RESOLUTION_MS) return;
    // Presence is best effort and must never slow down or fail the request itself.
    app.db
      .update(profiles)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(profiles.id, profile.id))
      .catch((err: unknown) => request.log.warn({ err }, 'Could not update last seen'));
  };

  const resolve = async (request: FastifyRequest): Promise<AuthContext | null> => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    let token;
    try {
      token = await app.verifyToken(header.slice('Bearer '.length));
    } catch (err) {
      request.log.debug({ err }, 'Rejected access token');
      return null;
    }
    return loadContext(token.userId, token.email);
  };

  app.decorate('authenticate', async (request: FastifyRequest) => {
    const context = await resolve(request);
    if (!context) throw new AppError(401, 'unauthorized', 'Sign in to continue');
    if (context.profile.status === 'suspended') {
      throw forbidden('account_suspended', 'This account has been suspended');
    }
    request.auth = context;
    touchLastSeen(request, context.profile);
  });

  app.decorate('optionalAuth', async (request: FastifyRequest) => {
    const context = await resolve(request);
    if (context && context.profile.status === 'active') request.auth = context;
  });

  app.decorate('requireOnboarded', async (request: FastifyRequest) => {
    if (!isOnboarded(currentUser(request).profile)) {
      throw forbidden('onboarding_required', 'Finish setting up your profile first');
    }
  });

  app.decorate('requireVerifiedHost', async (request: FastifyRequest) => {
    if (currentUser(request).host?.status !== 'verified') {
      throw forbidden('host_verification_required', 'Only verified hosts can do this');
    }
  });

  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    if (currentUser(request).profile.role !== 'admin') {
      throw forbidden('forbidden', 'Admin access required');
    }
  });
});

import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyOptions } from 'jose';
import type { Config } from '../config';

export interface VerifiedToken {
  userId: string;
  email: string;
}

export type TokenVerifier = (token: string) => Promise<VerifiedToken>;

/**
 * Verifies Supabase access tokens. New projects sign with asymmetric keys published as JWKS;
 * legacy projects use a shared secret. Each path pins its own algorithms, so a token cannot
 * choose a weaker check by changing its header.
 */
export const createTokenVerifier = (config: Config): TokenVerifier => {
  const issuer = `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  const options: JWTVerifyOptions = { issuer, audience: 'authenticated' };
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const secret = config.SUPABASE_JWT_SECRET
    ? new TextEncoder().encode(config.SUPABASE_JWT_SECRET)
    : null;

  return async (token) => {
    const { alg } = decodeProtectedHeader(token);
    let payload: JWTPayload;
    if (alg === 'HS256') {
      if (!secret) throw new Error('HS256 token received but no shared secret is configured');
      ({ payload } = await jwtVerify(token, secret, { ...options, algorithms: ['HS256'] }));
    } else {
      ({ payload } = await jwtVerify(token, jwks, {
        ...options,
        algorithms: ['ES256', 'RS256'],
      }));
    }
    if (!payload.sub || typeof payload.email !== 'string') {
      throw new Error('Token is missing required claims');
    }
    return { userId: payload.sub, email: payload.email };
  };
};

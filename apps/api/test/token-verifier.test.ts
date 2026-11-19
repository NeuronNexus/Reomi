import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, exportSPKI, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey, JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createTokenVerifier } from '../src/lib/token-verifier';
import type { TokenVerifier } from '../src/lib/token-verifier';

/**
 * New Supabase projects sign with asymmetric keys, so this is the path production uses. A local
 * server publishes the JWKS at the same path Supabase does.
 */

const KID = 'test-key';
const USER = '6f1c2a54-9e1a-4c7e-8d1b-0a1b2c3d4e5f';

let server: Server;
let issuer: string;
let privateKey: CryptoKey;
let publicKeyPem: string;
let verify: TokenVerifier;

const sign = (
  key: CryptoKey | Uint8Array,
  alg: string,
  overrides: { kid?: string; issuer?: string; audience?: string; email?: string | null } = {},
) => {
  const claims = overrides.email === null ? {} : { email: overrides.email ?? 'a@example.com' };
  return new SignJWT(claims)
    .setProtectedHeader({ alg, kid: overrides.kid ?? KID })
    .setSubject(USER)
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? 'authenticated')
    .setExpirationTime('1h')
    .sign(key);
};

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateKey = pair.privateKey;
  publicKeyPem = await exportSPKI(pair.publicKey);
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };

  server = createServer((request, response) => {
    if (request.url === '/auth/v1/.well-known/jwks.json') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  issuer = `${url}/auth/v1`;
  verify = createTokenVerifier(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unused',
      SUPABASE_URL: url,
      PAYMENT_PROVIDER: 'mock',
    }),
  );
});

afterAll(() => {
  server.close();
});

describe('asymmetric Supabase tokens', () => {
  it('accepts a token signed by a published key', async () => {
    await expect(verify(await sign(privateKey, 'ES256'))).resolves.toEqual({
      userId: USER,
      email: 'a@example.com',
    });
  });

  it('rejects a token signed by any other key', async () => {
    const stranger = await generateKeyPair('ES256');
    await expect(verify(await sign(stranger.privateKey, 'ES256'))).rejects.toThrow();
  });

  it('rejects the wrong issuer and audience', async () => {
    const wrongIssuer = await sign(privateKey, 'ES256', { issuer: 'https://evil.example.com' });
    const wrongAudience = await sign(privateKey, 'ES256', { audience: 'anon' });
    await expect(verify(wrongIssuer)).rejects.toThrow();
    await expect(verify(wrongAudience)).rejects.toThrow();
  });

  it('rejects a token with no email claim', async () => {
    await expect(verify(await sign(privateKey, 'ES256', { email: null }))).rejects.toThrow();
  });

  it('refuses the key confusion attack, HS256 signed with the public key', async () => {
    const forged = await sign(new TextEncoder().encode(publicKeyPem), 'HS256');
    await expect(verify(forged)).rejects.toThrow();
  });
});

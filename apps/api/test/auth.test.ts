import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, signToken } from './helpers';
import type { Harness, User } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(() => h.reset());
afterAll(() => h.close());

const as = (token: string): User => ({ id: '', email: '', token });

describe('access tokens', () => {
  it('requires a token', async () => {
    const response = await h.call('GET', '/v1/me');
    expect(response.status).toBe(401);
    expect(response.json.error.code).toBe('unauthorized');
  });

  it('creates a profile on first use of a valid token', async () => {
    const user = await h.createUser();
    const response = await h.call('GET', '/v1/me', user);
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({ id: user.id, email: user.email, onboarded: false });
  });

  it.each([
    ['the wrong secret', { secret: 'x'.repeat(40) }],
    ['the wrong audience', { audience: 'anon' }],
    ['the wrong issuer', { issuer: 'https://evil.example.com/auth/v1' }],
    ['an expired token', { expiresIn: '-1m' }],
  ])('rejects %s', async (_label, options) => {
    const claims = { sub: randomUUID(), email: 'x@example.com' };
    const response = await h.call('GET', '/v1/me', as(await signToken(claims, options)));
    expect(response.status).toBe(401);
  });

  it('rejects an unsigned token', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none' })}.${encode({
      sub: randomUUID(),
      email: 'x@example.com',
      aud: 'authenticated',
    })}.`;
    expect((await h.call('GET', '/v1/me', as(token))).status).toBe(401);
  });

  it('treats a valid token for a deleted account as signed out', async () => {
    const token = await signToken({ sub: randomUUID(), email: 'gone@example.com' });
    const response = await h.call('GET', '/v1/me', as(token));
    expect(response.status).toBe(401);
    expect(response.json.error.code).toBe('unauthorized');
  });

  it('locks out suspended accounts', async () => {
    const admin = await h.createAdmin();
    const user = await h.createMember();
    await h.call('PATCH', `/v1/admin/users/${user.id}`, admin, { status: 'suspended' });

    const response = await h.call('GET', '/v1/me', user);
    expect(response.status).toBe(403);
    expect(response.json.error.code).toBe('account_suspended');
  });
});

describe('onboarding', () => {
  it('refuses anyone under 18', async () => {
    const user = await h.createUser();
    const year = new Date().getUTCFullYear() - 17;
    const response = await h.call('PUT', '/v1/me/profile', user, {
      fullName: 'Too Young',
      dateOfBirth: `${year}-01-01`,
      gender: 'man',
      interestedIn: ['women'],
    });
    expect(response.status).toBe(400);
    expect(response.json.error.code).toBe('validation_failed');
    expect((await h.call('GET', '/v1/me', user)).json.onboarded).toBe(false);
  });

  it('blocks applying to a room until onboarding is finished', async () => {
    const admin = await h.createAdmin();
    const host = await h.createVerifiedHost(admin);
    const room = await h.createOpenRoom(host);
    const user = await h.createUser();
    const response = await h.call('POST', `/v1/rooms/${room.id}/applications`, user, {
      message: 'Please let me in to this room.',
    });
    expect(response.status).toBe(403);
    expect(response.json.error.code).toBe('onboarding_required');
  });
});

describe('admin access', () => {
  it.each([
    ['GET', '/v1/admin/stats'],
    ['GET', '/v1/admin/users'],
    ['GET', '/v1/admin/hosts'],
    ['GET', '/v1/admin/rooms'],
    ['GET', '/v1/admin/plans'],
    ['GET', '/v1/admin/features'],
    ['GET', '/v1/admin/payments'],
  ] as const)('%s %s is closed to members and visitors', async (method, url) => {
    const member = await h.createMember();
    expect((await h.call(method, url)).status).toBe(401);
    expect((await h.call(method, url, member)).status).toBe(403);
    expect((await h.call(method, url, await h.createAdmin())).status).toBe(200);
  });
});

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { inject } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDatabase } from '../src/db/client';
import { profiles } from '../src/db/schema';
import { seedCatalogue } from '../src/db/seed';
import { MockProvider } from '../src/lib/payment-provider';
import type { PaymentProvider } from '../src/lib/payment-provider';
import { createTokenVerifier } from '../src/lib/token-verifier';

export const SUPABASE_URL = 'https://test.supabase.local';
export const JWT_SECRET = 'test-secret-test-secret-test-secret-1234';

export const testConfig = (overrides: Record<string, string> = {}) =>
  loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    SUPABASE_URL,
    SUPABASE_JWT_SECRET: JWT_SECRET,
    PAYMENT_PROVIDER: 'mock',
    CORS_ORIGINS: 'https://app.example.com',
    RATE_LIMIT_MAX: '100000',
    ...overrides,
  });

export const signToken = (
  claims: { sub: string; email: string },
  options: { secret?: string; audience?: string; issuer?: string; expiresIn?: string } = {},
) =>
  new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(options.issuer ?? `${SUPABASE_URL}/auth/v1`)
    .setAudience(options.audience ?? 'authenticated')
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(new TextEncoder().encode(options.secret ?? JWT_SECRET));

export interface User {
  id: string;
  email: string;
  token: string;
}

export const createHarness = async (payments: PaymentProvider = new MockProvider()) => {
  const config = testConfig();
  const { db, close } = createDatabase(config.DATABASE_URL, 12);
  const app = await buildApp({
    config,
    db,
    payments,
    verifyToken: createTokenVerifier(config),
  });
  await app.ready();

  type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  const call = async (method: Method, url: string, user?: User | null, body?: unknown) => {
    const response = await app.inject({
      method,
      url,
      headers: user ? { authorization: `Bearer ${user.token}` } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const text = response.body;
    return {
      status: response.statusCode,
      text,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json: (text ? JSON.parse(text) : null) as any,
    };
  };

  const reset = async () => {
    await db.execute(sql`truncate admin_audit_log, payments, applications, rooms,
      host_verifications, plan_features, plans, features, profiles, auth.users cascade`);
    await seedCatalogue(db);
  };

  const createUser = async (label = 'user'): Promise<User> => {
    const id = randomUUID();
    const email = `${label}-${id.slice(0, 8)}@example.com`;
    await db.execute(sql`insert into auth.users (id, email) values (${id}, ${email})`);
    return { id, email, token: await signToken({ sub: id, email }) };
  };

  const onboard = async (user: User, fullName = 'Real Person Name') => {
    const response = await call('PUT', '/v1/me/profile', user, {
      fullName,
      dateOfBirth: '1995-06-15',
      gender: 'woman',
      interestedIn: ['men'],
    });
    if (response.status !== 204) throw new Error(`onboard failed: ${response.text}`);
    return user;
  };

  const createMember = async (label = 'member') => onboard(await createUser(label));

  const createAdmin = async () => {
    const admin = await createMember('admin');
    await db.update(profiles).set({ role: 'admin' }).where(eq(profiles.id, admin.id));
    return admin;
  };

  const createVerifiedHost = async (admin: User, displayName?: string) => {
    const host = await createMember('host');
    const applied = await call('POST', '/v1/host/application', host, {
      displayName: displayName ?? `Host ${host.id.slice(0, 8)}`,
      about: 'I have run community meetups for many years and love it.',
    });
    if (applied.status !== 204) throw new Error(`host apply failed: ${applied.text}`);
    const approved = await call('PATCH', `/v1/admin/hosts/${host.id}`, admin, {
      status: 'verified',
    });
    if (approved.status !== 204) throw new Error(`host approve failed: ${approved.text}`);
    return host;
  };

  const plan = async (slug: string) => {
    const { json } = await call('GET', '/v1/plans');
    return json.find((entry: { slug: string }) => entry.slug === slug);
  };

  const payMock = (user: User, order: { paymentId: string; orderId: string }) =>
    call('POST', `/v1/payments/${order.paymentId}/confirm`, user, {
      providerPaymentId: `mock_pay_${order.orderId}`,
      signature: 'mock_signature',
    });

  const roomInput = (planId: string, overrides: Record<string, unknown> = {}) => ({
    planId,
    title: 'Late night conversations',
    summary: 'A slow room for people who like to talk',
    description: 'We start with honest questions and see where the conversation goes from there.',
    category: 'dating',
    ticketPricePaise: 30_000,
    ...overrides,
  });

  /** Creates a room and pays for its plan, leaving it open. */
  const createOpenRoom = async (
    host: User,
    slug = 'growth',
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string }> => {
    const { id: planId } = await plan(slug);
    const created = await call('POST', '/v1/host/rooms', host, roomInput(planId, overrides));
    if (created.status !== 201) throw new Error(`create room failed: ${created.text}`);
    const paid = await payMock(host, created.json.checkout);
    if (paid.status !== 200) throw new Error(`plan payment failed: ${paid.text}`);
    return { id: created.json.roomId };
  };

  const apply = async (user: User, roomId: string) => {
    const response = await call('POST', `/v1/rooms/${roomId}/applications`, user, {
      message: 'I would love to join this room please.',
    });
    if (response.status !== 201) throw new Error(`apply failed: ${response.text}`);
    return response.json as { id: string; alias: string; status: string };
  };

  const decide = (host: User, roomId: string, applicationId: string, decision = 'accept') =>
    call('POST', `/v1/host/rooms/${roomId}/applications/${applicationId}/decision`, host, {
      decision,
    });

  const checkout = (user: User, applicationId: string) =>
    call('POST', `/v1/applications/${applicationId}/checkout`, user);

  /** Runs a member all the way from applying to holding a paid seat. */
  const joinRoom = async (host: User, roomId: string, label = 'member') => {
    const member = await createMember(label);
    const application = await apply(member, roomId);
    await decide(host, roomId, application.id);
    const order = await checkout(member, application.id);
    const paid = await payMock(member, order.json);
    if (paid.json.status !== 'paid') throw new Error(`ticket failed: ${paid.text}`);
    return { member, application };
  };

  return {
    app,
    db,
    call,
    reset,
    createUser,
    onboard,
    createMember,
    createAdmin,
    createVerifiedHost,
    plan,
    payMock,
    roomInput,
    createOpenRoom,
    apply,
    decide,
    checkout,
    joinRoom,
    close: async () => {
      await app.close();
      await close();
    },
  };
};

export type Harness = Awaited<ReturnType<typeof createHarness>>;

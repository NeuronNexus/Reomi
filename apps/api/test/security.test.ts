import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest';
import { createHarness } from './helpers';
import type { Harness } from './helpers';

let h: Harness;
let superuser: ReturnType<typeof postgres>;

beforeAll(async () => {
  h = await createHarness();
  superuser = postgres(inject('databaseUrl'), { max: 1, onnotice: () => {} });
});
beforeEach(() => h.reset());
afterAll(async () => {
  await superuser.end();
  await h.close();
});

describe('database exposure through the Supabase anon key', () => {
  it('enables row level security on every table', async () => {
    const rows = await superuser`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows).toEqual([]);
  });

  it('defines no policies, so even a granted role would see nothing', async () => {
    const rows = await superuser`select policyname from pg_policies where schemaname = 'public'`;
    expect(rows).toEqual([]);
  });

  it.each(['anon', 'authenticated'])('denies the %s role every table', async (role) => {
    await h.createMember();
    const tables = await superuser`
      select tablename from pg_tables where schemaname = 'public'`;
    expect(tables.length).toBeGreaterThan(8);

    for (const { tablename } of tables) {
      const attempt = superuser.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx.unsafe(`select * from public."${tablename}" limit 1`);
      });
      await expect(attempt, tablename).rejects.toThrow(/permission denied/);
    }
  });
});

describe('http hardening', () => {
  const preflight = (origin: string) =>
    h.app.inject({
      method: 'OPTIONS',
      url: '/v1/rooms',
      headers: { origin, 'access-control-request-method': 'GET' },
    });

  it('allows configured origins only', async () => {
    const allowed = await preflight('https://app.example.com');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');
    const blocked = await preflight('https://evil.example.com');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sends security headers', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeTruthy();
  });

  it('limits writes per person, not per shared IP', async () => {
    const [one, two] = [await h.createMember(), await h.createMember()];
    const body = { displayName: 'x', about: 'y' };
    const responses = [];
    for (let index = 0; index < 11; index += 1) {
      responses.push(await h.call('POST', '/v1/host/application', one, body));
    }
    expect(responses.at(-1)?.status).toBe(429);
    expect(responses.at(-1)?.json.error.code).toBe('rate_limited');
    expect((await h.call('POST', '/v1/host/application', two, body)).status).toBe(400);
  });

  it('does not leak internals in errors', async () => {
    const response = await h.call('GET', '/v1/rooms/not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.text).not.toMatch(/node_modules|at async|postgres/i);
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const response = await h.call('GET', '/v1/nope');
    expect(response.status).toBe(404);
    expect(response.json.error.code).toBe('not_found');
  });
});

describe('operations', () => {
  it('reports health and database readiness', async () => {
    expect((await h.call('GET', '/health')).json).toEqual({ status: 'ok' });
    expect((await h.call('GET', '/ready')).json).toEqual({ status: 'ready' });
  });

  it('generates OpenAPI docs for every route', async () => {
    const response = await h.call('GET', '/docs/json');
    expect(response.status).toBe(200);
    expect(Object.keys(response.json.paths).length).toBeGreaterThan(20);
  });
});

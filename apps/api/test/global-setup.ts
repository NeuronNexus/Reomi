import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** The slice of Supabase that the migrations rely on. */
const SUPABASE_STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

export default async function setup(project: TestProject) {
  const dir = await mkdtemp(join(tmpdir(), 'agnipath-test-pg-'));
  const port = 54_000 + Math.floor(Math.random() * 900);
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('agnipath_test');

  const url = `postgres://postgres:postgres@127.0.0.1:${port}/agnipath_test`;
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await client.unsafe(SUPABASE_STUB);
  await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), 'drizzle') });
  await client.end();

  project.provide('databaseUrl', url);

  return async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };
}

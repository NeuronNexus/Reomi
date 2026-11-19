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
  const dir = await mkdtemp(join(tmpdir(), 'reomi-test-pg-'));
  const port = 54_000 + Math.floor(Math.random() * 900);
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  const admin = postgres(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, {
    max: 1,
    onnotice: () => {},
  });
  // Windows clusters default to WIN1252, which cannot hold characters like the rupee sign.
  await admin.unsafe(
    "create database reomi_test encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'",
  );
  await admin.end();

  const url = `postgres://postgres:postgres@127.0.0.1:${port}/reomi_test`;
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

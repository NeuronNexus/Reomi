import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';
import { startAuthStub } from './auth-stub';
import { DEMO_PASSWORD, loadDemoData } from './demo-data';

/**
 * `pnpm dev:local`: the whole product on this machine with no accounts. Runs real Postgres, a
 * stub of Supabase Auth and the mock payment provider, then starts the API and both frontends.
 */

const PORTS = { postgres: 54_329, auth: 54_321, api: 8080, web: 5173 };
const JWT_SECRET = 'local-development-secret-not-for-production-use';
const root = resolve(import.meta.dirname, '../..');
const dataDir = resolve(root, '.local/postgres');
const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${PORTS.postgres}/reomi`;
const authUrl = `http://127.0.0.1:${PORTS.auth}`;

const SUPABASE_STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text unique, password text);
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end $$;
`;

const children: ChildProcess[] = [];

const portIsFree = (port: number) =>
  new Promise<boolean>((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });

const busy: number[] = [];
for (const port of Object.values(PORTS)) {
  if (!(await portIsFree(port))) busy.push(port);
}
if (busy.length > 0) {
  console.error(`
  Cannot start: port ${busy.join(', ')} is already in use.
  Another copy of dev:local is probably still running. Stop it and try again.
`);
  process.exit(1);
}

/** Children run through a shell, so on Windows killing one would orphan the real process. */
const killTree = (child: ChildProcess) => {
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
};

const run = (name: string, args: string[], env: Record<string, string>) => {
  const child = spawn(`pnpm ${args.join(' ')}`, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: true,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code) console.error(`[${name}] exited with code ${code}`);
  });
  return child;
};

const runToCompletion = (name: string, args: string[], env: Record<string, string>) =>
  new Promise<void>((done, fail) => {
    run(name, args, env).on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${name} failed with code ${code}`)),
    );
  });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: PORTS.postgres,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: () => {},
});

let stopping = false;
const stop = async (exitCode = 0) => {
  if (stopping) return;
  stopping = true;
  children.forEach(killTree);
  await pg.stop().catch(() => {});
  process.exit(exitCode);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

const firstRun = !existsSync(resolve(dataDir, 'PG_VERSION'));
try {
  if (firstRun) {
    await mkdir(dataDir, { recursive: true });
    await pg.initialise();
  }
  await pg.start();
  {
    // Created explicitly as UTF-8: Windows clusters default to WIN1252, which cannot store "₹".
    // Data folders from before the rename hold an older database name, so this also covers them.
    const admin = postgres(databaseUrl.replace(/\/reomi$/, '/postgres'), {
      max: 1,
      onnotice: () => {},
    });
    const found = await admin`select 1 from pg_database where datname = 'reomi'`;
    if (found.length === 0) {
      await admin.unsafe(
        "create database reomi encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'",
      );
    }
    await admin.end();
  }

  const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} });
  await sql.unsafe(SUPABASE_STUB);

  const dbEnv = { DATABASE_URL: databaseUrl };
  await runToCompletion('migrate', ['--filter', '@reomi/api', 'db:migrate'], dbEnv);
  await runToCompletion('seed', ['--filter', '@reomi/api', 'db:seed'], dbEnv);
  await loadDemoData(sql);

  startAuthStub({ sql, port: PORTS.auth, jwtSecret: JWT_SECRET });

  run('api', ['--filter', '@reomi/api', 'dev'], {
    ...dbEnv,
    NODE_ENV: 'development',
    PORT: String(PORTS.api),
    HOST: '127.0.0.1',
    SUPABASE_URL: authUrl,
    SUPABASE_JWT_SECRET: JWT_SECRET,
    PAYMENT_PROVIDER: 'mock',
    CORS_ORIGINS: `http://localhost:${PORTS.web}`,
    RATE_LIMIT_MAX: '100000',
  });

  const frontendEnv = {
    VITE_API_URL: `http://127.0.0.1:${PORTS.api}`,
    VITE_SUPABASE_URL: authUrl,
    VITE_SUPABASE_KEY: 'local-stub-key',
  };
  run('web', ['--filter', '@reomi/web', 'dev', '--port', String(PORTS.web)], frontendEnv);

  console.log(`
  Reomi is starting.

  App   http://localhost:${PORTS.web}
  CMS   http://localhost:${PORTS.web}/admin
  API   http://127.0.0.1:${PORTS.api}/docs

  Sign in with password "${DEMO_PASSWORD}":
    admin@demo.test   CMS access
    host@demo.test    verified host
    member@demo.test  member
    pending@demo.test host awaiting approval
`);
} catch (error) {
  console.error('Local stack failed to start:', error);
  await stop(1);
}

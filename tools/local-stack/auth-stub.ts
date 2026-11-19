import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SignJWT, jwtVerify } from 'jose';
import type postgres from 'postgres';

/**
 * The handful of Supabase Auth endpoints the frontends call, so the real supabase-js client and
 * the real API token check run locally with no account. It never ships: nothing outside
 * tools/local-stack imports it.
 */

const TOKEN_TTL_SECONDS = 3600;

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
};

const passwordMatches = (password: string, stored: string | null): boolean => {
  const [salt, hash] = (stored ?? '').split(':');
  if (!salt || !hash) return false;
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(hash, 'hex'));
};

export const startAuthStub = (options: {
  sql: ReturnType<typeof postgres>;
  port: number;
  jwtSecret: string;
}) => {
  const { sql, port } = options;
  const secret = new TextEncoder().encode(options.jwtSecret);
  const issuer = `http://127.0.0.1:${port}/auth/v1`;
  const refreshTokens = new Map<string, string>();

  const userDto = (user: { id: string; email: string }) => ({
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  });

  const session = async (user: { id: string; email: string }) => {
    const access_token = await new SignJWT({ email: user.email, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
      .sign(secret);
    const refresh_token = randomUUID();
    refreshTokens.set(refresh_token, user.id);
    return {
      access_token,
      refresh_token,
      token_type: 'bearer',
      expires_in: TOKEN_TTL_SECONDS,
      expires_at: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      user: userDto(user),
    };
  };

  const readJson = async (request: IncomingMessage) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    return (raw ? JSON.parse(raw) : {}) as Record<string, string>;
  };

  const send = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  const fail = (response: ServerResponse, status: number, code: string, msg: string) =>
    send(response, status, { code: status, error_code: code, msg });

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', issuer);
    const path = url.pathname.replace('/auth/v1', '');

    if (request.method === 'POST' && path === '/signup') {
      const { email = '', password = '' } = await readJson(request);
      const normalised = email.trim().toLowerCase();
      if (password.length < 6) {
        return fail(response, 422, 'weak_password', 'Password should be at least 6 characters');
      }
      const existing = await sql`select id from auth.users where email = ${normalised}`;
      if (existing.length > 0) {
        return fail(response, 422, 'user_already_exists', 'User already registered');
      }
      const id = randomUUID();
      await sql`insert into auth.users (id, email, password)
        values (${id}, ${normalised}, ${hashPassword(password)})`;
      return send(response, 200, await session({ id, email: normalised }));
    }

    if (request.method === 'POST' && path === '/token') {
      const body = await readJson(request);
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const userId = refreshTokens.get(body.refresh_token ?? '');
        const rows = userId
          ? await sql<{ id: string; email: string }[]>`
              select id, email from auth.users where id = ${userId}`
          : [];
        if (!rows[0]) return fail(response, 400, 'refresh_token_not_found', 'Invalid token');
        return send(response, 200, await session(rows[0]));
      }
      const rows = await sql<{ id: string; email: string; password: string | null }[]>`
        select id, email, password from auth.users
        where email = ${(body.email ?? '').trim().toLowerCase()}`;
      const user = rows[0];
      if (!user || !passwordMatches(body.password ?? '', user.password)) {
        return fail(response, 400, 'invalid_credentials', 'Invalid login credentials');
      }
      return send(response, 200, await session(user));
    }

    if (path === '/user') {
      const token = request.headers.authorization?.replace('Bearer ', '') ?? '';
      const { payload } = await jwtVerify(token, secret).catch(() => ({ payload: null }));
      if (!payload) return fail(response, 401, 'bad_jwt', 'Invalid token');
      const user = { id: payload.sub as string, email: payload.email as string };
      if (request.method === 'PUT') {
        const { password } = await readJson(request);
        if (password) {
          await sql`update auth.users set password = ${hashPassword(password)}
            where id = ${user.id}`;
        }
      }
      return send(response, 200, userDto(user));
    }

    if (request.method === 'POST' && (path === '/logout' || path === '/recover')) {
      response.writeHead(204);
      return response.end();
    }

    return fail(response, 404, 'not_found', `Not implemented in the local stub: ${path}`);
  };

  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
    response.setHeader('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    handle(request, response).catch((error: unknown) => {
      console.error('[auth-stub]', error);
      fail(response, 500, 'unexpected_failure', 'Auth stub error');
    });
  });

  server.listen(port, '127.0.0.1');
  return server;
};

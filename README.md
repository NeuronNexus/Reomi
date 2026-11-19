# Reomi

Anonymous, host-led rooms for meeting people. Members explore open rooms, apply under a per-room
alias, and pay a one-time ticket if the host accepts them. Verified hosts pay for a plan that sets
their room's capacity, duration and features. A CMS at `/admin` manages users, hosts, rooms, plans and
payments.

| Path                | What it is                               | Deploys to                 |
| ------------------- | ---------------------------------------- | -------------------------- |
| `apps/api`          | Fastify API, Drizzle ORM                 | Railway                    |
| `apps/web`          | The product (React, Vite)                | Cloudflare Pages or Vercel |
| `packages/shared`   | Zod contracts shared by all three        | Bundled into each          |
| `tools/local-stack` | Runs everything locally with no accounts | Never deployed             |

## Run it locally

For every setup step, including using a real Supabase project, see [SETUP.md](SETUP.md).

Needs Node 22+ and pnpm. No Docker or accounts: this starts real Postgres, a stub of Supabase Auth
and a payment simulator.

```sh
pnpm install
pnpm dev:local
```

| URL                         |               |
| --------------------------- | ------------- |
| http://localhost:5173       | App           |
| http://localhost:5173/admin | CMS           |
| http://127.0.0.1:8080/docs  | API reference |

All demo accounts use the password `password123`:

| Email               | Role                 |
| ------------------- | -------------------- |
| `admin@demo.test`   | CMS administrator    |
| `host@demo.test`    | Verified host        |
| `pending@demo.test` | Host awaiting review |
| `member@demo.test`  | Member               |

Local data lives in `.local/`. Delete that folder to start again.

## Checks

```sh
pnpm test        # API suite against real Postgres, including concurrency tests
pnpm typecheck
pnpm lint
pnpm build
```

## How it works

**Anonymity.** Hosts and members only ever see a per-room alias. Every API response passes through
a Zod schema that strips undeclared fields, so a query that selects too much cannot leak a name or
email. The CMS is the one place real identities appear.

**Database access.** Only the API talks to Postgres. The Supabase anon key ships in the browser, so
every table has RLS enabled with no policies and all grants revoked from `anon` and `authenticated`.
Any migration adding a table must do the same; `test/security.test.ts` fails if it does not.

**Seats.** A seat is held by a member, or by an accepted applicant inside their payment window (48
hours by default). Lapsed holds free themselves in the query, so no background job is needed. Row
locks on the room prevent overselling.

**Payments.** Both the browser callback and the Razorpay webhook call `settlePayment`, which applies
money exactly once. Money that arrives when it can no longer buy anything is recorded as
`refund_required` and shown in the CMS.

**Plans.** A room copies its plan's capacity, duration, commission and features when created, so
editing a plan affects new rooms only. Moving a room to another plan in the CMS applies immediately.
Only the keys in `FEATURE` (`packages/shared/src/constants.ts`) change behaviour. Other catalogue
features are labels until they are built, and should stay marked "coming soon".

## Deploy

### 1. Supabase

1. Create a project in the Mumbai region (`ap-south-1`).
2. Under **Authentication > URL Configuration**, set the Site URL to the app's URL and add
   `https://YOUR_APP/**` to the redirect URLs.
3. Copy the **session pooler** connection string, the project URL and the publishable key.

### 2. Razorpay

1. Create the account and copy the API keys. Start in test mode.
2. Confirm payments are set to capture automatically.
3. Add a webhook to `https://YOUR_API/webhooks/razorpay` with a secret, subscribed to
   `payment.captured` and `order.paid`.

### 3. API on Railway

1. Create a service from this repository. Railway builds the root `Dockerfile` automatically.
2. Set the variables from `apps/api/.env.example`, with `NODE_ENV=production`.
3. In the service settings, set:
   - **Pre-deploy command:** `node dist/release.js` (runs migrations, seeds an empty catalogue)
   - **Healthcheck path:** `/ready`

Do not add a `railway.toml`. Railway has deprecated config files: new services cannot use them.

### 4. Frontends

Deploy `apps/web`, which includes the CMS at `/admin`, with the variables from its `.env.example`. Variables are read at build time, so redeploy after changing them.

| Host             | Root directory  | Build command                    | Output          |
| ---------------- | --------------- | -------------------------------- | --------------- |
| Cloudflare Pages | repository root | `pnpm --filter @reomi/web build` | `apps/web/dist` |
| Vercel           | `apps/web`      | detected                         | detected        |

Then add the final URL to `CORS_ORIGINS` on the API.

### 5. First administrator

Sign in to the app once with your own account, then run this with the production `DATABASE_URL`:

```sh
DATABASE_URL="..." pnpm admin:grant you@example.com
```

## Changing the schema

Edit `apps/api/src/db/schema.ts`, run `pnpm db:generate`, and commit the new file in
`apps/api/drizzle`. Deploys apply it through the pre-deploy command.

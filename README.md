# Reomi

Dating starts with the vibe, not the looks. Socialising starts with shared interests, not public
judgment.

Reomi has two halves:

- **Rooms (phase 1).** Anonymous, host-led rooms for meeting people. Members join under a per-room
  alias, chat as a group or in private whispers, play host-run activities, and reveal their real
  profiles only when both people agree. Admissions are balanced by who people want to meet, and
  identity leaks are blocked before anyone sees them. Hosts buy a plan, set a one-time ticket under a
  fair-price cap, and build a public record from ratings and confirmed connections.
- **Communities (phase 2).** Private interest circles with posts, photos, videos, reels and 24-hour
  stories, shared with members only and under a display name chosen per community.

| Path                | What it is                                   | Deploys to |
| ------------------- | -------------------------------------------- | ---------- |
| `apps/api`          | Fastify API, Drizzle ORM, WebSockets         | Render     |
| `apps/web`          | The product and the CMS at `/admin` (React)  | Vercel     |
| `packages/shared`   | Zod contracts shared by API and apps         | Bundled    |
| `tools/local-stack` | Runs everything locally with no accounts     | Never      |
| `tools/seed-demo`   | Fills a deployment with demo people and data | Never      |

## Live

| What   | URL                                  |
| ------ | ------------------------------------ |
| App    | https://reomi-pearl.vercel.app       |
| CMS    | https://reomi-pearl.vercel.app/admin |
| API    | https://reomi-api.onrender.com       |
| Health | https://reomi-api.onrender.com/ready |

The API runs on Render's free plan, which sleeps after 15 idle minutes. The first request after that
takes about a minute.

## Run it locally

Needs Node 22+ and pnpm. No Docker or accounts: this starts real Postgres, a stub of Supabase Auth,
a payment simulator and local file storage.

```sh
pnpm install
pnpm dev:local
```

| URL                         |               |
| --------------------------- | ------------- |
| http://localhost:5173       | App           |
| http://localhost:5173/admin | CMS           |
| http://127.0.0.1:8080/docs  | API reference |

All demo accounts use the password `password123`: `admin@demo.test` (CMS), `host@demo.test` and
`host2@demo.test` (verified hosts), `pending@demo.test` (host awaiting review), `member@demo.test`.
Sign up as many extra people as you like; the local auth stub needs no email.

Local data lives in `.local/`. Delete that folder to start again.

## Checks

```sh
pnpm test        # API suite against real Postgres: rooms, payments, balance, moderation, reveals, communities
pnpm typecheck
pnpm lint
pnpm build
```

## How it works

**Anonymity.** Members only ever see per-room aliases. Every API response passes through a Zod
schema that strips undeclared fields, so a query that selects too much cannot leak a name, email or
account id. Hosts are public under a host name and a separate public id; their account id never
appears on public pages. Real profiles are returned only inside an accepted reveal, and only the
other person's.

**Interest balancing** (`apps/api/src/lib/balance.ts`). For each group (women, men, non-binary and
gender-diverse people) the room tracks supply (people in that group) and demand (people seeking it,
split evenly across everyone they want to meet). A newcomer is paused only when a group they seek
would exceed two seekers per person, with a slack of two so rooms can start. People who add supply to
a scarce group are always welcome. Dating rooms always balance; hosts cannot accept around it, and
the room page suggests other rooms where the person fits now. Instant rooms offer seats
automatically, in arrival order, whenever the balance allows.

**Identity protection** (`apps/api/src/lib/moderation.ts`). Every room message, whisper and
activity answer is scanned before it is stored or sent. Naming another participant (names, surnames,
emails, spaced or leetspeak spellings, with alias words ignored) is blocked and counts as a strike.
Self-disclosure and contact details (phones, emails, handles, links) are blocked without a strike,
except in whispers between two people who already revealed. Strikes climb a ladder applied equally to
members and hosts: warning, 24-hour mute, removal from the room (a week's mute for hosts), then
suspension. Community posts and comments get a harassment filter aimed at appearance insults and
slut-shaming. Everything blocked lands in the CMS moderation queue; dismissing a flag removes the
strike.

**Realtime.** One WebSocket per client at `/v1/realtime`. The first frame carries the access token,
which keeps it out of URLs and logs; each channel subscription (`room:`, `thread:`, `user:`) is
checked with the same membership rules as REST. Clients refetch after reconnecting, so a dropped
connection never loses messages. Fan-out is in memory (one instance on Render); moving to several
instances means swapping `RealtimeHub` for Postgres LISTEN/NOTIFY.

**Reveals and connections.** Either person can ask; nothing is shared unless the other accepts. If
both opt in, the room sees an announcement. After a reveal they can follow each other and message
directly. A connection counts toward the host's record only once both people confirm it.

**Reputation.** Ratings open when a room ends (or the host ends it early), come only from paying
members, one per room, and are shown with their count. The leaderboard score weighs a Bayesian
rating, confirmed connections relative to room size, completed rooms, rating consistency,
rule-keeping and engagement. Plan price plays no part. Badges: verified, top host, rising host, and
celebrity host (5+ completed rooms, 20+ ratings, 4.5+ average, 10+ confirmed connections).

**Fair pricing.** Each plan publishes a reference ticket price; a group room may charge at most 10%
above it (editable per plan in the CMS). There are no other mandatory charges, and the platform fee
is shown inside the ticket. See `/pricing`.

**Media.** Browsers upload straight to storage with short-lived signed URLs, so large videos never
pass through the API. Production uses a private Supabase Storage bucket and every read is a signed
URL, because community content is for members only. Locally files go to `.local/media`.

**Seats and payments.** A seat is held by a member, or by an accepted applicant inside their payment
window (48 hours by default). Lapsed holds free themselves in the query. Row locks on the room
prevent overselling. Both the browser callback and the Razorpay webhook call `settlePayment`, which
applies money exactly once.

**Time-based notices.** A sweeper runs every minute: followers hear about a host's new room, the
waitlist hears when a scheduled room opens, and members are asked to rate when a room ends.

## Deploy

Production today runs on Render (API and Postgres), Vercel (web) and Supabase (auth and storage).

### API on Render

The service builds the root `Dockerfile`. The container runs migrations and seeds an empty plan
catalogue on start (`node dist/release.js && node dist/server.js`), because Render's free plan has
no pre-deploy step. Pushing to `main` redeploys.

| Variable              | Value                                                               |
| --------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`            | `production`                                                        |
| `DATABASE_URL`        | Postgres connection string                                          |
| `SUPABASE_URL`        | `https://<ref>.supabase.co` (tokens are checked against its JWKS)   |
| `SUPABASE_SECRET_KEY` | Server-only key for Storage. Never ship it to a browser             |
| `STORAGE_BUCKET`      | `reomi-media` (created automatically, private)                      |
| `CORS_ORIGINS`        | The web app's origins, comma separated                              |
| `PAYMENT_PROVIDER`    | `mock` with `ALLOW_DEMO_PAYMENTS=true`, or `razorpay` with its keys |

### Web on Vercel

The project deploys from the repository root with the root `vercel.json`. Set `VITE_API_URL`,
`VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (the publishable key) and redeploy after changing them.

### Supabase

Auth: set the Site URL to the web app and allow `https://<app>/**` as a redirect URL. Built-in email
is limited to a couple of messages an hour; add custom SMTP before inviting people.

### First administrator

Sign in once with your own account, then run with the production `DATABASE_URL`:

```sh
DATABASE_URL="..." pnpm admin:grant you@example.com
```

### Demo data

`pnpm demo:seed` fills a deployment with demo hosts, members, rooms, conversations, a reveal, ratings
and communities through the real API. It needs `API_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` and `DEMO_PASSWORD`. `pnpm demo:reset` wipes all
user-created data (plans are kept) and deletes the demo logins; run it before real people arrive.

## Changing the schema

Edit `apps/api/src/db/schema.ts`, run `pnpm db:generate`, and commit the new file in
`apps/api/drizzle`. Any migration that adds a table must enable row-level security on it;
`test/security.test.ts` fails otherwise.

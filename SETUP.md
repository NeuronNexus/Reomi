# Setup checklist

Everything needed before running Agnipath. Pick the path you need:

|               | Option A: demo mode         | Option B: real Supabase                           |
| ------------- | --------------------------- | ------------------------------------------------- |
| Use it for    | Looking around, development | Testing real sign-up, email and your own data     |
| Accounts      | None                        | Supabase, plus Razorpay if you want real checkout |
| Data          | Demo rooms and accounts     | Starts empty, you create everything               |
| Payments      | Fake payment screen         | Fake screen, or Razorpay test mode                |
| Start command | `pnpm dev:local`            | `pnpm dev`                                        |

> **Status:** Option A is fully tested. Option B has not been run against a real Supabase project
> or real Razorpay keys yet, so expect to find small issues the first time.

## Needed for both options

- [ ] **Node.js 22 or newer.** Check with `node -v`.
- [ ] **pnpm.** Check with `pnpm -v`. If it is missing, run `corepack enable`.
- [ ] **Install the project.** From `D:\agnipath`, run `pnpm install`.
- [ ] **Free memory.** Keep at least 2 GB free. Close extra Chrome tabs and VS Code windows.

## Option A: demo mode

No accounts or `.env` files are needed.

```powershell
pnpm dev:local
```

Open http://localhost:5173 (website) and http://localhost:5173/admin (CMS). Sign in with
`admin@demo.test`, `host@demo.test`, `member@demo.test` or `pending@demo.test`, all with the
password `password123`. Press Ctrl+C to stop.

## Option B: local app with real Supabase

### 1. Create the Supabase project

- [ ] Sign up at https://supabase.com and create a new project.
- [ ] Choose the **Mumbai** region (`ap-south-1`).
- [ ] Save the **database password** in a password manager. You need it in step 3.

### 2. Configure sign-in

- [ ] Go to **Authentication > URL Configuration**.
  - Set **Site URL** to `http://localhost:5173`.
  - Add `http://localhost:5173/**` to **Redirect URLs**.
- [ ] Decide how to handle email confirmation, under **Authentication > Providers > Email**
      (this may be labelled Sign In / Providers).
  - **Easiest for local testing:** turn **Confirm email** off, so accounts work immediately.
  - **Keep it on:** new users must click a link in their email first.
  - Turn it back on before going live.
- [ ] Before real users sign up, set up custom SMTP. Supabase's built-in email is heavily rate
      limited and only meant for testing.

### 3. Collect three values

| Value             | Where to find it                                                            |
| ----------------- | --------------------------------------------------------------------------- |
| Connection string | Click **Connect** at the top of the dashboard and choose **Session pooler** |
| Project URL       | `https://YOUR_PROJECT_REF.supabase.co`, also under **Project Settings**     |
| Publishable key   | **Project Settings > API Keys** (older projects call it the anon key)       |

- Use the **Session pooler** string, not Direct. Direct connections are IPv6 only by default.
- Use the Copy button, and replace `[YOUR-PASSWORD]` with your database password.
- If the password has symbols such as `@`, `#` or `/`, URL-encode them or reset it to letters and
  numbers.
- **Never** use the secret or `service_role` key. This app does not need it.

### 4. Create the two `.env` files

```powershell
Copy-Item apps\api\.env.example apps\api\.env
Copy-Item apps\web\.env.example apps\web\.env
```

In `apps/api/.env`, set:

```ini
NODE_ENV=development
DATABASE_URL=<session pooler connection string>
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
CORS_ORIGINS=http://localhost:5173
PAYMENT_PROVIDER=mock
```

`PAYMENT_PROVIDER=mock` keeps the fake payment screen. It is refused in production. To use real
test payments, follow step 8.

In `apps/web/.env`, set:

```ini
VITE_API_URL=http://localhost:8080
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_KEY=<publishable key>
```

Never commit these files. They are already ignored by git.

### 5. Create the tables

Run this once, and again whenever the database schema changes:

```powershell
pnpm db:migrate
pnpm db:seed
```

This creates the tables, locks them against direct browser access, and adds the three plans and
their features. Re-running the seed will not overwrite your CMS edits.

### 6. Start the app

First stop `pnpm dev:local` if it is running, because both use the same ports. Then run:

```powershell
pnpm dev
```

Open http://localhost:5173. The site starts with no rooms and no demo accounts.

### 7. Create your admin account

- [ ] Sign up on the website with your own email and finish the profile step.
- [ ] Open a second terminal in `D:\agnipath` and run:
  ```powershell
  pnpm admin:grant you@example.com
  ```
- [ ] Refresh the site. A **CMS** link appears in the menu, or open
      http://localhost:5173/admin.

To see a room, sign up a second account, apply to host, approve it in the CMS under **Hosts**, then
create a room.

### 8. Optional: real Razorpay test payments

- [ ] Create an account at https://razorpay.com and switch the dashboard to **Test Mode**.
- [ ] Under **Account & Settings > API Keys**, generate a key. The secret is shown only once.
- [ ] Under **Account & Settings > Payments Capture**, confirm capture is automatic.
- [ ] In `apps/api/.env`, set:
  ```ini
  PAYMENT_PROVIDER=razorpay
  RAZORPAY_KEY_ID=rzp_test_...
  RAZORPAY_KEY_SECRET=<key secret>
  RAZORPAY_WEBHOOK_SECRET=<any long random text you choose>
  ```
- [ ] Restart `pnpm dev`.

All three values are required, or the API will not start. Webhooks cannot reach `localhost` without
a tunnel such as ngrok. Payments still complete through the browser, but a payment is not recorded
if the customer closes the tab first. Test that case after deploying.

## Common problems

| Problem                                      | Likely cause and fix                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid environment configuration` on start | A value in `apps/api/.env` is missing. The message names it.                                                                                 |
| `VITE_... is not set`, or a blank page       | `apps/web/.env` is missing a value. Fix it, then restart.                                                                                    |
| `password authentication failed`             | Wrong password in `DATABASE_URL`, or symbols that need URL-encoding.                                                                         |
| Migration or connection times out            | You used the Direct string. Use **Session pooler**.                                                                                          |
| Signed in, but the app acts signed out       | Older projects sign tokens with a shared secret. Copy it from **Project Settings > JWT Keys** into `SUPABASE_JWT_SECRET` in `apps/api/.env`. |
| `No profile for ...` from `admin:grant`      | Sign in on the website once first, then run it again.                                                                                        |
| Confirmation link goes to the wrong page     | Check the Site URL and Redirect URLs in step 2.                                                                                              |
| `Cannot start: port ... is already in use`   | Another copy is running. Stop it, or restart your computer.                                                                                  |
| 500 errors after a crash or low memory       | The local database has hung. Stop everything and start again. Your data is kept.                                                             |

## Before going live

Deployment steps are in [README.md](README.md#deploy). These need settling first:

- [ ] **Razorpay approval:** get written confirmation that it accepts a dating platform.
- [ ] **Paying hosts:** decide how hosts get paid. This is not built yet, and Razorpay Route has
      turnover and eligibility rules.
- [ ] **Commission:** replace the placeholder 10% in the CMS under **Plans & features**.
- [ ] **Legal:** get advice on collecting money for hosts, and on privacy terms for a dating app.
- [ ] **Email:** set up custom SMTP and turn **Confirm email** back on.
- [ ] **URLs:** replace the `localhost` values with your real domain in Supabase and `CORS_ORIGINS`.
- [ ] **Live keys:** use Razorpay live keys, with a new webhook and its own secret.
- [ ] **Room chat and moderation:** build these before charging real users.

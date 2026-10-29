# Deployment & Operations

## 1. Production checklist

1. **PostgreSQL 15+** (Neon, Supabase, RDS, Cloud SQL…). Set `DATABASE_URL`. Use the pooled connection string for serverless hosts.
2. **Secrets** in your host's secret manager, never in git:
   - `APP_SECRET`: 32+ random characters (required; the app refuses to run without it in production).
   - `APP_URL`: the public HTTPS origin, used to build card URLs (e.g. `https://campus.example.com`).
3. **Run migrations** before starting the new version: `npm run db:migrate` (uses `DATABASE_URL`).
4. **Build & start**: `npm run build && npm start`, or deploy to Vercel or any Node 22 host. HTTPS is required (cards are HTTPS URLs; cookies are `Secure` in production).
5. **Object storage**: the default `LocalDiskStorage` writes to `STORAGE_DIR` (or `./.data/uploads`). On serverless or multi-instance hosts, replace it with a private S3 / R2 / Vercel Blob (private) adapter implementing `StorageAdapter` in `src/lib/storage.ts`. Files must stay private, since `/api/files/[id]` performs authorization.
6. **Rate limiting** is shared across instances: counters live in the `rate_limits` table (`src/lib/rate-limit.ts`, one atomic upsert per check, keys hashed). For volumetric attacks, add WAF rules for `/login` and `/card/*` on top.
7. Create a platform super admin (prints a one-time password; must be changed at first sign-in):
   ```bash
   npm run admin:create -- ops@yourcompany.com "Platform Operator"
   ```
   Then sign in at `/platform` and onboard colleges from the UI.

## Handover workflow

1. **Super admin** → `/platform` → *Onboard college*: name, slug, plan, modules, and the college admin's login email plus an optional initial password (blank generates one).
2. The credentials and a login link are shown once on the college page. Send them to the college. The college admin must set their own password at first sign-in.
3. **The college admin does the rest**: departments and programmes, faculty and staff accounts, students (or CSV/XLSX import), NFC cards, portal design, fees, library and transport.
4. If a college admin forgets their password, use **Reset password** on the college page. It issues new one-time credentials and signs them out everywhere. *Add college admin* creates additional administrators.

## Vercel (live)

- Project `mysmartcard-campus` in team `nyay-saathis-projects`, production URL <https://mysmartcard-campus.vercel.app>. Functions run in `sin1` (Singapore, next to Neon) via `vercel.json`.
- Deploy: `vercel deploy --prod`. `.vercelignore` keeps `.env*`, `.data`, `.neon` and tests out of the upload.
- Production env vars: `APP_SECRET`, `APP_URL`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `STORAGE_ENDPOINT_URL`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_REGION`, `STORAGE_BUCKET`, `CRON_SECRET`. Vercel reserves `AWS_*` names, so storage uses `STORAGE_*` there.
- Uploads are capped at 4 MB (Vercel request bodies max out at 4.5 MB).
- A daily cron (`vercel.json`, 21:30 UTC = 03:00 IST) calls `/api/cron/retention` with `Authorization: Bearer $CRON_SECRET`. Without `CRON_SECRET` the endpoint returns 401.
- Custom domain: add it in Vercel → Domains, then update `APP_URL` and redeploy **before** colleges assign cards. Card links embed `APP_URL`.
- Health: the platform dashboard's "Database / files" tile does a live DB query and a storage write/read/delete probe.

## Neon

- `.neon` links this folder to the project. `neon env pull` refreshes `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and the storage `AWS_*` variables into `.env.local`.
- `neon.ts` declares the `uploads` bucket. Run `neon deploy` after changing it.
- For risky changes or testing, create a branch (`neon checkout test-x --create`). It is a full copy of the data and files. Delete it afterwards. Production stays on `main`.
- Hosting: set `APP_SECRET`, `APP_URL`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, the storage variables (`STORAGE_*`, or `AWS_*` where the host allows those names) and `CRON_SECRET` in your host's environment, using the values from `.env.local`.

## 2. Environment variables

See [.env.example](.env.example). Summary:

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_SECRET` | yes (prod) | Encrypts stored card tokens. Changing it makes stored tokens undecryptable for re-printing (existing tag URLs keep working because lookup uses a hash). Rotate card URLs after changing it. |
| `APP_URL` | yes | Public HTTPS origin for card URLs |
| `DATABASE_URL` | yes (prod) | Postgres connection string |
| `DB_POOL_MAX` | no | Default 10 |
| `ROOT_DOMAIN` | no | Enables `slug.ROOT_DOMAIN` tenant subdomains (needs wildcard DNS + TLS) |
| `COOKIE_DOMAIN` | no | e.g. `.campus.example.com` to share sessions across tenant subdomains |
| `STORAGE_DIR` | no | Local upload directory |
| `CRON_SECRET` | yes (Vercel) | Authorizes the daily retention cron |
| `EMAIL_PROVIDER` | no | When unset, notice emails are recorded as `skipped_unconfigured` |
| `ALLOW_EMBEDDED_DB` / `ALLOW_DEMO_SEED` | no | Demo hosts only |

## 3. Migrations

- The schema lives in `src/db/schema.ts`. After changing it, run `npm run db:generate -- --name <change>` and commit the SQL file in `./drizzle`.
- Apply with `npm run db:migrate`. Migrations are forward-only. Test them on a database branch or copy first (Neon branches work well).
- Never run `db:reset` against a real database. It refuses when `DATABASE_URL` is set.

## 4. Backups & data retention

- Enable your provider's automated backups with point-in-time recovery (Neon: history retention; RDS: automated snapshots + PITR). Recommended: daily snapshot, 30-day retention, quarterly restore drill.
- Back up the object-storage bucket with versioning enabled. File rows reference storage keys, so restore both to the same point in time.
- Logical export for offboarding a single college: every tenant table has `institution_id`, so `COPY (select * from <table> where institution_id = '<id>')` per table gives a complete tenant export.
- **Automatic retention** (`src/server/services/maintenance.ts`, daily cron): deletes expired sessions, ended rate-limit windows, and sent/skipped/failed notification records older than 90 days. Queued notifications, academic records, audit logs and support grants are never deleted automatically.
- Students are archived rather than deleted, and audit logs are append-only. Handle hard-deletion requests (e.g. data-protection erasure) as a scripted, audited operation by platform staff. No such script is included yet.

## 5. Monitoring

- `GET /api/health` returns `{ ok, db }` (503 if the database is unreachable). Point an uptime monitor at it.
- Server errors are logged to stdout (`[action] unexpected error …`). Connect your host's log drain or an error tracker (e.g. Sentry) for alerting. None is configured.

## 6. NFC cards in practice

- Recommended tags: NTAG213/215/216. Encode one **NDEF URI record** containing the card URL shown on the card's admin page, then **lock** the tag (read-only) so it cannot be rewritten.
- Android reads NDEF URLs natively. iPhone XS and later read them in the background. Print the QR fallback for older devices.
- After "Issue new URL", re-encode the tag (or issue a new card). The old URL stops working immediately.

## 7. Integration status

| Integration | Status |
| --- | --- |
| PostgreSQL | **Live on Neon**: project `mysmartcard-campus` (`muddy-bird-69853714`), region `aws-ap-southeast-1` (Singapore), branch `main`. Embedded PGlite is used only for local tests. |
| Object storage | **Live on Neon Object Storage**: private bucket `uploads` declared in `neon.ts`. Used automatically whenever `STORAGE_ENDPOINT_URL` (or `AWS_ENDPOINT_URL_S3`) is set; otherwise falls back to local disk. |
| Authentication | **Implemented** (built-in email/password, DB sessions). The super admin issues and resets college-admin credentials; college admins issue staff and student credentials. No SSO or self-service reset email. |
| Online payments | **Intentionally not included.** Fees are recorded by the accounts office (cash/UPI/bank/cheque/POS) with receipts and reconciliation. |
| Email notifications | **Not configured.** Notices record intended emails in `notification_outbox` with `skipped_unconfigured`. |
| Push notifications | **Not implemented.** |
| Library system API | **Not implemented.** Librarian-managed records only. |
| Live bus GPS | **Not implemented.** The portal says so explicitly. |
| Distributed rate limiting | **Implemented** in Postgres (`rate_limits` table), shared by all Vercel instances. Covered by integration tests. |
| Postgres row-level security | **Not implemented.** Isolation is enforced in the application layer (single DB role) and covered by integration tests. RLS policies keyed on a per-transaction `app.institution_id` setting would add defense in depth. |

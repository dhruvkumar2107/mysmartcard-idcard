# MySmartCard Campus

Multi-college management platform with NFC student ID portals. Each college gets an isolated workspace (students, faculty, academics, fees, library, transport, branding, permissions). Each student gets an NFC card whose tap opens a verified public ID, and a signed-in portal with ten configurable modules.

> This is a **separate product** from <https://www.mysmartcard.net/>. It shares no code, database, domain or payment configuration with it.

## Quick start (local)

Requires Node.js 22+.

```bash
npm install
cp .env.example .env.local        # then set APP_SECRET (see below)
npm run setup                     # apply database migrations
# Demo data (embedded local DB only — remove DATABASE_URL lines from .env.local first): npm run db:seed
npm run dev                       # http://localhost:3000
```

Generate `APP_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**This folder is linked to the Neon project `mysmartcard-campus`.** `.env.local` already holds its `DATABASE_URL` and Object Storage credentials, so `npm run dev` runs against the live Neon database. Do **not** run `npm run setup`/`db:seed` against it (demo data); use `npm run db:migrate` for schema changes and `npm run admin:create` for platform accounts. See [DEPLOYMENT.md](DEPLOYMENT.md#handover-workflow).

Without `DATABASE_URL`, the app uses **embedded PGlite** (real PostgreSQL compiled to WASM), stored in `./.data`. No database server is needed for development. `npm run db:reset` wipes the local data.

### Demo accounts (fictional data, password `Demo@12345`)

| Role | Email |
| --- | --- |
| Platform super admin | `platform@mysmartcard.test` |
| College admin (Northbridge) | `admin@northbridge.test` |
| Principal / Accountant / Librarian / Transport | `principal@`, `accountant@`, `librarian@`, `transportadmin@northbridge.test` |
| Head of Department (CSE) | `faculty1@northbridge.test` |
| Faculty | `faculty2@northbridge.test` |
| Student (portal) | `student1@northbridge.test` |
| Second college admin (Riverside) | `admin@riverside.test` |

The seed prints a sample NFC URL (`/card/<token>`). Open it on a phone, or encode it onto an NTAG21x tag with any NFC writer app.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js + React Compiler rules) |
| `npm test` | Vitest: unit and integration tests (integration runs against in-memory Postgres) |
| `npm run db:generate` | Generate a SQL migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations in `./drizzle` |
| `npm run db:seed` | Seed demo data (refuses in production unless `ALLOW_DEMO_SEED=1`) |

## Architecture

```
src/
  db/schema.ts          Normalized Postgres schema (Drizzle). Every tenant table has institution_id.
  db/index.ts           pg (DATABASE_URL) or embedded PGlite
  lib/                  Pure logic: permissions, portal config, attendance/grading, timetable conflicts,
                        import validation, crypto, storage, rate limiting
  server/context.ts     THE tenant boundary: session user + slug -> membership, role, permissions, scope
  server/services/*     Business logic. Every function takes a TenantContext and scopes queries by it.
  server/actions/*      "use server" wrappers: parse FormData, call a service, redirect with a flash message
  app/c/[slug]/admin    College admin panel (role-filtered navigation)
  app/c/[slug]/portal   Student portal (mobile-first)
  app/card/[token]      Public NFC tap page
  app/platform          Platform super-admin console
  proxy.ts              Optional subdomain routing (slug.ROOT_DOMAIN -> /c/slug)
tests/unit              Pure-logic tests
tests/integration       Service tests on PGlite: isolation, roles, workflows, NFC lifecycle
```

### Security model (summary)

- **Tenant isolation is server-side.** `loadTenantContext()` resolves the institution from the URL slug and then requires an active membership for the signed-in user. Every service query filters by `ctx.institution.id`, and every ID that comes from a client passes through `owned()`, which checks that the row belongs to that institution. A forged slug, ID or form field yields "not a member" or "not found". Integration tests attack this directly.
- **Least privilege.** Eight roles with a permission matrix (`src/lib/permissions.ts`). Faculty see only students in sections they teach. HODs see only their department. Sensitive fields (DOB, address, guardian details) are redacted without `students.view_sensitive`. Colleges can tune non-admin role permissions, but students can never gain staff permissions and admins can never be reduced.
- **NFC cards carry only an HTTPS URL** with a 256-bit random token. The database stores `sha256(token)` for lookup plus an AES-256-GCM ciphertext so admins can reprint the QR code or re-encode the tag. A tap reveals only the fields the college marks public. Private records always require sign-in. Rotate, deactivate, lost/damaged, replace and revoke all invalidate old URLs immediately. Tap endpoints are rate-limited.
- **Portal modules are enforced server-side.** A disabled or unlicensed module 404s even when its URL is typed directly. Admins preview the draft config through the same gate.
- **Sessions:** random 256-bit token in an httpOnly, SameSite=Lax cookie; only its hash is stored. Login is rate-limited per IP and per account. One-time passwords are forced to change at first sign-in.
- **Files** live in private storage and are served only through `/api/files/[id]`, which authorizes per owner type. Uploads are validated by size, declared type **and magic bytes**.
- **Audit log** for student changes, imports and exports, marks workflow, attendance corrections, card operations, role and permission changes, portal publishes, support grants and platform actions.
- **Platform staff cannot read college data** unless that college grants time-limited, read-only support access.

See [DEPLOYMENT.md](DEPLOYMENT.md) for production setup, backups, and the status of integrations.

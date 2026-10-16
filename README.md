# Track Atlas

_Explore your tracks. Discover new paths._

Track Atlas is an in-development website for storing GPX tracks, viewing them on
an interactive map, and searching a personal or public track collection.

**Implemented:** English/Spanish homepage, light/dark/system themes, signup with
automatic sign-in, top-bar modal login/logout, persistent database-backed
sessions, profile/password/account-deactivation settings, and self-hosted ALTCHA
for signup and login.
**Planned:** GPX upload/storage, interactive maps, track collections, and spatial
search. The homepage currently shows an illustration, not an interactive map.

Built with Next.js 16.4, React 19.3, TypeScript, Tailwind CSS 4, and
PostgreSQL/PostGIS through Drizzle ORM. Dependencies are managed with pnpm.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): current technical design, module boundaries,
  data model, authentication, security constraints, and test strategy.
- [docs/DESIGN.md](docs/DESIGN.md): intended product and future features.
- [AGENTS.md](AGENTS.md): repository conventions for contributors and coding agents.
- [Historical designs and plans](docs/superpowers/): implementation context;
  use the architecture document for the current system.

## Getting Started

Install Node.js compatible with Next.js 16.4, pnpm (version pinned in
`package.json`), and Docker with Compose support. Install dependencies and create
your local environment:

```bash
pnpm install
cp .env.example .env
```

Generate a private signup CAPTCHA signing secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set `ALTCHA_HMAC_SECRET` to the generated value in ignored `.env.local`. Do not
commit the secret. Signup requires it; there is no CAPTCHA bypass when unset.

Start PostgreSQL 18 with PostGIS 3.6 and apply migrations:

```bash
pnpm db:up
pnpm db:migrate
```

Compose waits for database health, stores data in a named volume, and binds the
published port to localhost. The first migration enables PostGIS if needed.

Then run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The homepage is `app/[locale]/page.tsx`, with signup under
`app/[locale]/signup/`. Visit `/en/signup` or `/es/signup` to create an account.
Signup automatically signs in and redirects home. Use **Log in** in the top bar
to sign in with email, password, and ALTCHA without leaving the current page.
The control then becomes a dropdown showing your display name, or your first name
and last-name initial if no display name is set (for example, **Ada L.**).
Its **Log out** action revokes only this browser's current session and leaves you
on the same page (or returns home from protected settings); other devices remain signed in.
Signed-in visitors to signup see a notice instead of the form. Password reset,
email verification, and a standalone global logout action are not implemented.

Choose **Settings** in the user dropdown to open `/en/settings` or `/es/settings`:

- **Profile:** update first name, last name, and optional display name. Email and
  date of birth are shown but cannot be changed. Saving also refreshes your user-menu name.
- **Password:** enter and confirm a new password, then confirm the change in a
  modal. This browser stays signed in; every other session is revoked.
- **Deactivate account:** confirm in a modal to disable your account and sign out
  everywhere. This does not delete stored account data. The email remains
  reserved, login is blocked, and there is no reactivation UI.

These sensitive changes require confirmation but not your current password or
another CAPTCHA. They require an active session. Login and confirmations use the
same reusable modal, with keyboard navigation and pending-submission protection.

For a local production build, run `pnpm build` followed by `pnpm start`.

## Database development

The application uses Drizzle ORM with the `pg` driver. In server-side Next.js
code, import `getDb` from `@/db` and call it when a database query is needed.
Connections are lazy and reused, including during development hot reloads.
Application tables (`users`, `sessions`, `captchaUses`) live in `db/schema.ts`.
See [ARCHITECTURE.md](ARCHITECTURE.md) for model details, signup validation,
password storage/verification, login/logout, session policy, and CAPTCHA verification. Follow the audit
column and database-trigger rules in [AGENTS.md](AGENTS.md) when adding models.

### Migrations

After changing the schema, generate a migration, review the generated SQL in
`drizzle/`, and apply it explicitly:

```bash
pnpm db:generate --name=describe-your-change
pnpm db:migrate
```

For SQL changes not represented by the schema, such as extensions:

```bash
pnpm db:generate --custom --name=describe-your-change
```

Edit the generated SQL before applying it. Commit both SQL and migration metadata.
Do not edit migrations that have already been applied. Migrations never run
automatically during builds or requests. Creating PostGIS requires an appropriately
privileged migration role; the local Docker user has the necessary privileges.

### Connection and lifecycle

Open a database shell using the container's configured credentials:

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Stop the database without deleting its data, then start it again when needed:

```bash
pnpm db:down
pnpm db:up
```

Do not add `-v` to `docker compose down` unless you intend to delete the database.
Initialization credentials only take effect when the volume is empty: changing
`.env` does not update an existing database's roles, passwords, or database name.
PostgreSQL major-version upgrades require a planned data migration, not just an
image tag change.

Compose reads `.env`. Next.js and Drizzle tooling load `.env*` through Next.js's
environment loader; local tooling uses development-mode precedence, so an
existing `.env.local` or `.env.development.local` can override `.env`. Keep
database settings aligned across these files. If port 5432 is occupied, change
`POSTGRES_PORT` and the port in `DATABASE_URL`. If credentials change, update the
URL too, percent-encoding special characters in URL credentials. Host-side clients
use `localhost:<POSTGRES_PORT>`; clients on the Compose network use `db:5432`.
Never prefix the connection URL with `NEXT_PUBLIC_` or commit real secrets.

The upstream `postgis/postgis:18-3.6` image documents amd64 support only. ARM
machines need a compatible image or explicitly configured amd64 emulation.
This setup is for local development: production needs separate strong credentials,
least-privilege application roles, backups, and appropriate network/TLS hardening.

## Signup protection and production readiness

Keep `ALTCHA_HMAC_SECRET` stable and identical across application instances, in a
private environment or production secret manager. Use at least 32 random
characters and never a `NEXT_PUBLIC_` variable. Rotating it invalidates outstanding
challenges. The widget runs locally without an external verification service;
JavaScript is required, and failed signup/login attempts need fresh verification.
The same signing secret covers purpose-separated signup and login challenges;
there is no additional login configuration or migration.

Arrange periodic cleanup of expired proof-use records:

```sql
DELETE FROM captcha_uses WHERE expires_at < statement_timestamp();
```

Expired sessions are ignored but not automatically pruned. Sessions have a fixed
30-day lifetime; closing a tab does not sign out. Production requires HTTPS for
secure session cookies. Password-strength requirements and distributed rate
limiting remain deferred. ALTCHA proof-of-work and the per-process hashing bound
are not rate limiting. Duplicate-email errors reveal registration status. Review
abuse protection and operational hardening before a public production rollout.

## Verification

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm test:db:unit  # Configuration, lazy initialization, server-only boundary, pool reuse
pnpm test:auth     # Validation, password creation/verification, cookie/CAPTCHA config, auth actions
pnpm test:db       # Live migrations, users/sessions, signup/login/logout/settings, CAPTCHA replay protection
pnpm test          # HTTP/localization checks against a running server
pnpm test:e2e      # Browser checks; starts dev if TEST_BASE_URL is not set
```

Install Playwright's Chromium browser before the first browser run:

```bash
pnpm exec playwright install chromium
```

Live tests require `pnpm db:up` and `pnpm db:migrate` first. The
connection-recovery check disconnects only a backend opened by that test.
Run these tests against a development database, not production. Database tests
use rolled-back transactions where possible. Concurrency and browser tests create
uniquely named fixture accounts and delete only their own records; associated
sessions are removed by cascade. Browser signup tests run sequentially within
their file to avoid saturating the intentional per-process hashing bound. The
`pnpm test` suite requires a running Next.js server at `http://localhost:3000`
(or a URL supplied through `TEST_BASE_URL`).

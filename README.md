# Track Atlas

_Explore your tracks. Discover new paths._

Track Atlas is an in-development website for storing GPX tracks, viewing them on
an interactive map, and searching a personal or public track collection.

**Implemented:** English/Spanish homepage, light/dark/system themes, signup with
automatic sign-in, top-bar modal login/logout, persistent database-backed
sessions, profile/password/account-deactivation settings, email confirmation and
password recovery through Brevo's API, and self-hosted ALTCHA
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
Signed-in visitors to signup see a notice instead of the form. Signup also sends
a confirmation email; confirmation is not required to sign in. Use **Forgot
password?** in the login modal to request a reset link. Completing a reset revokes
all account sessions and requires signing in again. A standalone global logout
action is not implemented.

Choose **Settings** in the user dropdown to open `/en/settings` or `/es/settings`:

- **Profile:** update first name, last name, and optional display name. Email and
  date of birth are shown but cannot be changed. Saving also refreshes your user-menu name.
  Email-confirmation status and an independent resend button appear beside email.
- **Password:** enter and confirm a new password, then confirm the change in a
  modal. This browser stays signed in; every other session is revoked.
- **Deactivate account:** confirm in a modal to disable your account and sign out
  everywhere. This does not delete stored account data. The email remains
  reserved, login is blocked, and there is no reactivation UI.

These sensitive settings changes require confirmation but not your current password or
another CAPTCHA. They require an active session. Login and confirmations use the
same reusable modal, with keyboard navigation and pending-submission protection.

For a local production build, run `pnpm build` followed by `pnpm start`.

## Account email setup

Set `EMAIL_RATE_LIMIT_SECRET` to at least 32 random bytes in private `.env.local`
(generate it like `ALTCHA_HMAC_SECRET`). Set `APP_ORIGIN` to the trusted origin
used in email links. It must be HTTPS in production; loopback HTTP is allowed for
local development. Do not include a path, query, credentials, or fragment.

Development defaults to `EMAIL_DELIVERY_MODE=capture`: messages are written as
private JSON files under ignored `.superpowers/mail/` (at most 100 retained).
These files contain live account links; do not share them. `EMAIL_CAPTURE_DIR`
can change this private local directory. No Brevo credentials are needed in this
mode. Production rejects capture and the private test-sink configuration.

For actual delivery, explicitly set `EMAIL_DELIVERY_MODE=brevo`, `BREVO_API_KEY`,
`EMAIL_FROM_ADDRESS`, and `EMAIL_FROM_NAME` (at most 70 characters). Verify the
sender/domain in Brevo and configure SPF/DKIM/DMARC. Disable transactional open and
click tracking in Brevo's account settings so secret-bearing links remain direct.
No configuration is public or prefixed `NEXT_PUBLIC_`; never put API keys in chat,
logs, or source control.

The server posts application-owned HTML and plain text to
`https://api.brevo.com/v3/smtp/email`. The endpoint reference supports both
`htmlContent` and `textContent` (the introductory guide's one-body wording is
inconsistent with that reference). No contacts are synchronized or templates
hosted in Brevo. Messages have a five-second timeout, no automatic retries, and
are attempted after the account transaction commits. Provider acceptance does
not prove delivery. Signup remains successful when sending fails; use Settings
to resend. There is no worker, delivery queue, or webhook service.

Confirmation links expire after 24 hours. Opening a link in the browser confirms
the email automatically and displays the result, with no second button press.
This requires JavaScript: passive fetchers do not consume links, but scanners
that execute JavaScript may confirm them. Reset links expire
after one hour. Both are single-use; requesting another does not invalidate an
earlier usable link. Password changes invalidate all reset links. Deactivation
invalidates both purposes. Password resets do not implicitly confirm email.

Sending is limited in PostgreSQL to once per 60 seconds and three times per
rolling hour per email/purpose, plus 250 attempts per UTC day across the app.
Failures count too; there are no retries or quota refunds. Other sends from the
same Brevo account can exhaust its 300/day free allowance. The limit secret must
be consistent across instances; rotating it resets address limiter identities.
These limits mitigate email abuse but do not prevent global quota exhaustion,
address-targeted throttling, or timing-based account inference. Recovery does not
yet add CAPTCHA/IP limiting; review edge protection before a public launch.

Configure production access logs to redact query strings on `/en/confirm-email`,
`/es/confirm-email`, `/en/reset-password`, and `/es/reset-password`. Framework dev
logs and browser traces can contain token URLs too: keep those local and private.
Token routes send no-referrer, no-store and noindex/nofollow protections; avoid
adding third-party analytics/assets there. Cleanup periodically, outside active
rate windows:

```sql
DELETE FROM account_action_tokens
WHERE expires_at < clock_timestamp() OR consumed_at IS NOT NULL OR revoked_at IS NOT NULL;
DELETE FROM email_send_limits
WHERE (key LIKE 'address:%' AND updated_at < clock_timestamp() - interval '1 hour')
   OR (key LIKE 'daily:%' AND updated_at < date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
```

For an explicitly authorized manual live-send check, use a development database
and an address you control, opt into Brevo mode, and verify both languages,
untracked direct links, automatic confirmation, password reset, session
revocation, and provider logs. Automated tests never perform real sends.

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
pnpm test:e2e      # Isolated browser app on 127.0.0.1:3100, with private email capture
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

Playwright starts its own app with `.next-e2e` output and capture-only email
configuration; it does not reuse your normal dev server. Only loopback
`127.0.0.1` is added to Next's allowed development origins. Its private ephemeral
sink uses run metadata under `/tmp/opencode` and a bearer secret, never a public
Next route. `EMAIL_TEST_SINK_URL` and `EMAIL_TEST_SINK_TOKEN` are private harness
settings. If using `TEST_BASE_URL`, email browser tests also require compatible
capture metadata via `EMAIL_TEST_METADATA`; do not point them at production.
The live limiter clock tests create and drop their own isolated schemas and need
`CREATE SCHEMA` privileges on the development database. Their clock override is
test-only; production migrations and runtime expose no clock/verification bypass.

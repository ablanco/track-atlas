# Track Atlas architecture

This document describes the implemented system. For setup and operations, see
[README.md](README.md); for contributor rules, see [AGENTS.md](AGENTS.md).
[Product design](docs/DESIGN.md) describes the intended product, not a list of
completed features. Historical designs and plans live in `docs/superpowers/`.

## 1. Current scope and stack

Track Atlas is a single Next.js application backed by PostgreSQL. It currently
provides an English/Spanish homepage, light/dark/system themes, account signup,
persistent sessions, and self-hosted ALTCHA signup protection.

GPX uploads, track storage, interactive maps, spatial search, public profiles,
and collection management are **not implemented**. The homepage's map is an
illustration, not a map service. PostGIS is enabled as database infrastructure;
there are no track tables or spatial queries yet.

| Layer | Implementation |
| --- | --- |
| Application | Next.js 16.4 App Router, React 19.3, TypeScript |
| Rendering | Server Components, Cache Components, partial prefetching, Suspense |
| Interactive UI | Client Components for form state, locale/theme controls, ALTCHA |
| Localization | `next-intl` 4.14.9, English and Spanish JSON messages |
| Styling | Tailwind CSS 4, shared CSS tokens, `next-themes`, Phosphor Icons |
| Persistence | Drizzle ORM with the `pg` driver; PostgreSQL 18 / PostGIS 3.6 locally |
| Signup protection | ALTCHA widget 3.3.0 and `altcha-lib` 2.6.0 |
| Tooling | pnpm, ESLint, TypeScript, Node test runner/tsx, Playwright Chromium |

The application requires a Node.js server runtime: authentication uses Node
crypto and PostgreSQL connections. There is no separate backend service, worker
queue, object store, or external CAPTCHA verification service.

## 2. Module boundaries

```text
Browser
  ├─ Localized pages / Client Components
  ├─ Signup Server Action ── auth/signup-action.ts
  │                           ├─ validation + current-session check
  │                           ├─ auth/captcha.ts ── atomic proof consumption
  │                           └─ auth/signup.ts
  │                                ├─ auth/password.ts
  │                                └─ transaction: user + session
  └─ GET /api/altcha/challenge ── signed challenge (no database write)
                                      │
                           db/index.ts → Drizzle → pg → PostgreSQL
```

| Location | Responsibility |
| --- | --- |
| `app/[locale]/` | Shared root layout, homepage, signup page/form/Server Action adapter |
| `app/api/altcha/challenge/route.ts` | Nonlocalized challenge endpoint |
| `components/` | Shared presentation and interactive controls |
| `auth/validation.ts` | Pure allowlisted signup parsing and validation |
| `auth/signup-action.ts` | Testable orchestration with injected request effects |
| `auth/signup.ts` | Password hashing and transactional registration service |
| `auth/session.ts`, `auth/session-store.ts` | Cookie adapter and database-session lifecycle |
| `auth/captcha.ts`, `auth/password.ts` | Server-only proof verification and password hashing |
| `db/` | Schema, audit-column factory, pool factory, server-only database accessor |
| `drizzle/` | Ordered SQL migrations, schema snapshots, migration journal |
| `i18n/`, `messages/`, `proxy.ts` | Locale configuration, navigation, translations, negotiation |
| `styles/`, `app/globals.css` | Shared scales, theme palettes, semantic Tailwind utilities |
| `tests/` | Unit, live-database, HTTP, and browser checks |

Database access and authentication effects stay on the server. Client code
receives localized labels and safe form state, never password hashes, database
credentials, or the CAPTCHA signing secret. The public Server Action constructs
its dependencies itself; clients cannot inject verification or cookie functions.

## 3. Routing and rendering

- `/en` and `/es` render the homepage; `/en/signup` and `/es/signup` render signup.
- `i18n/routing.ts` uses always-prefixed locales and English as the default.
  `proxy.ts` negotiates unprefixed routes such as `/signup`, excluding API,
  framework, and file paths. Unsupported language prefixes are rejected by the
  locale layout instead of becoming nested locale redirects.
- `i18n/navigation.ts` supplies locale-aware links/navigation. The language
  switcher retains the pathname when changing locale.
- `app/[locale]/layout.tsx` is the root layout. It validates the locale, declares
  static locale parameters, loads Geist fonts through `next/font`, and provides
  the shared navigation, theme provider, and translation provider.
- Pages provide localized metadata and language alternates. Translation loading
  uses `next/root-params` and the request configuration in `i18n/request.ts`.

With `cacheComponents` enabled, public shells can be prerendered while
request-specific content streams under Suspense. Homepage signup-link visibility
depends on the current session; the link is hidden for signed-in users or when
the session lookup fails. Signup's `GuestForm` calls `await connection()` before
authentication and calculating today's UTC date. Signed-in visitors redirect home;
lookup failures show an unavailable message rather than a registration form.
Session-dependent output must not enter a shared public cache.

## 4. Presentation and browser state

`styles/tokens.css` defines shared spacing, typography, radii, shadows, and content
width. `styles/themes.css` supplies semantic light/dark palettes, exposed as
Tailwind utilities by `app/globals.css`. Components use semantic colors rather
than maintaining separate per-component palettes. Global styles include visible
keyboard focus and reduced-motion handling.

`next-themes` applies `data-theme` to the document and stores the preference under
`track-atlas-theme` in local storage; the default follows the system. The theme
control waits for hydration before exposing client-dependent state. The pnpm
patch in `patches/next-themes@0.4.6.patch` retains the startup script for SSR and
hydration but prevents remounting it on client navigation. Preserve and recheck
this behavior when upgrading the dependency.

Icons use individual Phosphor imports appropriate to Server or Client Components.
The signup form uses React `useActionState`, pending-submit feedback, field
errors, and a focused form-level alert after errors. ALTCHA loads after hydration,
uses a native checkbox and local Spanish translations, inherits theme colors,
and resets after an unsuccessful submission. JavaScript is required for signup
verification. `types/altcha.d.ts` covers the upstream Spanish JS/declaration
filename mismatch.

## 5. Signup flow and validation

1. The guest fills in first name, last name, email, date of birth, and password;
   display name is optional. Avatars are not collected.
2. The widget obtains and solves a challenge from `/api/altcha/challenge` and
   adds the `altcha` proof to the form.
3. The Server Action adapter in `app/[locale]/signup/actions.ts` delegates to
   `handleSignup`. It validates the locale, checks the current user, and returns
   validation errors before expensive registration work.
4. A valid proof is verified and atomically consumed before password hashing.
5. `registerUser` hashes the password, then inserts the user and initial session
   in one transaction. A session-insert failure rolls back the account insertion.
6. After commit, the adapter sets the session cookie and redirects to the
   localized homepage. The cookie effect is not part of the database transaction.

The parser accepts only known account fields; supplied privilege flags are not
inserted. Duplicate fields and file values are rejected for known inputs.
Names/email are trimmed, names/display name allow 200 Unicode characters, and
email allows 254 characters with basic format validation. Birthdays are calendar
dates from year 0001 through today in UTC, without an age-eligibility rule.
Passwords preserve spaces, must be nonempty, and are bounded to 1,024 UTF-8 bytes;
strength requirements remain deferred.

Returned state contains bounded safe values and error codes, never the password.
Duplicate email produces a field error, including for inactive accounts.
Infrastructure failures produce a generic retry/unavailable error. Redirects
remain outside the registration catch so successful navigation is not swallowed.

## 6. Authentication and bot protection

### Password storage

`auth/password.ts` uses asynchronous scrypt with `N=32768`, `r=8`, `p=3`, a
64-byte derived key, and a fresh random 16-byte salt per password. The versioned
`password_hash` encoding contains the algorithm, parameters, salt, and result.
There is no separate salt column or configured pepper. Only two hashes execute
per process concurrently; excess requests fail with a retry error, not a queue.
This resource guard is **not** distributed rate limiting.

### Sessions

Sessions use cryptographically random 32-byte base64url tokens. Only SHA-256
digests are stored in `sessions`; the raw token exists in the browser cookie.
The `track_atlas_session` cookie is host-only, HttpOnly, SameSite=Lax, Path=/,
and Secure in production. Production must be served over HTTPS.

Database time establishes a fixed 30-day expiry, also used for cookie expiry;
there is no sliding refresh. Each lookup validates token shape, joins the user,
and checks database-clock expiry and `users.active = true`. The exposed identity
currently contains only `userId`, not an authorization role. Sessions survive
server restarts and can be revoked by deleting their rows. Expired rows are
ignored; automated pruning and a sign-out UI are not implemented.

### ALTCHA

Challenges are signed using the private `ALTCHA_HMAC_SECRET` (at least 32
characters after trimming). All instances must share it. Missing configuration
fails closed; rotating it invalidates outstanding challenges.

The endpoint returns fresh, non-cacheable, signup-purpose-bound SHA-256 challenges
with five-minute expiry, cost 1, and a random target counter from 25,000 to 75,000.
Challenge issuance does not persist a row. Submission accepts one string proof
of at most 8,192 characters, checks its structure and supported parameters, then
uses `altcha-lib` to verify the signature, expiry, and solution.

A unique insert of the challenge-signature digest into `captcha_uses` determines
the single winner across concurrent requests and application instances. Store
errors fail closed. Consumption precedes registration and is separate from its
transaction: duplicate-email or later registration failures still consume the
proof. A retry needs a fresh verification.

The widget, workers, and translations are bundled locally, with no external
CAPTCHA API or CDN. Interaction-signature collection and form-field/timezone
forwarding are disabled. Proof records contain no account fields or IP addresses.
Proof-of-work raises automation cost; it does not establish that a user is human
or replace rate limiting.

## 7. Persistence and migrations

`db/schema.ts` maps camelCase application fields to snake_case SQL columns:

| Table | Data and constraints |
| --- | --- |
| `users` | Database-generated UUID; required first/last name, email, password hash, date of birth; nullable display name/avatar URL; `active` defaults true; non-null `admin` and `emailConfirmed` default false |
| `sessions` | UUID, user FK with delete cascade, unique token digest, timezone-aware expiry; user-ID index |
| `captcha_uses` | Challenge-signature digest primary key, timezone-aware expiry and expiry index |

Email uniqueness is enforced by a unique `lower(email)` index, including inactive
accounts. SQL checks enforce nonblank names/email/password hash and trimmed
email, not full application validation or cryptographic hash validity. Birthdays
use SQL `date` mapped to `YYYY-MM-DD` strings, avoiding timezone conversion.
User/session select and insert types are inferred from the schema. Future public
profile queries must explicitly select safe fields instead of serializing users.

Every table spreads a fresh `auditColumns()` result: non-null timezone-aware
`created_at` and `updated_at`, initialized by database defaults. Each migration
attaches a `BEFORE UPDATE` trigger calling `public.set_updated_at()`, so Drizzle
and direct SQL updates use database modification time, overriding stale supplied
values. Runtime-only ORM hooks are not a substitute.

| Migration | Change |
| --- | --- |
| `0000_enable-postgis.sql` | Enable PostGIS |
| `0001_add-users.sql` | Users and shared modification-time trigger function |
| `0002_add-sessions.sql` | Sessions and audit trigger |
| `0003_add-user-flags.sql` | Admin/email-confirmation defaults, backfill, non-null constraints |
| `0004_add-captcha-uses.sql` | Single-use proof tracking and audit trigger |

`getDb()` initializes a pool lazily, retaining it across development hot reloads
via `globalThis` and at module scope in production. The pool has a five-second
connection timeout and sanitized idle-connection error logging. Low-level
`createDatabase` supports tools/tests that own and close their connections.

Migrations run explicitly through Drizzle Kit, not at build or request time.
Applied migrations are immutable; commit new SQL and metadata together and
review trigger SQL that Drizzle Kit cannot infer. See the README for commands.

## 8. Runtime configuration and operations

`DATABASE_URL` and `ALTCHA_HMAC_SECRET` are private server configuration. Compose
uses `.env` for its PostgreSQL variables; Next.js and Drizzle use Next's environment
loader, with development-mode precedence for local tooling. Keep overrides and
credentials aligned. No secret belongs in a `NEXT_PUBLIC_` variable.

Local Compose runs only the database, with a health check, localhost-only port,
and persistent named volume. Next.js runs on the host. Production deployment,
backups, TLS, least-privilege roles, and scheduled maintenance are operator
responsibilities, not provisioned by this repository. Periodically remove expired
CAPTCHA-use records; session cleanup is also not scheduled by the application.

## 9. Verification and remaining boundaries

| Checks | Coverage |
| --- | --- |
| `pnpm test:db:unit` | Configuration, lazy initialization, pool reuse, server-only imports |
| `pnpm test:auth` | Validation, password hashing, cookie policy, CAPTCHA configuration, action orchestration |
| `pnpm test:db` | Live migrations/constraints, audit triggers, session lookups, transactional signup, concurrent proof consumption |
| `pnpm test` | HTTP rendering, metadata, localization; requires a running server |
| `pnpm test:e2e` | Chromium UI, themes, locale navigation, signup, real widget solving, action tampering, cookies, rendering diagnostics |
| Lint / TypeScript / build | Static checks and production compilation |

Live checks require a migrated development database. Tests use rollback where
possible, otherwise uniquely named fixtures and scoped cleanup. Browser signup
cases run sequentially within their file to respect the hashing guard; CAPTCHA
tests solve real challenges rather than using a production verification bypass.
`TEST_BASE_URL` selects an existing server; without it, Playwright starts or
reuses a local development server.

There is no returning-user login, sign-out control, password reset, OAuth, email
verification, or account-management UI. Stored privilege flags do not constitute
an implemented admin authorization system. Duplicate-email feedback exposes
registration status. Distributed rate limiting, broader abuse review, automated
expiry cleanup, and production operational hardening remain outstanding before
a public production rollout.

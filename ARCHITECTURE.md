# Track Atlas architecture

This document describes the implemented system. For setup and operations, see
[README.md](README.md); for contributor rules, see [AGENTS.md](AGENTS.md).
[Product design](docs/DESIGN.md) describes the intended product, not a list of
completed features. Historical designs and plans live in `docs/superpowers/`.

## 1. Current scope and stack

Track Atlas is a single Next.js application backed by PostgreSQL. It currently
provides an English/Spanish homepage, light/dark/system themes, account signup,
modal login, current-session logout, persistent sessions, authenticated account
settings, and self-hosted ALTCHA protection for signup and login.

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
| Authentication protection | ALTCHA widget 3.3.0 and `altcha-lib` 2.6.0 |
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
  ├─ Login Server Action ── auth/login-action.ts → auth/login.ts
  │                           └─ proof → password verification → session rotation
  ├─ Logout Server Action ── auth/logout-action.ts → session revocation
  ├─ Settings Server Actions ── auth/settings-action.ts → auth/settings.ts
  │                            └─ token authorization → locked user/session mutation
  └─ ALTCHA challenge endpoints ── signed challenge (no database write)

Server-side persistence: db/index.ts → Drizzle → pg → PostgreSQL
```

| Location | Responsibility |
| --- | --- |
| `app/[locale]/` | Shared root layout, homepage, signup and settings pages/forms/Server Action adapters |
| `app/api/altcha/challenge/route.ts` | Nonlocalized challenge endpoint |
| `components/` | Shared presentation and interactive controls |
| `auth/validation.ts` | Pure allowlisted signup parsing and validation |
| `auth/signup-action.ts` | Testable orchestration with injected request effects |
| `auth/signup.ts` | Password hashing and transactional registration service |
| `auth/login-validation.ts`, `auth/login-action.ts`, `auth/login.ts` | Login parsing, proof-before-credentials orchestration, and transactional session rotation |
| `auth/logout-action.ts`, `app/[locale]/auth-actions.ts` | Revocation-before-cookie-clear orchestration and request/cookie adapters |
| `components/header-auth.tsx`, `components/auth-control.tsx`, `components/login-form.tsx` | Request-time header state, accessible native-dialog login, and logout UI |
| `components/modal.tsx` | Shared native dialog, accessibility, initial/return focus, dismissal, pending protection |
| `auth/settings-validation.ts`, `auth/settings-action.ts`, `auth/settings.ts` | Allowlisted account input, injectable orchestration, safe profile reads, transactional account mutations |
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
- `/en/settings` and `/es/settings` render account settings for authenticated users;
  guests redirect to the localized homepage. Settings metadata excludes indexing.
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
authentication and calculating today's UTC date. Signed-in visitors see an
already-signed-in notice and homepage link, not the signup form; lookup failures
show an unavailable message rather than a registration form. The header auth
control also reads the session at request time under its own Suspense boundary;
failed lookups show unavailable/retry feedback, not a false guest state.
Session-dependent output must not enter a shared public cache.
Settings also calls `connection()` within its Suspense boundary before reading
the cookie and profile. Lookup failures show an unavailable alert without private
fields/forms. Only first/last/display name, email, and date of birth reach the
settings client. Date of birth remains a date-only `YYYY-MM-DD` string and is
displayed in a read-only date input without timezone conversion.

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

The header login trigger is disabled until hydration. The shared `Modal` in
`components/modal.tsx` uses native `dialog` for login and settings confirmations. It provides
an inert background, with explicit Tab wrapping, initial email focus, XIcon/Escape/
backdrop dismissal, and focus restoration. Closing discards the form/password/proof.
Pending login disables dismissal and signup navigation. Unique input IDs and
scoped widget lookups allow the modal to coexist with signup. A semantic
`modal-backdrop` token supplies the dim overlay in both themes.
Confirmation dialogs initially focus Cancel and restore their connected trigger
without scrolling. All dismissal paths and repeat submissions are disabled while
pending. Settings uses shared `danger`/`on-danger` tokens for destructive controls.

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

### Login and logout flows

The header switches between **Log in** and a user-name dropdown based on
server-backed session state. The dropdown shows the display name, falling back
to the first name and last-name initial (for example, **Ada L.**), and contains
**Settings** followed by **Log out**. Its keyboard navigation, Escape/outside-click dismissal,
and focus handling live in `components/user-menu.tsx`; pending and failed logout
retain the existing status/error feedback. Login asks for email/password and a login-purpose ALTCHA proof.
Validation bounds are the same as signup's email/password rules. Only bounded
email and error codes return to the client; passwords/proofs reset after errors.

`handleLogin` orders validation, proof consumption, credential verification, and
cookie issuance. `loginUser` looks up email case-insensitively, verifies the
password, and rejects nonexistent, inactive, incorrect-password, and unsupported-
hash accounts with the same invalid-credentials reason. Unconfirmed email does
not block login. Inside a transaction it locks/rechecks the active account and
unchanged password hash, revokes the prior request-cookie session if present,
and creates a fresh session. Failed session creation rolls back revocation.

Logout is a POST Server Action. It deletes only the current cookie token's digest
row before clearing the cookie; other sessions remain valid. Missing/malformed/
already-revoked sessions are idempotent success. Database failure reports
unavailable and preserves the cookie for retry rather than claiming revocation.

Login/logout return structured state, not redirects or client-supplied return URLs.
Next.js cookie mutations rerender the current route in the same response, updating
the header and homepage signup link. The client retains the URL and explicitly
restores submitted scroll position after layout changes. On signup, successful
login shows the authenticated notice on that same route; logout restores the form.
Login/logout do not add browser-local auth storage or continuous cross-tab sync.
Logging out on the protected settings route returns to the localized homepage.

### Account settings

Profile, password, and deactivation are independent controls. Profile allows
required first/last names and optional display name, all trimmed and limited to
200 Unicode characters; blank display names become null. Email and date of birth
are read-only and are not submitted by the form.
The server explicitly allowlists updates, ignoring supplied email, user IDs,
privilege/active flags, birthdate, and avatar fields. A successful update calls
`refresh()` to rerender the current route and header in the action response,
without remounting unrelated form state.

Password entry requires matching new-password fields, preserves spaces, and
uses the same nonempty/1,024-UTF-8-byte bounds and bounded scrypt hasher as signup.
The client validates before opening confirmation, snapshots the submitted form,
and sends it only after confirmation. Server validation still applies to direct
action calls. Passwords are never echoed through action state and are cleared
after an attempted mutation. Cancel does not mutate the account.
Invalid password fields have danger-colored borders and inline error messages
in both themes, in addition to `aria-invalid` and associated error descriptions.

Every settings mutation validates locale and authorizes the request cookie, not
client-supplied account identifiers. The service authenticates before password
hashing, locks the user row in the same order as login, then rechecks active
status, session ownership and database-clock expiry while locking the request
session. Revoked or expired sessions cannot authorize a mutation after hashing
or waiting for the user lock. Password change writes the new hash and removes
every other session atomically; the current token and fixed expiry remain intact.
Existing login's locked password-hash recheck prevents stale-credential logins.

Deactivation atomically sets `users.active=false` and deletes all user sessions.
Only after commit does the action clear the cookie and redirect home. A cookie
clearing failure returns explicit completed-deactivation state and a homepage
link, not an apparent rollback/retry of the mutation. Database failures roll
back updates and revocation together; exception details stay private. Missing,
expired, revoked, or inactive sessions fail closed with safe feedback.

Sensitive settings changes use confirmation only: no current-password check or
new CAPTCHA is required. Possession of an active session is therefore sufficient
to change credentials or disable the account; confirmation is a UX safeguard,
not additional authentication. Signup/login ALTCHA remains unchanged. There is
no global logout button, reactivation UI, or hard deletion: disabled accounts
retain their data and reserved email, which still cannot be registered again.

## 6. Authentication and bot protection

### Password storage

`auth/password.ts` uses asynchronous scrypt with `N=32768`, `r=8`, `p=3`, a
64-byte derived key, and a fresh random 16-byte salt per password. The versioned
`password_hash` encoding contains the algorithm, parameters, salt, and result.
There is no separate salt column or configured pepper. Verification accepts only
the exact current version/parameters and canonical 16-byte salt/64-byte key
encoding, derives asynchronously, and compares with `timingSafeEqual`. Unknown
accounts or unsupported hashes still perform fixed-cost dummy scrypt to reduce a
simple timing signal, not to promise identical request timings. Creation and
verification share a maximum of two concurrent scrypt operations per process;
excess requests fail with a retry error, not a queue.
This resource guard is **not** distributed rate limiting.

### Sessions

Sessions use cryptographically random 32-byte base64url tokens. Only SHA-256
digests are stored in `sessions`; the raw token exists in the browser cookie.
The `track_atlas_session` cookie is host-only, HttpOnly, SameSite=Lax, Path=/,
and Secure in production. Production must be served over HTTPS.

Database time establishes a fixed 30-day expiry, also used for cookie expiry;
there is no sliding refresh. Each lookup validates token shape, joins the user,
and checks database-clock expiry and `users.active = true`. The exposed identity
contains only `userId`, `firstName`, `lastName`, and `displayName`, not an
authorization role or other account fields. Only the derived name label is
passed to the header's client control. Sessions survive
server restarts and can be revoked by deleting their rows. Expired rows are
ignored; automated pruning is not implemented. The header logout control revokes
the current session, not all devices.

### ALTCHA

Challenges are signed using the private `ALTCHA_HMAC_SECRET` (at least 32
characters after trimming). All instances must share it. Missing configuration
fails closed; rotating it invalidates outstanding challenges.

`/api/altcha/challenge` issues signup-purpose challenges;
`/api/altcha/login/challenge` issues login-purpose challenges. Both return fresh,
non-cacheable, purpose-bound SHA-256 challenges
with five-minute expiry, cost 1, and a random target counter from 25,000 to 75,000.
Challenge issuance does not persist a row. Submission accepts one string proof
of at most 8,192 characters, checks its structure and supported parameters, then
uses `altcha-lib` to verify the signature, expiry, and solution.

A unique insert of the challenge-signature digest into `captcha_uses` determines
the single winner across concurrent requests and application instances. Store
errors fail closed. Signup proofs cannot authorize login or vice versa.
Consumption precedes password work and is separate from account/session
transactions: duplicate-email, bad-credentials, busy hashing, and later storage
failures still consume the proof. A retry needs a fresh verification.

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
| `pnpm test:auth` | Validation, password creation/verification and shared capacity, cookie policy, CAPTCHA configuration, login/signup/logout/settings orchestration and post-commit effects |
| `pnpm test:db` | Live migrations/constraints, audit triggers, sessions, signup, credential checks, rotation/revocation, settings allowlists/rollback/lock races, concurrent purpose-bound proof consumption |
| `pnpm test` | HTTP rendering, metadata, localization; requires a running server |
| `pnpm test:e2e` | Chromium UI, themes, locale navigation, signup/login/logout/settings, shared-dialog keyboard/focus/scroll/pending behavior, password/deactivation across browsers, real widget solving, action tampering/replay, cookies, rendering diagnostics |
| Lint / TypeScript / build | Static checks and production compilation |

Live checks require a migrated development database. Tests use rollback where
possible, otherwise uniquely named fixtures and scoped cleanup. Browser signup
cases run sequentially within their file to respect the hashing guard; CAPTCHA
tests solve real challenges rather than using a production verification bypass.
`TEST_BASE_URL` selects an existing server; without it, Playwright starts or
reuses a local development server.

There is no password reset, OAuth, email verification, standalone global logout,
email editing, account reactivation, or hard-deletion UI. Stored privilege flags do not constitute
an implemented admin authorization system. Duplicate-email feedback exposes
registration status. Distributed rate limiting, broader abuse review, automated
expiry cleanup, and production operational hardening remain outstanding before
a public production rollout.

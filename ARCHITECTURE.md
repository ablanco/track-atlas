# Track Atlas architecture

This document describes the implemented system, its security boundaries, test
coverage, and operational responsibilities. For installation, configuration, and
commands, see [README.md](README.md); for contributor rules, see
[AGENTS.md](AGENTS.md).
[Product design](docs/DESIGN.md) describes the intended product, not a list of
completed features. Historical designs and plans live in `docs/superpowers/`.

## 1. Current scope and stack

Track Atlas is a single Next.js application backed by PostgreSQL. It currently
provides an English/Spanish homepage, light/dark/system themes, account signup,
modal login, current-session logout, persistent sessions, authenticated account
settings, Brevo API email confirmation/password recovery, and self-hosted ALTCHA
protection for signup and login.

Next.js is pinned to 16.4.2 for the security update from 16.4.0. The
`experimental.agentUpgrade` policy is `security`, enabling advisory-based upgrade
reminders without automatically updating dependencies.

A private file-upload API accepts avatar images and GPX documents through local
storage or Backblaze B2. Settings supports optional avatar upload and private
128px Settings and 24px top-bar avatar display. Confirmed accounts can upload
private or deliberately public single-segment GPX Tracks, read metric summaries and elevation/speed
charts and an interactive original-point map, and download unchanged originals;
full geometry, analytics and directional representations are derived at creation.
Public text/filter search and user collection browsing share a ten-track explorer.
Owners can browse private tracks in their own collections. Spatial/directional
search, additional public profile features, and track editing/deletion are
**not implemented**. The homepage's map is an
illustration, not a map service. PostGIS stores the full Track geometry and
five directional representations; spatial search is not implemented.

| Layer                     | Implementation                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Application               | Next.js 16.4 App Router, React 19.3, TypeScript                                                  |
| Rendering                 | Server Components, Cache Components, partial prefetching, Suspense                               |
| Interactive UI            | Client Components for form state, locale/theme controls, ALTCHA                                  |
| Localization              | `next-intl` 4.14.9, English and Spanish JSON messages                                            |
| Styling                   | shadcn/ui Base UI Vega, Tailwind CSS 4, semantic tokens, `next-themes`, Phosphor Icons           |
| Persistence               | Drizzle ORM with the `pg` driver; PostgreSQL 18 / PostGIS 3.6 locally                            |
| Authentication protection | ALTCHA widget 3.3.0 and `altcha-lib` 2.6.0                                                       |
| Tooling                   | pnpm, ESLint, Prettier, Husky/lint-staged, TypeScript, Node test runner/tsx, Playwright Chromium |

The application requires a Node.js server runtime: authentication uses Node
crypto and PostgreSQL connections. There is no separate backend service, worker
queue or external CAPTCHA verification service. File storage uses the application
host's private filesystem or a private Backblaze B2 bucket. Brevo is the
external transactional email delivery boundary; no background email worker exists.

## 2. Module boundaries

```text
Browser
  ├─ Localized pages / Client Components
  ├─ Signup Server Action ── auth/signup-action.ts
  │                           ├─ validation + current-session check
  │                           ├─ auth/captcha.ts ── atomic proof consumption
  │                           ├─ auth/signup.ts
  │                                ├─ auth/password.ts
  │                                └─ transaction: user + session + confirmation token
  │                           └─ after commit: confirmation email → session cookie
  ├─ Login Server Action ── auth/login-action.ts → auth/login.ts
  │                           └─ proof → password verification → session rotation
  ├─ Logout Server Action ── auth/logout-action.ts → session revocation
  ├─ Settings Server Actions ── auth/settings-action.ts → auth/settings.ts
  │                            └─ token authorization → locked user/session mutation
  ├─ Account email Server Actions ── auth/account-email-action.ts
  │                                  ├─ auth/account-email.ts → issue/resend links
  │                                  ├─ auth/account-confirmation.ts → confirm email
  │                                  └─ auth/password-recovery.ts → reset + revoke sessions
  └─ ALTCHA challenge endpoints ── signed challenge (no database write)

Server-side persistence: db/index.ts → Drizzle → pg → PostgreSQL
Email after commit: email/send.ts → Brevo API (production) / private capture (development)
```

| Location                                                                                 | Responsibility                                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `app/[locale]/`                                                                          | Shared root layout, homepage, signup, settings, confirmation and password-reset pages/forms/Server Action adapters      |
| `app/api/altcha/challenge/route.ts`, `app/api/altcha/login/challenge/route.ts`           | Nonlocalized, purpose-separated signup and login challenge endpoints                                                    |
| `components/`                                                                            | Shared presentation and interactive controls                                                                            |
| `auth/validation.ts`                                                                     | Pure allowlisted signup parsing and validation                                                                          |
| `auth/signup-action.ts`                                                                  | Testable orchestration with injected request effects                                                                    |
| `auth/signup.ts`                                                                         | Password hashing and transactional registration service                                                                 |
| `auth/login-validation.ts`, `auth/login-action.ts`, `auth/login.ts`                      | Login parsing, proof-before-credentials orchestration, and transactional session rotation                               |
| `auth/logout-action.ts`, `app/[locale]/auth-actions.ts`                                  | Revocation-before-cookie-clear orchestration and request/cookie adapters                                                |
| `components/header-auth.tsx`, `components/auth-control.tsx`, `components/login-form.tsx` | Request-time header state, shadcn dialog login, and logout UI                                                           |
| `components/ui/dialog.tsx`                                                               | shadcn/Base UI dialog primitives, localized close button, shared sizing and scroll bounds                               |
| `auth/settings-validation.ts`, `auth/settings-action.ts`, `auth/settings.ts`             | Allowlisted account input, injectable orchestration, safe profile reads, transactional account mutations                |
| `auth/session.ts`, `auth/session-store.ts`                                               | Cookie adapter and database-session lifecycle                                                                           |
| `auth/captcha.ts`, `auth/password.ts`                                                    | Server-only proof verification and password hashing                                                                     |
| `auth/account-email.ts`, `auth/account-email-action.ts`, `app/[locale]/email-actions.ts` | Account email issuance/delivery, safe action state, and request adapters                                                |
| `auth/account-token.ts`, `auth/account-token-store.ts`, `auth/account-link-query.ts`     | Token generation/hashing, transactional issuance/consumption, and strict URL query parsing                              |
| `auth/account-confirmation.ts`, `auth/password-recovery.ts`                              | Email confirmation and password-reset mutations                                                                         |
| `auth/email-rate-limit.ts`                                                               | PostgreSQL-backed per-address/purpose throttles and shared daily sending budget                                         |
| `email/`                                                                                 | Private configuration, bilingual templates, Brevo transport, and development-only capture                               |
| `storage/`                                                                               | Private storage configuration/adapters, image/XML validation, session-authorized file lifecycle, bounded HTTP ingestion |
| `app/api/files/`                                                                         | Nonlocalized upload, download, and deletion Route Handlers                                                              |
| `scripts/cleanup-files.ts`                                                               | Operator-run abandoned-upload and deletion cleanup                                                                      |
| `db/`                                                                                    | Schema, audit-column factory, pool factory, server-only database accessor                                               |
| `drizzle/`                                                                               | Ordered SQL migrations, schema snapshots, migration journal                                                             |
| `i18n/`, `messages/`, `proxy.ts`                                                         | Locale configuration, navigation, translations, negotiation                                                             |
| `styles/`, `app/globals.css`                                                             | Shared scales, theme palettes, semantic Tailwind utilities                                                              |
| `tests/`                                                                                 | Unit, live-database, HTTP, and browser checks                                                                           |

Database access and authentication effects stay on the server. Client code
receives localized labels and safe form state, never password hashes, database
credentials, or the CAPTCHA signing secret. The public Server Action constructs
its dependencies itself; clients cannot inject verification or cookie functions.

## 3. Routing and rendering

- `/en` and `/es` render the homepage; `/en/signup` and `/es/signup` render signup.
  The homepage hero includes a prominent localized Explore tracks link to the
  public explorer, available regardless of session state.
- `/en/settings` and `/es/settings` render account settings for authenticated users;
  guests redirect to the localized homepage. Settings metadata excludes indexing.
- `/en/confirm-email`, `/es/confirm-email`, `/en/reset-password`, and
  `/es/reset-password` inspect single-use account links. They do not require an
  existing session; the token supplies authority for the corresponding mutation.
  The proxy adds no-referrer, private/no-store, and noindex/nofollow headers.
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
fields/forms. Only first/last/display name, email, confirmation status, date of birth, and the
optional avatar file ID reach the settings client. Date of birth remains a date-only `YYYY-MM-DD` string and is
displayed in a read-only date input without timezone conversion.

## 4. Presentation and browser state

`components/ui/` contains the shadcn/ui Base UI Vega primitives used throughout
existing pages: buttons, inputs, fields, alerts, avatars, dialogs, dropdown menus,
and the theme switch. Forms retain React actions and existing server validation;
no client form-state library is introduced. Field errors are associated with inputs
via `aria-describedby`; a focused form-level alert owns error announcements.
CAPTCHA remains the ALTCHA widget, with colors mapped to Vega tokens. Ordinary
page structure and locale navigation retain semantic HTML. File inputs share a
semantic-border vertical divider between the native file chooser button and the
filename, including the avatar and Track upload pickers.

`app/globals.css` owns the neutral Vega light/dark colors and radius scale. Its
Tailwind dark variant follows `data-theme`, matching the existing provider rather
than introducing a second class-based theme. `styles/tokens.css` retains spacing,
typography and content width; `styles/themes.css` supplies the map
illustration palette and stable recorded-path overlay tokens. Components use semantic colors, including `foreground` for
body text and `primary` for actions. Global styles include visible keyboard focus
and reduced-motion handling. `components.json` configures the Base UI Vega preset
and Phosphor icons; generated icon imports must still follow the per-icon import
convention.

`next-themes` applies `data-theme` to the document and stores the preference under
`track-atlas-theme` in local storage; the default follows the system. The theme
control is a keyboard-accessible sun/moon switch: checked means dark, and clicking
saves the opposite of the resolved theme as an explicit light/dark preference.
It follows live system changes until an explicit preference is saved; there is no
system option in the control. It stays disabled until hydration, with CSS positioning
the active indicator from `data-theme` even before hydration. The pnpm
patch in `patches/next-themes@0.4.6.patch` retains the startup script for SSR and
hydration but prevents remounting it on client navigation. Preserve and recheck
this behavior when upgrading the dependency.

Icons use individual Phosphor imports appropriate to Server or Client Components.
All password fields use `components/password-input.tsx`: initially masked inputs
using shadcn `InputGroupInput` with a localized `InputGroupButton` inside an
inline-end `InputGroupAddon`, using Phosphor Eye/EyeClosed icons. The input group
owns the shared border, focus ring, and invalid styling; the visibility button
does not overlap the editable input.
Visibility is local to each field; toggling preserves the value, form attributes,
and validation associations without submitting the form. Disabled inputs (including
settings fieldsets) also disable their toggle. Reset forms clear passwords by name
so revealed fields are cleared too.
The signup form uses React `useActionState`, pending-submit feedback, field
errors, and a focused form-level alert after errors. ALTCHA loads after hydration,
uses a native checkbox and local Spanish translations, inherits theme colors,
and resets after an unsuccessful submission. JavaScript is required for signup
verification. `types/altcha.d.ts` covers the upstream Spanish JS/declaration
filename mismatch.

The header login trigger is disabled until hydration. Login and settings
confirmations compose shadcn `Dialog` and `DialogContent` directly from
`components/ui/dialog.tsx`, without an additional modal adapter. Base UI supplies
the portal, overlay, background isolation, scroll lock, focus trapping and
restoration. Callers select initial email/Cancel focus and final trigger focus,
and cancel all dismissal paths while pending. `DialogContent` provides shared
sizing, scroll bounds, and a localized Phosphor close button, disabled through
`closeButtonProps` during pending actions. Closing discards the form/password/proof. Pending login also
disables signup navigation. Unique input IDs and scoped widget lookups allow the
modal to coexist with signup. Confirmation dialogs restore their connected
trigger without scrolling. Destructive controls use Vega's `destructive` token.
Background signup status uses the implicit live-region semantics of `role=status`
without redundant `aria-live`: this avoids the dialog hide-others behavior
mutating individual streamed form descendants before they hydrate.

## 5. Signup flow and validation

1. The guest fills in first name, last name, email, date of birth, and password;
   display name is optional. Avatars are not collected.
2. The widget obtains and solves a challenge from `/api/altcha/challenge` and
   adds the `altcha` proof to the form.
3. The Server Action adapter in `app/[locale]/signup/actions.ts` delegates to
   `handleSignup`. It validates the locale, checks the current user, and returns
   validation errors before expensive registration work.
4. A valid proof is verified and atomically consumed before password hashing.
5. The adapter loads private email configuration and derives the rate-limit key.
   `registerUser` reserves the confirmation-request allowance before hashing, then
   creates the user, confirmation token, and initial session in one transaction.
   Failure of token/session creation rolls back the account insertion. A throttled
   email reservation does not prevent registration; it suppresses the initial send.
6. After commit, the adapter attempts confirmation delivery when allowed, then
   sets the session cookie and redirects to the localized homepage. Delivery
   failure does not undo registration. Email and cookie effects are outside the
   transaction; invalid email configuration before registration can still prevent
   account creation.

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
**Settings** followed by **Log out**. shadcn `DropdownMenu`/Base UI supplies keyboard
navigation, Escape/outside-click dismissal, positioning and focus handling. The
non-modal adapter in `components/user-menu.tsx` also closes on Tab (including from
portal focus guards); Shift+Tab returns to the trigger. Pending and failed logout
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

Avatar, profile, password, and deactivation are independent controls. The optional
avatar form uploads raw image bytes to the authenticated file endpoint. A successful
upload refreshes the settings server state without remounting other forms.
`next/image` uses `unoptimized` so the browser sends its session cookie directly
to `/api/avatars/:id`; no optimizer, crop, resize, or re-encoding touches the file.
The form displays the saved image, not an unsaved local preview. Its native
`image/*` picker uses the shadcn Input file-selector styling and a
Phosphor upload icon, and leaves no fixed-height image slot when empty. Upload
and removal are mutually exclusive operations with localized pending, success,
and error feedback. Removal calls the authorized DELETE endpoint, reports success
only after stored-byte removal, and retains a failed deletion target for retry
even after the server clears the avatar reference. A successful new upload clears
the old UI retry target; its deletion record remains queued for cleanup. Controls
stay disabled until the settings refresh reconciles the current avatar ID.
The metadata and visibility notice is not displayed. Avatar upload is not required for other settings mutations. Profile allows
required first/last names and optional display name, all trimmed and limited to
200 Unicode characters; blank display names become null. Email and date of birth
are displayed in disabled inputs with the shared disabled styling and are not
submitted by the form.
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

### Account email confirmation and recovery

`email/` owns private configuration, bilingual HTML/text generation, capture,
and a fixed-destination Brevo HTTP adapter. `auth/account-email.ts` issues links
and sends only after commit; `auth/account-email-action.ts` constructs safe action
states. `app/[locale]/email-actions.ts` supplies server-owned dependencies and
cookies. No public action can inject a transport or select another account for
resend. Signup atomically creates user, session and confirmation token; provider
failure does not undo registration or automatic sign-in. Unconfirmed users retain
access. Settings shows confirmed status as a green, localized inline-end badge
inside the disabled email input group, using a theme-aware semantic `success`
color. Unconfirmed accounts retain the separate status and resend feedback panel.

Recovery switches the shared login dialog to an email-only form. Valid addresses
receive identical feedback for nonexistent/inactive accounts, throttles, quota
exhaustion and provider failures. Configuration errors detected before lookup can
show uniform unavailable feedback. This does not guarantee equal timing. Login
and signup ALTCHA remain unchanged; recovery does not yet add CAPTCHA/IP limits.

`/[locale]/confirm-email` and `/[locale]/reset-password` read query authority under
request-time Suspense. GET only inspects; opening the confirmation page
automatically submits its validated token to the Server Action after hydration,
without a second user click. A per-token guard prevents duplicate mount effects.
Passive fetchers do not consume tokens, but scanners that execute JavaScript can
trigger confirmation. Pages/headers prevent indexing,
referrer disclosure and caching; route-scoped locale links preserve exactly one
valid token. Completed mutations remove tokens from visible URLs while retaining
mounted success state; no client success flag authorizes another mutation.

`auth/account-token-store.ts` generates purpose-bound random 32-byte base64url
tokens and persists only SHA-256 digests. Database time grants 24-hour confirmation
or one-hour reset lifetimes. New requests do not invalidate older links; consuming
one revokes other outstanding links of that purpose. Inspect before hashing, then
lock user before token and recheck active status, purpose, and expiry. Password
reset also rechecks the password hash against its preflight value. Atomic reset
changes the hash, consumes the link, invalidates remaining reset links and removes
every target-user session. It does not confirm email or
automatically sign in. Clear the request cookie after commit, including another
account's cookie, but preserve that unrelated account's database sessions. Cookie
or refresh failure never turns a committed reset into apparent rollback.

Settings password changes invalidate reset links while retaining their existing
current-session behavior. Deactivation invalidates both link purposes. Issuance
uses the same user-first locks and rejects a stale preflight password version.
Existing login's password recheck prevents stale-credential session creation.

`auth/email-rate-limit.ts` uses PostgreSQL-lowercased identity and HMAC-keyed per-email/purpose buckets,
60-second cooldown and three requests per rolling hour, including unknown
addresses. Separate short transactions finish before user locks; failed delivery
counts too. A serialized UTC-day bucket admits at most 250 provider attempts
across the app, with no refund/retry. This mitigates sending abuse but does not
prevent global budget exhaustion or deliberate throttling of a known address.

Brevo POSTs one recipient, application-rendered `htmlContent`/`textContent`, and
no provider template/contact synchronization. Credentials never enter clients.
The five-second timeout has no automatic retry; 201 plus a valid message ID means
accepted, not delivered. Names/HTML are escaped and template delimiters neutralized;
provider header names are bounded. Link origins come only from validated private
configuration, never Host/request redirect fields. Operators disable provider
tracking and redact token-route access-log queries; local framework logs/browser
traces may contain secrets and must stay private.

Nonproduction capture writes permission-restricted ignored files or a private
loopback sink. Production rejects capture and test-sink settings. Playwright owns
an isolated capture server on port 3100, `.next-e2e` build output, and a separate
ephemeral bearer-authenticated sink; it never exposes an application test inbox
or skips real token/session/CAPTCHA validation. Native fetch tests cover provider
outcomes without sending real messages. Configuration is listed in the [operations reference](docs/operations.md#2-configure-secrets-and-email);
retention, logging, and cleanup responsibilities are described in section 8.

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

| Table                   | Data and constraints                                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                 | Database-generated UUID; required first/last name, email, password hash, date of birth; nullable display name, legacy avatar URL and managed avatar-file FK; `active` defaults true; non-null `admin` and `emailConfirmed` default false |
| `sessions`              | UUID, user FK with delete cascade, unique token digest, timezone-aware expiry; user-ID index                                                                                                                                             |
| `captcha_uses`          | Challenge-signature digest primary key, timezone-aware expiry and expiry index                                                                                                                                                           |
| `account_action_tokens` | UUID/user FK, restricted purpose, unique secret digest, expiry/consumption/revocation timestamps and user/purpose/expiry indexes                                                                                                         |
| `email_send_limits`     | HMAC-address/purpose or UTC-day bucket key, bounded timestamp array, database-backed sending reservations                                                                                                                                |
| `stored_files`          | Server-generated UUID, owner FK with restricted deletion, purpose/status checks, explicit object key, storage-location fingerprint, bounded byte size, content type/hash, expiry/deletion timestamps and audit trigger                   |

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

| Migration                           | Change                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `0000_enable-postgis.sql`           | Enable PostGIS                                                                                 |
| `0001_add-users.sql`                | Users and shared modification-time trigger function                                            |
| `0002_add-sessions.sql`             | Sessions and audit trigger                                                                     |
| `0003_add-user-flags.sql`           | Admin/email-confirmation defaults, backfill, non-null constraints                              |
| `0004_add-captcha-uses.sql`         | Single-use proof tracking and audit trigger                                                    |
| `0005_add-account-email-tokens.sql` | Account action tokens and email sending buckets, constraints/indexes and both audit triggers   |
| `0006_add-stored-files.sql`         | Owned private files, lifecycle and metadata constraints, cleanup indexes and audit trigger     |
| `0007_add-original-avatars.sql`     | Optional avatar-file FK, original-image MIME types, explicit object keys and flat-key backfill |
| `0008_broaden-avatar-formats.sql`   | Broader canonical raster-image MIME constraint for avatar originals                            |

`getDb()` initializes a pool lazily, retaining it across development hot reloads
via `globalThis` and at module scope in production. The pool has a five-second
connection timeout and sanitized idle-connection error logging. Low-level
`createDatabase` supports tools/tests that own and close their connections.

Migrations run explicitly through Drizzle Kit, not at build or request time.
Applied migrations are immutable; commit new SQL and metadata together and
review trigger SQL that Drizzle Kit cannot infer. See the README for commands.

## 8. Runtime configuration and operations

### Private configuration

| Setting                                                                    | Runtime use                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                             | Server and migration connection string; required when accessing the database.                                                                                                                            |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`       | Local Compose initialization and host port; not a substitute for `DATABASE_URL`.                                                                                                                         |
| `ALTCHA_HMAC_SECRET`                                                       | Signup/login challenge signing; at least 32 characters after trimming, shared across instances.                                                                                                          |
| `EMAIL_RATE_LIMIT_SECRET`                                                  | HMAC key for address limiter identities; at least 32 bytes, shared across instances.                                                                                                                     |
| `FILE_STORAGE_BACKEND`, `FILE_STORAGE_LOCAL_DIR`                           | Local or B2 backend; private local directory defaults to `.data/uploads/` in development. Production requires explicit backend selection.                                                                |
| `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY` | Required for B2; validated regional HTTPS endpoint, private dedicated bucket and server-only credentials.                                                                                                |
| `APP_ORIGIN`                                                               | Trusted upload/deletion and account-link origin, never derived from the request Host; HTTPS required in production. Nonproduction defaults to `http://localhost:3000` and permits HTTP only on loopback. |
| `EMAIL_DELIVERY_MODE`                                                      | Defaults to `capture` outside production and `brevo` in production; production rejects capture.                                                                                                          |
| `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`                   | Required in Brevo mode; sender name is bounded to 70 Unicode characters with no CR/LF.                                                                                                                   |
| `EMAIL_CAPTURE_DIR`                                                        | Development capture directory; defaults to ignored `.superpowers/mail/`.                                                                                                                                 |

Compose reads `.env`; Next.js and Drizzle use Next's environment loader, with
development-mode precedence for local tooling. `.env.local` and
`.env.development.local` can override `.env`. Keep database credentials and ports
aligned across files. No secret belongs in a `NEXT_PUBLIC_` variable.
Rotating the CAPTCHA secret invalidates outstanding challenges; rotating the
email limiter secret resets address bucket identities, not the shared daily quota.

### Infrastructure and delivery

Local Compose runs only PostgreSQL 18 / PostGIS 3.6, with a health check,
localhost-only port, and persistent named volume. Next.js runs on the host.
Host clients connect to `localhost:<POSTGRES_PORT>`; Compose-network clients use
`db:5432`. Initialization credentials apply only to an empty volume. Stopping
Compose preserves data unless the volume is explicitly removed. The upstream
image documents amd64 support only; ARM requires another compatible image or
emulation. Major PostgreSQL upgrades require data migration, not just an image
change. The initial PostGIS migration requires a suitably privileged role.

Production deployment, backups, HTTPS, database network/TLS hardening,
least-privilege application roles, and scheduled maintenance are operator
responsibilities; this repository does not provision them.

Brevo requires a verified sender/domain and appropriate SPF/DKIM/DMARC records.
Disable transactional open and click tracking so secret-bearing URLs remain
direct. Other users of the same provider account can exhaust its quota even
when this app stays within its 250-attempt daily budget. There is no delivery
queue, automatic retry, or webhook service. Automated tests never send real
messages; manual live-send checks require explicit authorization, a development
database, and an address controlled by the tester.

### Sensitive data and maintenance

Redact query strings from access logs for both locales' `/confirm-email` and
`/reset-password` routes. Framework development logs and browser traces can also
contain live token URLs; keep them private. Do not add third-party analytics or
assets to account-token pages.

Local file capture creates a private directory and files (modes `0700`/`0600`)
and prunes older matching JSON files before each write to retain roughly 100
messages. Existing directory permissions are not repaired. Capture files contain
live account links and must not be shared or served publicly.

Expired sessions and CAPTCHA proofs are rejected without automatic row pruning.
Account tokens and email limiter rows also need periodic cleanup. For a
maintenance window outside active email rate-limit activity, the following SQL
removes unusable records without intentionally resetting current limit windows:

```sql
DELETE FROM captcha_uses WHERE expires_at < statement_timestamp();
DELETE FROM sessions WHERE expires_at < statement_timestamp();
DELETE FROM account_action_tokens
WHERE expires_at < clock_timestamp() OR consumed_at IS NOT NULL OR revoked_at IS NOT NULL;
DELETE FROM email_send_limits
WHERE (key LIKE 'address:%' AND updated_at < clock_timestamp() - interval '1 hour')
   OR (key LIKE 'daily:%' AND updated_at < date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
```

No scheduler for these statements is included. Coordinate limiter cleanup with
senders; deleting buckets during active requests can undermine their locking and
quota guarantees.

## 9. Verification and remaining boundaries

| Checks                    | Coverage                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test:db:unit`       | Configuration, lazy initialization, pool reuse, server-only imports                                                                                                                                                                                                                  |
| `pnpm test:auth`          | Validation, password hashing/capacity, cookie/CAPTCHA policy, auth/settings/email action orchestration and post-commit effects, account-token/query parsing, bilingual email templates, Brevo failure/timeout handling, capture authorization and harness guards                     |
| `pnpm test:storage`       | Image/XML validation, bounded body reads, local permissions/traversal/atomic publication, B2 signed wire requests and version-aware deletion against loopback                                                                                                                        |
| `pnpm test:storage:db`    | Owned uploads/downloads/deletion, authorization rechecks, failed and uncertain commits, quotas, cleanup, integrity and database constraints/audit time                                                                                                                               |
| `pnpm test:db`            | Migrations/constraints/audit triggers, session lifecycle, signup/login/settings, CAPTCHA replay, account-token expiry/purpose/rollback/concurrent consumption, reset/invalidation/login races, Unicode email identity, address and daily limits including lock-wait clock boundaries |
| `pnpm test`               | HTTP rendering, metadata, localization, account-email route protections; requires a running server                                                                                                                                                                                   |
| `pnpm test:e2e`           | Chromium UI, themes/locales, signup/login/logout/settings, dialog accessibility and scroll behavior, real CAPTCHA and replay rejection, automatic email confirmation, capture-only recovery and session revocation, mobile email flows, cookies and rendering diagnostics            |
| Lint / TypeScript / build | Static checks and production compilation                                                                                                                                                                                                                                             |

Live checks require a migrated development database, never production. The
limiter clock tests create/drop isolated schemas and require `CREATE SCHEMA`
privileges. Their clock override is test-only; runtime code and production
migrations expose no clock or verification bypass. Tests use rollback where
possible, otherwise uniquely named fixtures and scoped cleanup. Browser signup
cases run sequentially within their file to respect the hashing guard; CAPTCHA
tests solve real challenges rather than using a production verification bypass.
HTTP tests use `http://localhost:3000` unless `TEST_BASE_URL` is set. For browser
tests, `TEST_BASE_URL` selects an existing capture-configured server and requires
compatible private capture metadata via `EMAIL_TEST_METADATA` before any test
mutation. Without that override, Playwright starts its own development server at
`http://127.0.0.1:3100` with `.next-e2e` output, rather than reusing the normal
server. `next.config.ts` allows the loopback development origin explicitly.

`tests/helpers/email-test-server.ts` starts a separate ephemeral loopback sink
with a bearer secret and private metadata under `/tmp/opencode`. It supplies
capture-only configuration and an ephemeral local upload directory to the child
app. `tests/e2e/files.spec.ts` exercises real browser uploads, private downloads,
CSRF rejection and deletion; it skips external servers to avoid touching
uncontrolled storage. `EMAIL_TEST_SINK_URL` and
`EMAIL_TEST_SINK_TOKEN` are harness-only settings rejected in production; they
are not public routes or verification bypasses. Browser tests verify harness
compatibility and authorization before creating fixtures.

There is no OAuth, standalone global logout,
email editing, account reactivation, or hard-deletion UI. Stored privilege flags do not constitute
an implemented admin authorization system. Duplicate-email feedback exposes
registration status. Distributed rate limiting, broader abuse review, automated
expiry cleanup, and production operational hardening remain outstanding before
a public production rollout.

## 10. File uploads

`POST /api/files?purpose=avatar|gpx` accepts a raw request body from an active
session. POST and DELETE require an exact trusted `APP_ORIGIN`; cross-site Fetch
Metadata is rejected and no cross-origin access is enabled. Owner identity comes
only from the session. Foreign and missing file IDs both return 404. Responses
exclude storage paths, bucket names, credentials, and object keys other than the
opaque file ID. This API has no localized UI or human-readable error messages.

`storage/validation.ts` owns purpose policies. Avatar input accepts raster images
recognized by `file-type` and fully decodable by the installed Sharp build.
Canonical MIME types come from file bytes, not request headers. The picker has no
client-side format allowlist. GIF, AVIF, and TIFF are verified alongside JPEG,
PNG, and WebP; additional decoder-supported raster formats use the same boundary.
Browser preview support can differ from server decoding support.
Inputs remain limited to 5 MiB, 16,777,216 decoded pixels, and one frame, with a
ten-second Sharp processing timeout. The exact original bytes, format, orientation, and metadata are retained.
`storage/avatar-versions.ts` then uses Sharp synchronously to generate 128×128 and
24×24 WebP versions at quality 80. Both correct EXIF orientation before a center
square crop, enlarge small inputs to the exact output size, preserve transparency,
and strip embedded metadata. Each encoding retains the input-pixel and ten-second
timeout bounds and is capped at 64 KiB. Originals can contain sensitive embedded
metadata such as GPS coordinates. SVG and animation are rejected.
GPX accepts UTF-8 XML up to 10 MiB, with a GPX root and matching 1.0 or 1.1
namespace/version. SAX parsing rejects malformed XML, DTDs, entity declarations,
processing instructions, non-UTF-8 declarations, depth over 64, and more than
500,000 elements. This is envelope validation, not full GPX schema validation or
track extraction. Uploaded GPX bytes, including any location metadata, remain
unchanged and private.

The request reader checks declared and actual sizes, cancels oversized streams,
and has a 30-second body deadline. The server buffers only bounded bodies.
Downloads also enforce stored byte count and SHA-256 integrity before returning
an attachment with `private, no-store`, `nosniff`, and sandbox headers.
`GET /api/avatars/:id` applies the same ownership and integrity checks but serves
only derived WebP bytes inline: 128px by default or explicit `?size=128`, and
24px for `?size=24`. Unknown parameters, duplicate sizes, and unsupported sizes
are rejected. GPX and legacy avatars without versions cannot be served through
that route; there is never an original-image fallback. Settings uses 128px and
the top-bar menu uses 24px through shadcn AvatarImage. Settings uses unoptimized
`next/image` inside AvatarImage; both send owner cookies directly to the private
endpoint rather than delegating to a shared image optimizer. Profile/session
reads omit legacy images from display while preserving the Settings removal
reference. Existing avatars require reupload; no backfill or on-read processing
exists. The generic attachment endpoint still downloads original bytes.
Generic avatar/file APIs remain owner-only. Track-authorized derived avatar delivery is described below. No presigned links, range responses, or browser-to-bucket transfers exist.

The lifecycle is `pending` → `ready` → `deleting`. Reserving a pending row locks
the active user before the session, rechecks authorization, and atomically applies
limits of 100 file records, 250 MiB, and two pending uploads per account. Pending
rows reserve their purpose's maximum size plus two 64 KiB version allowances for
avatars; ready avatar rows count the measured original and both version sizes.
Deletion records continue counting until cleanup removes them. Object writes run
outside database transactions. Finalization locks and rechecks authorization and
reservation expiry before marking ready. A failure only abandons pending rows,
so an uncertain commit cannot trigger deletion of an already-ready object.
Avatar publication waits for the original and both versions to be stored.
Finalization records each version's byte size and SHA-256 in nullable columns
on the existing file row, atomically with the original metadata; a constraint
requires either all four version fields or none, with bounded sizes and valid
hashes for avatar-purpose rows. Legacy rows retain null version fields.
Avatar finalization also sets the authenticated user's nullable `avatar_file_id`
and marks the previous avatar for cleanup in that same transaction. Failed uploads
leave the previous avatar unchanged. Generic file deletion clears a matching
current-avatar reference transactionally. The FK uses `ON DELETE SET NULL`; the
unused legacy `avatar_url` field is not an avatar source or mutation input.

Database time gives pending rows 15 minutes. Cleanup marks expired reservations
for deletion and repeatedly removes their objects. Avatar deletion always attempts
the original and both deterministic version keys, including for pending records
whose version metadata was never committed. Failures in one removal do not prevent
attempts on the others; the record remains retryable until all succeed. Deletion records last at
least 24 hours to catch late writes and uncertain storage outcomes. The cleanup
command processes fixed-size pages, isolates per-object failures, and reports
counts without sensitive details. Users cannot be hard-deleted while file
records still identify stored bytes. No automatic scheduler is installed.

Local storage uses a private `0700` root, `0600` files, exclusive temporary writes,
and atomic no-overwrite publication. File and directory synchronization precedes
successful publication; canonical directory paths preserve storage identity across
ancestor symlink changes. Local storage requires filesystem support for hard
links and directory synchronization. Temporary filenames derive from file IDs,
so cleanup also removes interrupted local writes. Only canonical server-generated
UUID keys and exactly `avatars/{original,128,24}/<UUID>` keys are accepted. Nested avatar
directories also require `0700` permissions and cannot be symlinks. Root/object symlinks and public/build storage locations
are rejected. The application user must control the directory and its ancestors;
hostile writers with local filesystem access are outside this boundary.

B2 uses the AWS S3 SDK with a validated regional HTTPS endpoint, private bucket,
server-only credentials, bounded reads, two maximum attempts, and 30-second
operation deadlines. UUID keys are never reused. Removal lists and permanently
deletes exact-key object versions and delete markers, including paginated results.
Object Lock or insufficient key permissions cause retryable cleanup failures.
The operator must keep the bucket private; the application does not provision it.

Each row stores its explicit object key and a SHA-256 fingerprint of its backend
and target directory or bucket. New avatar keys are `avatars/original/<file-id>`, `avatars/128/<file-id>`,
and `avatars/24/<file-id>` on both local storage and B2; GPX keys remain flat file IDs. Migration backfills
existing object keys to their flat IDs without moving bytes. Older normalized
WebP files remain readable, but their pre-normalization originals cannot be recovered. Credential rotation preserves this identity. Changing storage targets
fails closed for existing files and requires a separate migration. Simultaneous
reads from multiple configured backends are not implemented.

Account quotas are not distributed request-rate or global resource limits.
Operators must bound request rate, concurrent connections, aggregate body sizes,
and image-processing load at the deployment boundary. Validation does not provide
malware scanning. Tests use real local files, a migrated development database,
and a loopback S3 protocol server; live B2 compatibility still needs an authorized
bucket smoke test before production use.

## 11. Tracks and public publication

`tracks/validation.ts` owns allowlisted metadata and the shared activity catalog.
Names/descriptions are trimmed plain text (200/5,000 Unicode code points); tags
are optional (0–10, up to 30 Unicode code points each) and
retain trimmed display spelling/order and deduplicate with NFKC plus
locale-independent lowercasing. Difficulty is uploader-selected 1–5. Visibility defaults
private; only explicit `private`/`public` values are accepted. Ownership/status
are never taken from the caller. Public selection warns that the unchanged
original exposes timestamps, author metadata, waypoints and extra locations,
plus the current uploader identity and avatar, even if not mapped. Both languages use
shared fields and radio groups. `activity-grid.tsx` presents the 16 activities as
single-select tiles in two columns on small screens and four from the `sm`
breakpoint. Each tile places a regular-weight Phosphor icon above its localized
name; terrain/snow badges distinguish related activities. Icons are decorative,
with labeled radios, arrow-key navigation, focus rings and selection checkmarks.
The form remains disabled until hydration, retains browser-held
input on recoverable errors, and focuses committed error summaries. Confirmed
successful uploads clear all draft fields, the file selection, tag/error messages,
and the request identity before navigating to details; visibility returns to
private. Returning through client navigation or browser history starts fresh,
even when Cache Components preserves the upload page.

The locale-aware upload page and UUID details page isolate request authentication
behind connection/Suspense boundaries. Generic static metadata never contains a
private Track name. Language navigation also has an outer Suspense boundary:
unknown Track IDs prevent resolving usePathname at prerender time. Details expose
metadata and full-data metric summaries, with lazy map/chart visualizations.
Collection navigation is provided by the explorer; editing and deletion remain
unimplemented.

`tracks/service.ts` is the public creation/read/download boundary. Active,
confirmed eligibility is checked before reading/processing and rechecked under
user-before-session locks at publication for both visibility choices. The central
read query requires an active owner and ready same-owner GPX original, plus either
public visibility or a valid owner session. Guests, foreign and expired/revoked
sessions can read public Tracks, but not private ones. Missing, foreign-private
and inactive-owner resources are indistinguishable. Details, geometry, chart
samples, originals and track-scoped avatars all use this contract. Deactivation
hides every resource on subsequent requests without deleting Track data. No shared auth
cache or raw storage URLs are used. The details DTO excludes source keys/hashes,
email and full surname by default. Identity is read afresh: current display name,
else first name plus surname initial. Details include an initials fallback and
`GET /api/tracks/:id/avatar`, serving only the current derived 128px WebP.
That endpoint checks same-owner avatar purpose, readiness, storage location,
size/SHA-256 and current-avatar association; it rechecks association and Track
access after storage reads. Absent, legacy, replaced or removed images never
fall back to originals. Storage faults fail closed and the UI retains initials.
No client-selected file ID or size is accepted, and generic file/avatar routes
remain owner-only. All Track HTTP responses use private/no-store; localized
details additionally receive no-referrer/noindex headers from the proxy. No shared
image optimizer or auth cache serves these resources. Data/download routes use private/no-store and
nosniff; originals additionally use attachment and sandbox headers and retain
byte-count/SHA-256 integrity checks.

`POST /api/tracks` uses exact trusted Origin and Fetch Metadata checks, bounded
multipart ingestion (11 MiB total, 10 MiB GPX) and a 30-second body deadline.
Unknown/duplicate fields, non-allowlisted visibility and invalid metadata are rejected.
Visibility participates in the payload fingerprint, so changing it cannot reuse a
previous request identity. Private requests retain the pre-publication canonical
metadata shape (visibility omitted), preserving retries of existing attempts;
public requests include explicit visibility and cannot match private attempts.
A stable UUID request ID is bound to owner plus canonical metadata/file digest;
concurrent retries cannot create duplicates, mismatched reuse is rejected, and a
lost acknowledgement can recover the committed Track. This is request idempotency,
not global GPX deduplication: intentional new requests may reuse a file.

Parsing and WGS84 calculations run in a bounded Node worker. The plain CJS engine
is shared by pure known-answer tests and native execution; Next/Turbopack can
bundle the worker and its imports. Binary input is nested inside a workerData
object because Turbopack merges forwarded globals into the top-level envelope.
The worker interrupts synchronous CPU work after ten seconds, has V8 old/young/
stack bounds of 128/16/4 MiB, and admits two workers per application process.
V8 bounds are not an absolute RSS limit; upstream and host resource controls are
still required. Native worker assets/dependencies are explicitly traced; dev and
production uploads must be checked when changing packaging or framework versions.

GPX accepts UTF-8 1.0/1.1 with existing hostile-XML limits, exactly one track and
one segment, up to 100,000 positions and at least two distinct positions with
positive recorded length. Reject routes/multiple segments rather than inventing
connections. Preserve all coordinates/order and original bytes; ignore metadata,
waypoints/extensions for derivation and never fetch embedded URLs. Loops/repeats
are valid. GeographicLib supplies WGS84 distances and edge interpolation for the
five variants with 0/1/3/4/5 equal-recorded-distance intermediate points.
Directionless edges are flagged rather than assigned fake bearings.

Full geometry is a PostGIS SRID-4326 LineString. Ordered JSONB samples record
cumulative distance, optional elevation and usable interval-average speed.
Recorded duration includes stops and requires complete increasing timestamps with
usable timezones; missing/bad timing creates unavailable duration and speed gaps.
Ascent/descent sum raw elevation deltas only for complete elevation; partial
min/max and samples carry coverage via sample count. No smoothing, moving-time
inference, zero-fill or external elevation enrichment is applied.

Details expose the persisted duration, ascent/descent, min/max elevation and
sample coverage through the existing authorized details DTO. The details page
has a 1,152px maximum width and orders content as title/download, main statistics,
map, elevation chart, interval-average speed chart, description, optional tags,
and secondary metadata (including uploader identity). The uploader block displays
the existing 128px avatar version at its native size, with larger name text and
wrapping for narrow screens; initials retain the same footprint when unavailable. The five main statistics
are length, difficulty, elevation range, ascent and descent: one row from the
`lg` breakpoint, wrapping on smaller screens. Elevation range is computed from
persisted maximum minus minimum, not cumulative ascent; partial coverage is
marked beside the value and explained above the elevation chart. Absent values
remain unavailable, not zero. Empty tag sections are omitted and description
text stays within a readable measure. Metric/map explanations use keyboard-
accessible native disclosures, while missing-data and failure notices stay
visible. Additional metadata retains visibility, upload date, point count,
elevation extrema and recorded duration. Server-rendered
English/Spanish summaries distinguish null (unavailable) from zero and explicitly
label absent/partial elevation coverage. Distance uses metres below one kilometre
and kilometres otherwise; elevation uses metres. Recorded duration uses localized
elapsed hours/minutes/seconds, not a timezone-dependent Date, and includes stops.
The UI explains completeness requirements and raw, unsmoothed GPS noise.
`getTrackSamples` applies the same centralized access query but selects only
samples, not the large GeoJSON geometry. A separate Suspense boundary streams
chart preparation independently of metadata/downloads. The server maps elevation
and interval speed to cumulative-distance series and converts speed from m/s to
km/h. Each speed is a constant over its preceding interval, including zero for
stops; every speed-change boundary is retained to avoid inventing ramps across
omitted intervals. Consecutive exactly equal speeds (or missing intervals) can
be coalesced without changing their constant value or gap extent. Elevation uses a display-only min/max envelope, retaining bucket
endpoints, extrema separately within each uninterrupted run, and both sides of
every gap. The target is roughly 1,600 values, but fragmented recordings may
exceed it. Both charts render at most 1,600 values at once using overlapping,
keyboard/touch-navigable sections; all full-data metrics and persisted samples
remain unchanged. Chart payload size still scales with input fragmentation and
speed interval count, bounded by the 100,000-point ingestion limit.

shadcn Chart with pinned Recharts 3.8.0 loads lazily behind a client error boundary.
Charts have keyboard tooltips with localized live-region announcements, axis
labels/units, visible focus, theme tokens and no animation. Gaps are never
connected or zero-filled; isolated samples remain visible. Missing data has
explicit states, and chart-library failures offer reload without hiding metadata
or original downloads. Only chart distances/values are serialized, not full
geometry, account data, or GPX extension telemetry. No external chart requests
or additional credentials are required.

A local Chromium development performance gate covers complete and alternating-
elevation-gap 100,000-point recordings. One complete-data run measured a 13.82 MB
decoded details document, 3.31 seconds to rendered charts, 68 ms keyboard tooltip
interaction, a 62.8 MB JS heap snapshot, and 173 SVG descendants. The fragmented
case measured a 5.47 MB document, 2.05 seconds to charts, 424 ms section navigation,
and 886 SVG descendants (800 isolated samples). These are local observations,
not device/network guarantees; speed-rich pages can transfer large payloads even
though per-section rendering is bounded. Tests attach benchmark artifacts and
assert bounded SVG cardinality and sub-two-second interaction on the test host.
Playwright defaults to two browser workers to avoid oversubscribing processing
and concurrent development compilation. Track tests also run sequentially within
their file. Chart section controls and keyboard interactions remain disabled
until hydration so a large streamed payload cannot silently discard early input.
Automated email delivery stays capture-only.

### Interactive original-point map

`components/track-map.tsx` isolates dynamic browser-only rendering behind a client
error boundary. The MapLibre/react-map-gl chunk and package CSS load locally;
MapLibre's bundled worker uses a blob URL, verified with Turbopack. The pinned
pair is MapLibre GL JS 5.24.0 / react-map-gl 8.1.3 (v8's MapLibre entry point
supports MapLibre v4+). Renderer teardown removes per-map GL/source resources;
MapLibre retains a bounded shared worker for its global RTL dispatcher. Client-navigation tests observe
per-map release messages and verify that the worker pool does not grow. Activity
hide cleanup clears private geometry/loading state synchronously and detaches the
context-loss listener before deliberate teardown; returning reauthorizes geometry.
Changing theme does not replace the map or resubmit its geometry.

The renderer fetches existing `GET /api/tracks/:id/data` at request time with
same-origin credentials and no-store. This retains the centralized ready-file,
active-owner and visibility/owner-session policy; no private geometry is prefetched in a public
shell. The browser validates finite/bounded coordinates, uses every original
position/order/repetition in its GeoJSON source with source tolerance zero, and
never requests Directional representations. A display-only nearest-world-copy
longitude adjustment keeps dateline crossings local; persisted geometry and
original downloads are unchanged. Mercator clips polar latitudes beyond 85.05°;
a localized notice explains this without changing the source latitudes.

The default **Outdoors** basemap uses an independently authored vector style
from `tracks/outdoor-style.ts`. A native selector with a screen-reader-only **Basemap** label also
offers **Street**, using OpenFreeMap's hosted Liberty style, and **Topographic**, the
restored OpenTopoMap raster style in `tracks/topographic-style.ts`. Outdoors uses OpenFreeMap's `/planet` TileJSON and fonts, with a distinct `outdoor`
source ID for error isolation. Its curated layers emphasize wood/grass/water,
protected-area boundaries, cased brown tracks/paths with different dash patterns,
peaks with available elevations, places and named outdoor POIs. Roads and buildings
are subdued. Names prefer the route's English/Spanish locale and fall back to
local/Latin names. No sprites or external icons are used. All three basemaps are
2D in both UI themes; Outdoors does not include contours or hillshade.
Topographic uses 256px HTTPS raster tiles with baked-in trails, contours, shaded
relief and labels (native zoom 1–17), under a distinct `topographic` source ID.
Neither raster relief nor basemap labels change recorded elevations or analytics.
Mapbox Satellite is an optional basemap enabled only when `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured. It uses Mapbox Satellite TileJSON with `secure=true` through MapLibre's raster source, preserving provider-supplied attribution and requesting HTTPS tile templates. The `satellite` source ID matches the selector value so active-source errors are not mistaken for stale errors. Satellite imagery and 3D terrain do not change recorded elevations or analytics.
Source features and availability are limited to the provider's published schema
and per-zoom contents (currently native maxzoom 14). Styling cannot invent missing
OSM features or establish access rights, route membership or difficulty. Peak-label
elevations are basemap context, never recorded-track samples or analytics. Basemap changes use the renderer's
React style binding, not a map remount or imperative style replacement; camera,
markers and full-geometry overlays survive. Selection is local to the map and
resets to Outdoors on route hide/recreation, not a persisted account preference.
Only the selected style's sources are active, with no bulk/offline downloading.
Street/Outdoors retain source-supplied OpenFreeMap/OpenMapTiles/OpenStreetMap
linked credits; Topographic retains linked OpenStreetMap, SRTM/Viewfinderpanoramas,
Sonny, OpenTopoMap and CC BY-SA 3.0 credits, including on mobile and fullscreen.
Both providers have no SLA. OpenTopoMap permits embedding but is volunteer-hosted
with limited capacity and variable regional completeness; contact maintainers
before material public traffic. No backup-server substitution is performed.
OpenTopoMap is contacted only when Topographic is selected; Mapbox is contacted only when Satellite is selected. Distinct text start/end markers combine for closed loops.
Semantic-theme shadcn controls with Phosphor icons provide 44px zoom/fit/fullscreen
buttons. Plain mouse-wheel zoom is enabled without Ctrl/Cmd; wheel capture and
bubble handlers temporarily disable and restore MapLibre's cooperative gesture
gate using its public API, so two-finger touch panning remains protected even on
hybrid devices. Rotation is disabled, and keyboard focus can leave the canvas.
Attribution links inherit semantic foreground color in both themes. Browser tile/style/glyph/sprite
requests disclose IP/viewed area, but omit referrers and carry no GPX, track
metadata or account data. No embedded GPX URLs are fetched. The provider has no
SLA, and can have missing point-of-interest sprite warnings independently of
successful basemap rendering.

Geometry requests have a 20-second abort deadline, initial map loading a
25-second deadline. Data/library/worker/WebGL/initial-provider failures show
localized reload guidance inside the map section; metadata, charts and original
downloads remain independent. Outdoors/Topographic/Satellite tile failures or a 25-second
style-switch timeout instead keep the map, recorded path and selector mounted
with a visible localized alert: choose Street to recover, or switch away/back to
retry. Late errors from a removed optional source do not fail Street or the other
optional basemap. Switching
back to Street retains the existing general map failure behavior if Street itself
fails. No server/provider keys, remote JS/CSS, public storage URLs or database
changes are needed. Deployment CSP must permit blob workers and OpenFreeMap asset
connections plus `https://tile.opentopomap.org` for Topographic and `https://api.mapbox.com`, `https://a.tiles.mapbox.com`, `https://b.tiles.mapbox.com` for Satellite. See the [map deployment notes](docs/operations.md#track-maps).

Browser tests substitute deterministic external provider assets, not the renderer
or worker. They observe source coordinates at the actual browser-worker boundary,
check section order, responsive statistics, partial/absent elevation range,
keyboard disclosures, plain-wheel zoom without page scrolling, real CDP one-
and two-finger touch gestures, endpoints, attribution/fullscreen, loops/repeats, high-latitude
and dateline bounds, both languages/themes and mobile/desktop, plus locale-aware
client navigation away/back and to a different Track. HTTP tests retain
full original coordinates and indistinguishable guest/foreign/expired/revoked/
inactive denial. Street/Outdoors/Topographic tests also check keyboard selection,
absence of optional-provider requests
before selection, camera/geometry stability, complete attribution, theme and
fullscreen behavior, tile failure/retry, switch timeout and late-cancellation
recovery across both optional layers. Topographic uses a deterministic raster
fixture and style-spec validation. Outdoors assets use an invented vector-tile fixture (no real geographic
data) and empty glyph sets; unit tests validate the style and evaluate localized
labels and feature filters using the pinned MapLibre style-spec dev dependency.
Font-failure coverage also verifies the pinned renderer's local glyph fallback
keeps the map usable. An opt-in live-provider check renders all three styles,
including real Outdoors vector tiles/fonts and OpenTopoMap raster tiles in a
synthetic Pyrenees track scene. No provider
receives GPX data.
A local 100,000-point run measured a 11.08 MB decoded geometry+samples response,
5.85 seconds from navigation to map/source inspection, 180 ms zoom+fit, and a
101.4 MB main-thread JS heap snapshot (including charts and test instrumentation;
not GPU/worker memory or a total RSS bound). The details document was 13.83 MB.
These are host-specific observations, not low-end-device guarantees. The test
asserts all 100,000 worker-source coordinates and sub-two-second controls, without
reducing the source to sampled variants.

New tables are tracks, track_data, track_tags, track_directional_representations
and track_upload_attempts. All have audit columns/update triggers; geometry/tag
indexes, metric/value/coverage checks and unique file/request/variant keys enforce
meaningful invariants. Deferred publication triggers require owned ready GPX,
complete data, five variants, contiguous tags when supplied and a matching committed
attempt result. Attached source metadata is immutable; the generic file deletion
service rejects attachment before object removal, with database guards as defense
in depth. Migrations 0010/0011 add these tables and publication constraints;
migration 0013 permits publication with zero tags without relaxing other checks.

`storage/quota.ts` centralizes account usage and capacity checks for both file
and Track reservations, including avatar-version byte accounting. Callers hold
the owner row lock in the reservation transaction, preserving shared quotas
across both entry points.

Creation reserves storage under existing account quotas, derives/writes outside
long database transactions, then atomically publishes the ready file plus Track,
data, tags, variants and result. Pending attempts are fenced by their current
file reservation and expiry. Failure abandons only still-pending files; a failed
COMMIT acknowledgement cannot remove an already-ready original. Expired pending
files follow existing repeated cleanup/late-write protection, with attempt rows
removed by file cleanup cascades; ready attached originals are protected.

Track verification adds pure parser/metadata/execution tests, real PostgreSQL/
private-object-store/HTTP tests (including lost-COMMIT acknowledgement, stale
attempts, SQL constraints/audit and upper-limit publication), and localized browser
flows for validation, retry retention, eligibility, access and original integrity.
The real HTTP browser probe catches worker/bundler regressions missed by native
unit tests. Public publication verification includes the guest/owner/foreign/session access
matrix, current derived-avatar replacement/removal/integrity, unchanged downloads,
private-default versus explicit public upload and warning, live identity refresh,
and deactivation hiding in both languages/themes and desktop/mobile. Migration
0012 permits only private/public visibility while retaining the existing classification
constraints; no storage publicity or account/session mutations were introduced.

## 12. Track explorer

Public exploration is available at `/[locale]/tracks`; collections at
`/[locale]/users/[id]/tracks`. The shared header links to exploration and the user
menu links My tracks to the session owner's collection. Uploader links lead to
their collection. Collection routes resolve missing/inactive owners behind a
request-time Suspense/connection boundary; metadata remains generic. The proxy
applies private-page cache, referrer and indexing protections to these routes.

`components/track-explorer.tsx` coordinates metadata requests, selection, geometry
statuses, retry, pagination and stable ten-slot color/number assignment. Query
typing is debounced by 300ms. Other controls flush pending text and compose against
the latest URL, cancelling the old debounce so rapid actions retain all criteria.
Flushing a changed normalized search resets pagination even when a stale page
control triggered the flush; unchanged normalized text still permits pagination.
Search and filter controls accept interaction after hydration attaches their
handlers, including while metadata is loading. Filter controls retain their
subtree across query and metadata updates: unrelated changes preserve focused
numeric drafts. Each numeric field resets only when its own committed URL value
changes; each slider resets for its own values or authorized scope bounds.
Base UI/shadcn sliders commit on release and numeric inputs commit on blur or
Enter. Distance controls use 0.1 km steps and elevation
uses metres. Result lengths always use localized kilometres, retaining significant
digits for short nonzero tracks; detail formatting is unchanged. Matching counts
use localized plurals. Search, filter choices and page are canonical URL state
with browser Back/refresh support; locale switches preserve that query. Result changes clear
selection and reset list scroll. Sliders use authorized scope bounds, independent
of the current filters, with the uppermost position meaning unlimited.

The explorer uses a single compact toolbar below the shared full-width header,
with a fixed-width search field and search icon, a multiple-selection activity
select with the same activity icons/badges as the upload form, difficulty toggles,
and separate distance/elevation popovers containing
sliders and numeric limits. Filters are directly accessible without an overall
collapsible panel. Below the large breakpoint, the toolbar shows only the search field and a
Filters button. It opens a modal Base UI bottom drawer with vertically arranged
controls and inline range sliders/inputs. The drawer traps focus, supports swipe,
Escape and close-button dismissal, returns focus to its trigger, and closes on
resize to desktop. Filter changes continue to update URL state immediately.
Desktop controls scroll horizontally when needed instead of wrapping. Page titles
remain available to assistive technology without a visible heading row. Collection identity appears in the sidebar. The desktop explorer
fills the remaining viewport with a scrollable sidebar and map. Mobile starts
with the list and offers a List/Map switch immediately below the toolbar. Track titles open details; selecting an
entry highlights it. Compact entries place the uploader avatar at the top right,
replace activity text with the shared activity icon, and keep difficulty/length
on one metadata row. Avatar/activity names open on hover or keyboard focus and
on tap, with Escape/outside dismissal; the uploader popup links to the collection.
Hover/focus temporarily highlights its path, while a map
selection reveals/focuses the corresponding entry, switching mobile to the list.
Counts and numbered pagination remain usable when geometry or basemap requests
fail. Individual paths expose loading, failure and retry states. Empty collections
are distinguished from filtered results with no matches. Owner views alone show
All/Public/Private controls and private badges.

Superseded metadata requests are aborted and ignored. Client snapshots are cleared
when Next Activity hides the page; returning reauthorizes before showing results.
Session-keyed remounts discard private state after login/logout refresh. No private
metadata or geometry is included in the public prerendered shell.

`components/explore-map.tsx` loads a separate multi-track renderer through a client
error boundary. Geometry requests have independent deadlines, abort/retry, and
generation checks. Current paths are aligned to a stable common longitude world
copy as they arrive; Mercator clipping is disclosed for polar tracks. Result
changes fit the page until the user manually moves the camera; hover/selection
never refits. Basemap choice persists across result changes. The renderer reuses
the existing basemap styles, linked attribution and no-referrer provider requests.
Numbered keyboard markers and an overlap chooser select tracks; selected paths
gain an outline and width, while list entries share ten semantic color tokens.
WebGL failures leave result browsing available. The original-point details map
is unchanged.

Explorer verification includes parser/map helper tests, authorized database/HTTP
tests, real database-backed browser access and logout/return checks, localized
filter/pagination/list interactions, and an isolated map-component browser fixture
with real WebGL/workers and deterministic provider/geometry responses. The maximum
geometry case exercises ten tracks of 100,000 recorded points without changing
the persisted full paths or their samples.

### Server queries and display data

`tracks/explore-types.ts` defines browser-safe explorer payloads.
`tracks/explore-query.ts` parses and canonically serializes text, repeated activity
and difficulty choices, kilometre distance limits, metre elevation-range limits,
owner visibility, and page. Invalid, duplicate scalar, or unknown parameters are
rejected. `ownerId` is an API-only collection scope, not a shared filter.

`GET /api/tracks/explore` searches public tracks; `ownerId` selects an active
account's uploaded collection. Only that account's current session expands its
collection to private tracks. Other viewers ignore the visibility selector.
Missing or inactive collection accounts return 404. Collection and uploader
identities contain only the user ID, displayed identity (display name or first
name plus surname initial), and a derived-avatar URL when available.

The server uses one parameterized PostgreSQL statement for authorization,
collection identity, scope bounds/counts, matching counts, and the current page.
Ready GPX originals and active accounts are required. Search words must each
occur as literal, case- and accent-insensitive substrings in the title or a tag;
descriptions are excluded. The `unaccent` extension is required by migration
`0014_explorer-search`; stored tag identity is unchanged. Choices within one
category are alternatives, while categories intersect. Numeric comparisons use
unrounded stored values and inclusive limits. An elevation-range maximum
requires complete elevation coverage. Bounds are computed before every filter,
including visibility, from authorized tracks only; empty bounds are zero.
Pages contain at most ten tracks ordered by upload time descending, then UUID
descending. Requested pages clamp to the last valid page (one for no matches).

`GET /api/tracks/[id]/explore-geometry` authorizes geometry within the same SQL
read. It returns only a LineString, with Douglas–Peucker display simplification
starting at 0.00001 coordinate degrees (roughly one metre latitude). Tolerance
doubles on successive simplified paths until at most 2,048 vertices remain.
Longitude sequences are unwrapped before simplification, then long simplified
edges are subdivided before wrapping back to canonical longitudes, preserving
world traversal and dateline bends. Endpoints and collapsed lines are retained. This bounds a ten-track page's
transfer without altering recorded details, samples, directional search
representations, or GPX originals. The tolerance is for display, not distance
measurement or geographic search.

`GET /api/users/[id]/avatar` serves an active collection owner's current 128px
WebP derivative even when the collection has no public tracks. It never accepts
a file identifier or serves the original. Owned ready-file association, storage
location, byte length and checksum are verified, and the association is checked
again after storage reads. Metadata and geometry do not require configured
object storage. All explorer API success and error responses use private/no-store
and nosniff headers. No request-specific explorer data enters shared caches.

# Account email confirmation and password recovery

Status: approved by the user on 2026-10-16, including the delivery tradeoff,
explicit confirmation action, and sending limits. Execution is recorded in the
companion implementation plan.
An independent builder check found no important unresolved questions. This
document describes new behavior, not the current system.

## Intent and agreed scope

Use Brevo's HTTP transactional email API to help Track Atlas users confirm their
email address after signup and recover forgotten passwords. The application owns
and renders HTML, subject lines, and plain-text equivalents; do not use SMTP or
Brevo-hosted templates. Email delivery and all credentials stay server-side.

Agreed with the user:

- Signup sends a confirmation email, but unconfirmed users can log in and use
  the application immediately. Keep the existing automatic signup sign-in.
- Settings shows email-confirmation status and a resend button when unconfirmed.
- The login modal has a Forgot password link and email-entry recovery view.
- Reset requests show the same response for existing and nonexistent accounts.
- Reset links open a localized new-password/confirmation page. Successful resets
  revoke every session, do not automatically sign in, and offer login afterward.
- Confirmation links are single-use and expire after 24 hours; reset links are
  single-use and expire after 1 hour. Sending and resending are rate-limited.
- English/Spanish mockups of settings, recovery, reset, and both emails are approved.

Not in scope: email editing, enforcing confirmation as an access requirement,
marketing emails/contact synchronization, OAuth, account reactivation, provider
webhooks, a delivery dashboard, or general login/signup distributed rate limiting.

## Existing architecture to preserve

The application uses Next.js 16.4/React 19 with Cache Components, PostgreSQL and
Drizzle, native-dialog shared Modal, next-intl, and purpose-bound ALTCHA for signup
and login. `users.emailConfirmed` already exists and defaults false. Do not
backfill existing users as confirmed or change their current access.

Read request cookies and token query parameters inside request-time Suspense
boundaries following the installed Next.js guides. No session/token-dependent
output enters shared caches. Continue using `getDb()` in application adapters,
allowlisted validation, database clocks, shared theme tokens, individual Phosphor
imports, and locale-aware navigation. Preserve existing CAPTCHA proof consumption
before hashing and the two-operation scrypt concurrency guard.

## Proposed implementation choices

The following are builder recommendations, not separately stated user requirements:

1. Use native server `fetch` against `https://api.brevo.com/v3/smtp/email`; no
   provider SDK or email-rendering dependency is necessary for two small templates.
   Generate escaped HTML and plain text with pure, testable template functions.
2. Send one recipient per request using `to`, `sender`, `subject`, `htmlContent`,
   and `textContent`. The supplied batch guide documents the same endpoint, but
   these user-triggered messages do not need batching. Never combine users in a
   message, or mix outer `to` with `messageVersions`.
3. Send after database commit with a bounded five-second provider timeout, before
   the server action finishes. Do not start detached background promises or send
   while holding database locks. No worker, queue, or scheduled delivery service
   is added in this first version. A send failure never rolls back a completed
   signup; settings provides recovery through resend. There are no automatic
   delivery retries; users request another message after cooldown. A timeout is
   an unknown outcome, not proof that an email was not accepted.
4. Use 60 seconds between requests and at most 3 requests in a rolling hour per
   normalized email and purpose. Use a database-backed limiter shared by instances,
   not process memory or client timers. Also cap actual provider attempts at 250
   per UTC day across both purposes, reserving room under Brevo's 300/day free
   allowance. This cap is local to this application; messages sent elsewhere in
   the Brevo account can still exhaust its quota.
5. A reset does not implicitly mark the email confirmed. Password recovery and
   confirmation remain distinct purposes. Changing a password, either in settings
   or via recovery, invalidates all outstanding reset links. Deactivation
   invalidates both kinds of links in the same transaction.

The no-worker choice trades automatic retry for lower deployment complexity.
Provider acceptance is not guaranteed inbox delivery. Production monitoring and
resend UX must not say otherwise. Database state survives request crashes; a
crash before sending may leave a valid but undelivered token until expiry.

## UI and routes

### Signup and settings

After signup's user/session transaction commits, attempt the confirmation send in
the signup locale and retain the existing sign-in and homepage redirect. Signup
does not become an apparent failed registration when Brevo is unavailable. The
settings page remains the place for confirmation state, recovery, and resend.

Extend the safe settings profile projection with `emailConfirmed` only. Beside
the read-only email, show Confirmed or Not confirmed. Unconfirmed state explains
that access remains available and has an independent resend control, not a
profile-form submit. Confirmed state has no resend control. A successful resend
reports a request/acceptance, never confirmed delivery; server errors have safe
retry feedback. Show a server-derived remaining cooldown and disable the button
while pending. A client countdown is helpful feedback, not authorization.

### Confirmation: `/[locale]/confirm-email`

Follow-up user instruction supersedes the original two-step confirmation design:
clicking the email link is the confirmation action; do not ask for another click.
Email links contain a secret token and the sending locale. GET validates the link
without consuming it; the mounted page automatically submits the token to the
Server Action after hydration and shows progress followed by the result. POST
atomically consumes it and marks only its associated active account confirmed.
Passive fetchers do not mutate state, but email scanners executing JavaScript may
trigger confirmation; the removed button no longer provides that protection.
No login is needed, and a session for a different account is neither
switched nor mutated. Show success and a settings link for the matching signed-in
user, or a homepage/login path for guests and other users. Reuse of a consumed,
expired, revoked, or malformed link shows safe no-longer-valid feedback. A fresh,
unconsumed link for an already-confirmed active account may show Already confirmed
without another mutation. Settings reflects confirmation after navigation/refresh;
there is no background cross-tab synchronization.

### Recovery in the login modal

Forgot password switches the same Modal to an email-entry view, with Back to log
in. Preserve only the bounded email across that transition, never the password or
CAPTCHA proof. Closing unmounts everything. Focus moves to the new heading or
email input, and return focus, Escape/backdrop behavior, and pending dismissal
protection remain intact. Existing login ALTCHA is unchanged.

For a syntactically valid email, always respond: If an active account exists for
that address, we'll send a password-reset link. Use the same response for missing,
inactive, throttled, quota-exhausted, and provider-failed accounts. Invalid email
format has ordinary localized field feedback; infrastructure failures before any
account lookup may show a uniform unavailable response. This avoids explicit
account-existence disclosure, not a promise of identical timing. Do not expose
provider errors, account IDs, confirmation status, tokens, or passwords in state.

### Reset: `/[locale]/reset-password`

The link opens a dedicated page that validates the token read-only and presents
new password and confirm new password. Apply the same nonempty/1,024 UTF-8-byte
bounds and matching-field rules as settings, with visible danger styling and
associated accessible errors. A reset link is the authority; no active login,
current password, or second confirmation modal is required. POST is the only
operation that changes credentials or consumes a reset token.

Success shows Password updated and explains that all devices are signed out.
Offer a Log in button opening the shared login modal on this page, without
introducing a general arbitrary-return-url feature. Clear the current request's
session cookie after commit, even if it belonged to another account; that other
account's database sessions are not revoked. Cookie-clear failure must still
report the committed reset, never invite repeating the password mutation.

Expired, used, revoked, malformed, or inactive-account tokens show one safe
no-longer-valid message and a Request a new link button opening recovery. A
validation error must not echo a password, and stale-token failure must not leak
whether an account exists. Keep explicit post-commit success locally so a rerender
cannot turn it into an apparent failure just because the consumed token is invalid.

### Link privacy

Token pages use noindex/nofollow metadata, `Referrer-Policy: no-referrer`, and
noncached request-specific output. Do not add analytics or external assets to
these pages. Configure Brevo to disable open/click tracking for these messages
(verify the supported account/API setting), preserving direct links. Tokens must
not enter application logs or error payloads. Deployment access logs must redact
these routes' query strings. Clear the secret from the visible URL after a
completed mutation; retain only a nonsensitive success state for display. Locale
switching must deliberately preserve an unconsumed token, without broadening
general-purpose navigation to accept arbitrary URLs.

## Token and transaction model

Add a purpose-bound `account_action_tokens` table:

- Database-generated UUID, user FK with delete cascade.
- Purpose restricted to email confirmation or password reset.
- Unique SHA-256 token digest; a freshly generated 32-byte base64url token exists
  only in the outgoing URL and request memory, not persistent plaintext.
- Timezone-aware expiry, optional consumed/revoked timestamp, and indexes for
  user/purpose and expiry. Derive expiry from database time, not browser clocks.
- Fresh `auditColumns()` and a migration-installed `set_updated_at()` trigger.

New sends do not revoke older unconsumed links automatically: requesting another
reset must not let an attacker continually invalidate a victim's earlier email.
Several links may therefore coexist, bounded by issuance limits and expiry.
Consuming one confirmation link marks the account confirmed and invalidates its
remaining confirmation tokens atomically. Consuming one reset link writes the
new password hash, deletes all that user's sessions, and invalidates every reset
token atomically. Other-purpose tokens are unaffected except on deactivation.

Keep user-row-first lock ordering, followed by session/token rows consistently.
Resolve a token to a candidate account with a safe preflight query, validate its
purpose/expiry/active state before expensive hashing, then hash outside locks.
In the transaction, lock the user first and recheck active status, token ownership,
purpose, unconsumed/unrevoked status, and database-clock expiry while locking the
token. Expiry may pass during hashing or lock waits; the final check decides.
Two consumers race to one successful commit; failures roll back password,
confirmation, token consumption, and session revocation together.

Settings password changes revoke reset tokens in their existing locked mutation;
deactivation revokes both purposes. Reset issuance, confirmation issuance,
consumption, and existing login/settings mutations must use compatible lock
ordering so an in-flight issuance cannot mint a usable token after invalidation.
Existing login's locked password-hash recheck prevents stale-password session
creation after a reset. Test both directions of these races.

Registration should create the initial confirmation token atomically with user
and session, accepting the validated signup locale through server-owned
orchestration. A token-insert failure rolls back the whole registration; only
external delivery failure is nonfatal. Never pass the token into browser action
state. Resend authorizes the current cookie inside a transaction, just like other
settings mutations; clients cannot supply a target email or user ID.

## Rate limits and abuse boundary

Add PostgreSQL-backed email-send throttles with audit fields/triggers. Store a
keyed HMAC of the normalized email with a separate private rate-limit key rather
than plaintext addresses in the throttle table. Use the same trim/case-insensitive
identity rule as login; do not invent provider-specific dot/plus normalization.
Reserve the email/purpose cooldown and hourly allowance atomically for valid
requests before looking up an account, including unknown/inactive addresses.
Count failed delivery attempts too; parallel processes cannot exceed the limits.
The initial signup email counts toward confirmation limits. Claim the application
daily provider budget atomically immediately before each actual provider call.
Budget exhaustion never consumes a link or mutates credentials.

Throttle state and token creation must have a documented transaction/lock order;
the implementer may choose atomic bucket counters or bounded event rows with a
serialized key lock. A missing secret or limiter storage failure fails closed
for sending, not password authorization or access to existing accounts. Validate
required email configuration before accepting registrations in environments that
enable this feature; already-committed registrations survive provider outages.

The first version deliberately does not trust arbitrary forwarded IP headers or
add a new CAPTCHA to recovery. Per-address and global budgets limit email volume,
but are not full bot protection: an attacker may exhaust the global budget or
throttle a known address, and provider work may leave an account timing signal.
Before a public launch, review trusted client-IP handling, reset CAPTCHA or edge
rate limits, and monitoring. These limitations must be documented, not described
as complete enumeration or denial-of-service protection.

## Email content and server configuration

Templates follow the approved simple Track Atlas green/cream visual treatment,
with inline email-compatible CSS, readable mobile layout, system fonts, a clear
button, copyable fallback URL, expiry explanation, and unexpected-message advice.
Email rendering stays light with no dependency on app theme or remote assets.
English and Spanish content and subjects live in the two message dictionaries;
use the request locale, not a new persisted user-language preference.

Escape user names, text and URL attributes appropriately; never interpolate user
HTML or treat account text as a template expression. Generate link destinations
only from a validated configured application origin, an allowlisted locale,
known route and cryptographic token. Do not derive them from Host/forwarded
headers or client-supplied redirects. Production origin must use HTTPS; allow
HTTP loopback for local development only.

Private configuration:

- `BREVO_API_KEY`: restricted provider sending key.
- `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME`: configured sender, authenticated
  in Brevo before live sending; example values are not real credentials.
- `APP_ORIGIN`: trusted application origin for links.
- `EMAIL_RATE_LIMIT_SECRET`: at least 32 random bytes, consistent across instances.
- A safe local delivery mode and test sink, detailed below.

Never use `NEXT_PUBLIC_` for any email configuration or print secrets/token URLs.
The fetch adapter has a fixed provider destination and timeout, bounds and
sanitizes error handling, and records only nonsensitive outcomes/provider IDs
when useful. Do not log response bodies or recipients. A 2xx with the expected
message ID means accepted, not delivered; malformed responses fail safely.

## Development, tests, and operational behavior

Do not require real Brevo sends in automatic tests. Provide an explicit
development/test capture transport restricted to nonproduction and a private
loopback test sink owned by the test runner; the default nonproduction mode
captures rather than sending to fixture addresses. No public email/token inbox
route or production authentication bypass is allowed. Any persisted test sink
data is ignored, scoped to the current run, and cleaned up. Reject capture mode
in production. Transport injection occurs in testable server orchestration,
never through public action arguments. Real configuration and token validation
paths remain exercised rather than bypassed.

Verify the Brevo adapter using controlled mocked HTTP outcomes, including
timeout/429/5xx/malformed success, with no real credentials. Manual live sending
is a separate explicit operator check after domain and sender verification,
using only an authorized test recipient and a development account/database.

Add periodic-cleanup documentation for expired/revoked/consumed token rows and
old limiter rows; no scheduler or worker is introduced. Retain enough limiter
history to enforce the complete active windows, including the UTC daily cap.
Preserve applied migrations; generate and review new SQL, metadata, FKs,
constraints, indexes, and audit triggers. Update ARCHITECTURE.md for implemented
boundaries and README.md/.env.example for sending modes, private configuration,
provider quota/tracking setup, and cleanup/verification commands.

Verification must include:

- Unit: escaped localized templates, trusted origin, bounded validation, provider
  headers/payloads/timeout/failure privacy, token generation/digest, orchestration,
  generic reset response, no password/token action-state leaks, cookie failures.
- Database: token purpose/expiry/replay/concurrent consumption, rollback, inactive
  accounts, limiter races across clients, all-session reset revocation, settings
  password/deactivation invalidation, login/issuance/consumption lock races,
  initial signup transaction, and audit triggers/defaults for every new table.
- Browser: signup capture and confirmation including explicit POST, settings
  states/resend/pending/cooldown, guest and other-user confirmation, actual modal
  recovery navigation/focus/dismissal, generic unknown/inactive/throttled requests,
  expired/used/malformed links, password mismatch/bounds, reset on another browser,
  session revocation and no auto-login, locale switching with a live token,
  English/Spanish, mobile layouts, both themes and hydration diagnostics.
- Existing signup/login CAPTCHA and all settings regressions remain passing.
  Run `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm test:auth`,
  `pnpm test:db:unit`, `pnpm test:db`, `pnpm test`, and `pnpm test:e2e` using only
  a migrated development database.

## Approval and next step

The visual and technical designs are approved. Write and review the implementation
plan before building. Work directly on master as required
by AGENTS.md; do not create a branch/worktree. Commit/push implementation only
when requested; retain this design as the agreed planning reference.

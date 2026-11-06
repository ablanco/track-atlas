# Authentication and account settings

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Signup flow and validation

1. The guest fills in first name, last name, email, date of birth, and password;
   display name is optional. Avatars are not collected. Birthday entry uses
   month/day/year in English and day/month/year in all other supported languages, independently of the
   browser language. The client converts this date-only text to `YYYY-MM-DD`
   before calling the action and formats returned values back into the selected
   language. Calendar, future-date and adult-age validation remains server-side.
2. The widget obtains and solves a challenge from `/api/altcha/challenge` and
   adds the `altcha` proof to the form.
3. The Server Action adapter in `app/[locale]/signup/actions.ts` delegates to
   `handleSignup`. It validates the locale, checks the current user, and returns
   validation errors before expensive registration work.
4. A valid proof is verified and atomically consumed before password hashing.
5. The adapter loads private email configuration and derives the rate-limit key.
   `registerUser` reserves the confirmation-request allowance before hashing, then
   creates the user, immutable legal acceptance evidence, confirmation token, and
   initial session in one transaction. Failure of evidence/token/session creation
   rolls back the account insertion. A throttled
   email reservation does not prevent registration; it suppresses the initial send.
6. After commit, the adapter attempts confirmation delivery when allowed, then
   sets the session cookie and redirects to the localized homepage, or upload when
   the allowlisted upload intent is present. Delivery
   failure does not undo registration. Email and cookie effects are outside the
   transaction; invalid email configuration before registration can still prevent
   account creation.

`scripts/make-admin.ts` is an operator-only CLI (`pnpm users:make-admin <email>`)
that sets an existing account's `admin` flag using a parameterized, case-insensitive
email match. It uses `getDb()`, closes its pool on completion, and returns a nonzero
exit code for invalid arguments, missing accounts, or database failures. It changes
only the admin flag (with the database trigger refreshing `updated_at`), preserving
active status, email confirmation, credentials, and sessions. Repeating a promotion
succeeds. There is no public endpoint for this operation.

The parser accepts only known account fields; supplied privilege flags are not
inserted. Duplicate fields and file values are rejected for known inputs.
Names/email are trimmed, names/display name allow 200 Unicode characters, and
email allows 254 characters with basic format validation. Birthdays are calendar
dates from year 0001 through today in UTC. Signup additionally requires a calendar
age of at least 18 and explicit acceptance of the current exact legal revisions;
see [adult signup and evidence](legal-and-erasure.md#adult-signup-and-account-legal-evidence).
Passwords preserve spaces, must be nonempty, and are bounded to 1,024 UTF-8 bytes.
Signup, password reset and settings password changes require a `zxcvbn-ts` score
of at least 3 (out of 4). The browser and server independently apply the same
policy; submitted scores are ignored. Structural bounds are checked before
scoring, and weak passwords are rejected before hashing or account mutations.
Signup rejection also precedes CAPTCHA consumption. Login retains its existing
bounds without strength enforcement, so existing credentials continue to work.

`auth/password-strength.ts` lazy-loads one estimator configured with common,
English, Spanish, French, Portuguese, German and Italian dictionaries, keyboard
graphs and application-name context. This fixed configuration is independent of
the interface locale and uses no external password service. The complete bounded
password is scored and hashed without trimming or truncation. The browser loads
the estimator only after password entry or validation and debounces meter updates;
stale async results are ignored. Signup, reset and settings use the shared shadcn
Base UI Progress meter with translated strength labels and passphrase/password
manager guidance in all six languages. Text and accessible value descriptions
accompany semantic success/destructive colors. Empty, checking, over-limit and
unavailable states never claim that a password passed. Browser submission checks
use the shared policy independently of the displayed meter; server actions always
recompute strength before forwarding validated credentials to services.

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
Validation bounds are the same as signup's email/password bounds; login does not
enforce new-password strength. Only bounded email and error codes return to the client; passwords/proofs reset after errors.

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
the header and current page eligibility. The client retains the URL and explicitly
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
uses the same strength policy, nonempty/1,024-UTF-8-byte bounds and bounded scrypt
hasher as signup.
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
no global logout button, reactivation UI, or self-service hard deletion.
Deactivation retains data and the reserved email; permanent removal uses the
[staff erasure runbook](../account-erasure.md). The last active administrator
cannot deactivate their account; the check shares the administrative advisory
lock with account administration and erasure.

## Authentication and bot protection

### Account email confirmation and recovery

`email/` owns private configuration, localized HTML/text generation for all six supported languages, capture,
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
outcomes without sending real messages. Configuration is listed in the [operations reference](../operations.md#2-configure-secrets-and-email);
retention, logging, and cleanup responsibilities are described in the
[runtime reference](runtime.md#sensitive-data-and-maintenance).

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
and checks database-clock expiry and `users.active = true`. The safe identity contains `userId`, `firstName`, `lastName`, `displayName`,
`admin`, and a ready derived-avatar file ID. Feature lookup through
`findSessionUser` also requires current legal acceptance; `findSessionIdentity`
allows pending identities for chrome/logout and renewal. Administrative services
recheck the current identity and admin flag on each call; client menu visibility
is not authorization. Sessions survive
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

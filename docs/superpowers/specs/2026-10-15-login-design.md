# Login modal and logout design

Status: approved by the user on 2026-10-15, including the authenticated signup
notice instead of redirect. The approved modal's close control must use
Phosphor's `XIcon` rather than text. Builder review: nothing important left.

## Intent and agreed experience

- Guests have a **Log in** button in the shared top bar.
- It opens a modal containing email, password, ALTCHA, a submit button, and a
  link to the localized signup page for people without an account.
- Successful login closes the modal, stays on the same page, and changes the
  top-bar control to **Log out**.
- The user approved the visual mockup, with one correction: replace the text
  close control with Phosphor `XIcon`.
- Reuse the current Next.js/React/PostgreSQL stack, sessions, theme tokens,
  English/Spanish localization, and self-hosted ALTCHA. No new UI or auth library.

## Proposed UI details (builder choices)

The action appears beside the existing language/theme controls, allowing wrapping
on narrow screens. Use the approved centered modal with a dimmed background,
single-column form, and full-width submit button. Use a native `dialog` opened
with `showModal()` for focus containment and inert background content. The icon
button imports `XIcon` from `@phosphor-icons/react/dist/csr/X`, regular weight,
with a localized accessible label; the icon itself is decorative.

Opening focuses email. Escape, backdrop click, and the X button dismiss the
modal when not submitting, restoring focus to the opener. Do not allow dismissal
while submission is pending, so late responses cannot mutate a newly reopened
form. Disable duplicate submissions and announce progress. Opening a fresh modal
mounts fresh form/widget state. Dismissing discards the password and proof.

Use `autocomplete="username"` for email and `autocomplete="current-password"`
for password. Failures keep the modal open, retain only the bounded email value,
clear password, reset ALTCHA, and focus a localized alert. Link to signup closes
the modal and navigates normally. No forgot-password, remember-me, or signup
modal is added. Login inherits the existing fixed 30-day session lifetime.

Logout is a direct POST Server Action, not a link or GET request, with pending
and failure feedback. It revokes only the current browser's session, clears its
cookie, stays on the same page, and restores **Log in**. Other devices/sessions
remain signed in. No confirmation modal or CAPTCHA for logout.

## Request-time header and navigation

Add a request-time header auth component beneath Suspense rather than making
the public layout shell depend on cookies. It reads the current session and
supplies an explicit signed-in/guest state and localized labels to the client
control. During lookup show a neutral loading placeholder, not a false login
or logout action. On lookup failure show a localized unavailable/retry state.

Login/logout return structured action state, with no redirect or client-supplied
return URL. Re-render/refresh server-backed auth state in place, preserving the
pathname, query string, hash, and scroll. The homepage signup link must update
along with the header. Session/cookie changes use the installed Next.js APIs;
read relevant installed guides before implementation, particularly action
re-rendering and Cache Components. Do not place identity in a shared cache.

Proposed adjustment to preserve the same-page requirement on `/[locale]/signup`:
replace the page's current authenticated-visitor redirect with a localized
already-signed-in notice and homepage link, never the guest registration form.
The signup Server Action still refuses authenticated registration. This avoids
logging in from signup unexpectedly navigating home. Signup success itself still
redirects home as before. Update existing redirect tests to match this deliberate
page-policy change.

## Server validation and authentication

Separate the Next.js adapters from testable orchestration, following signup's
dependency-injection structure. Public actions supply their own database,
verification, cookie, and current-user effects; clients cannot supply them.

Login validates the locale and exactly one string email/password field. Email
is trimmed, bounded to 254 characters, and format-checked consistently with
signup. Password is nonempty, untrimmed, and bounded to 1,024 UTF-8 bytes. Ignore
unknown privilege fields; reject duplicate/file values for known fields. Only
email/error codes are returned in action state, never passwords or session tokens.

After validation, verify and atomically consume a login-purpose ALTCHA proof
before password verification. Then query by case-insensitive email using the
database's `lower(email)` convention. Return the same invalid-credentials message
for nonexistent users, incorrect passwords, inactive accounts, and unsupported
stored password hashes; never expose which check failed. Infrastructure failures
return a generic unavailable message. `emailConfirmed=false` does not block login:
email verification is still unimplemented.

Add strict verification for the current `$scrypt$v=1$N=32768,r=8,p=3$...`
encoding. Accept only exact supported parameters and canonical salt/key lengths;
never let stored or request-provided arbitrary parameters drive resource usage.
Derive asynchronously and compare equal-length results with `timingSafeEqual`.
Creation and verification share the existing maximum of two concurrent scrypt
operations per process, without an unbounded queue. For nonexistent accounts or
unusable stored hashes, run the same bounded dummy scrypt verification after
valid CAPTCHA rather than taking an obvious no-hash fast path. Inactive users
also receive equivalent password work before rejection. This reduces a simple
timing signal, not a guarantee of identical end-to-end timing or rate limiting.

On a valid password, create a new opaque session with the existing cookie policy.
In a transaction, recheck/lock the user's active state before session creation;
reject accounts disabled during verification. If the request had an existing
session token, revoke that session in the same transaction as creating the new
one (session rotation). Never accept a session identifier from form fields.
After commit, set the new cookie. Cookie failure returns unavailable; a created
but undelivered session remains inaccessible and expires normally.

Logout reads the token only from the HttpOnly request cookie, validates its shape,
and deletes only its digest row. Missing/malformed/expired/already-revoked tokens
are idempotent guest success with cookie clearing. If database deletion fails
for a well-formed token, return unavailable without claiming revocation or
clearing the only token needed for a retry. Existing server-side active/expiry
checks continue to authorize every session lookup.

## Reuse ALTCHA without cross-purpose proofs

Generalize internal challenge issuance/parsing/verification to accept a closed
`signup | login` purpose while retaining the current signup wrapper/API behavior.
Keep `/api/altcha/challenge` issuing signup challenges by default; add a dedicated
`/api/altcha/login/challenge` endpoint for login-purpose challenges. The widget
accepts a challenge URL prop with the existing signup URL as its default.

Both purposes use the same private `ALTCHA_HMAC_SECRET`, five-minute expiry,
SHA-256 workload, payload/parameter bounds, no-store response, local assets,
privacy settings, and atomic shared `captcha_uses` unique-insert tracking.
A signup proof cannot authorize login and vice versa. Consumption happens before
password work and is not rolled back after bad credentials or busy hashing;
each failed attempt requires fresh verification. No schema/migration or new
environment variable is needed. No production test bypasses.

## Scope limits and security constraints

- No password reset, email verification, OAuth, account settings, global logout,
  password-policy change, or new track features.
- No new public GET mutation route. Use framework Server Action same-origin
  protections; do not disable them or add unsafe return-URL redirects.
- Never log credentials, signing secrets, raw session tokens, or SQL error objects.
- ALTCHA and per-process hash limits do not replace distributed rate limiting.
  Keep the existing production-readiness caveat; rate limiting is a separate task.
- No authentication or identity state in browser local storage. Server-backed
  session state is authoritative; do not claim continuous cross-tab synchronization.
- Do not add schema migrations unless implementation identifies a real schema
  requirement; all existing models/audit rules remain unchanged.

## Verification and documentation

Use test-first implementation for validation, strict password verification,
shared hashing capacity, action ordering and errors, logout, and CAPTCHA purpose
separation. Database tests cover case-insensitive login, correct/incorrect
credentials, inactive/unconfirmed users, session rotation/current-only revocation,
transaction failure, and concurrent one-use proof acceptance.

Browser tests use real ALTCHA and cover English/Spanish login/logout, same-page
pathname/query/hash preservation, correct header/homepage state, XIcon close,
Escape/backdrop/focus handling, signup link, mobile layouts, themes, validation,
tampered submissions, proof reset/replay, cookie attributes, and signup-page
authenticated notice. Keep form selectors scoped when signup and modal coexist.
Verify both development and production rendering for Cache Components diagnostics.

Run relevant test suites plus lint, TypeScript, production build, and diff checks.
Update `ARCHITECTURE.md` and `README.md` to describe implemented login/logout and
the adjusted authenticated signup-page policy, removing obsolete absence claims.
Update contributor guidance only where new rules are needed. Do not commit/push
implementation without a new request; design/plan workflow commits are separate
from permission to publish application code.

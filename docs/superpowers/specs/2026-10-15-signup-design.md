# Signup Design

Status: approved by the user on 2026-10-15 after the builder check found no
important unanswered questions. Technical defaults below were proposed by the
author and accepted with approval of this document.

## Intent and confirmed requirements

Introduce working account creation, rather than a form-only placeholder. A new
visitor can open a standalone signup URL, provide account details, and become
signed in. Successful signup returns to the homepage; a different destination
can be introduced later.

Confirmed by the user:

- The page is for visitors who are not logged in.
- Show all user-entered model fields, clearly distinguishing required fields.
- Exclude avatars for now. Password strength rules and CAPTCHA come later.
- Automatically log the user in after account creation and return home.
- Use visual option A: an open form, with first/last name side by side on desktop
  and stacked on mobile, not a contained card.
- Add a signup link to the homepage.

## Scope and non-goals

This is a multi-part feature: localized UI, server validation, password hashing,
transactional account/session creation, request-time session lookup, a database
migration, and security/behavior tests. Build on Next.js 16.4, next-intl,
Drizzle, and PostgreSQL already in the repository; work on `master`.

Not included: login page, sign-out UI, password reset, email verification, OAuth,
avatar upload, profiles, account settings, age eligibility policies, password
strength policy or strength meter, CAPTCHA, or a broader homepage redesign.
The homepage must not imply that track discovery or uploads now work.

Anti-goals: plaintext or fast-hashed passwords, trusting client validation,
allowing a signed-in visitor to create another account via a direct submission,
publicly cached auth state, leaking credentials or dates of birth in responses,
and introducing unrelated account features.

## Page and navigation

Author's proposed defaults:

- Routes: `/en/signup` and `/es/signup`, consistent with locale-prefixed routing.
  `/signup` follows existing locale negotiation and redirects accordingly.
- Keep existing site branding, colors, typography, theme switcher, and language
  controls. Provide English and Spanish text and light/dark styling.
- Names share a row at an appropriate desktop breakpoint; every other field is
  full width in a compact centered form. All fields stack on mobile.
- Heading: “Create your account”. Explain “Fields marked * are required.”
- Order: first name, last name, display name, email, date of birth, password.
- First name, last name, email, date of birth, password: marked `*` and `required`.
  Display name: explicitly marked optional. Use one password field, no confirmation
  field or additional signup steps.
- Use semantic labels, suitable input types/autocomplete, visible focus, accessible
  field errors, a form-level error announcement, and a pending submit state.
- During submission, disable the submit control and show a localized creating
  account label. Server protections still handle repeated/racing submissions.
- Preserve non-secret form values on errors. Do not return/repopulate the password
  from server state; users may have to enter it again after a failed submission.
- Place a localized “Create account” link in the homepage hero for signed-out
  visitors only. Do not add a new account menu or welcome panel in this step.
- Replace homepage statements that account creation is unavailable with accurate
  wording; keep discovery and uploads described as planned.
- Existing header discovery/how links must point to homepage sections when viewed
  from signup. Language switching on signup stays on signup, never serializes
  entered values to the URL, and can discard unsaved input.
- A valid session redirects signup visitors to their locale's homepage without
  showing a usable signup form. Both the page and submission enforce this.
- Malformed, expired, unknown, deleted-user, or inactive-user sessions do not
  authenticate a visitor. A stale cookie must not prevent creating a new account.

## Validation and failure behavior

Author's proposed defaults:

- Validate all allowlisted fields server-side; use native HTML validation for
  immediate feedback without relying on it for security. Reject non-string and
  repeated values for expected form fields. Never accept `active`, identifiers,
  avatar URLs, timestamps, hashes, or session details from form input.
- Trim names/display name/email. Names must remain nonblank. Blank display name
  becomes null. Preserve user-entered email case in storage; the existing database
  index enforces case-insensitive uniqueness. Validate ordinary email syntax.
- Bounds: names/display name at most 200 characters, email at most 254 characters,
  password at most 1,024 UTF-8 bytes. These are input/resource limits, not strength
  rules. Document and enforce them consistently in UI where representable and on
  the server. Show a localized password-too-long error for the byte limit.
- Password is required and otherwise unchanged: do not trim, normalize, impose a
  minimum length beyond nonempty, or require particular character classes.
- Date of birth must be a real `YYYY-MM-DD` calendar date from year 0001 through
  today (UTC). Reject impossible dates and future dates, without an age threshold
  or converting the stored date to a JavaScript instant.
- Duplicate email, including a different-case duplicate or an inactive account:
  show a localized email-field error, create no session, and leave that account
  untouched. The unique index is the final concurrency safeguard.
- Invalid data creates no account/session. Unexpected database/hash failures show
  a generic localized retry error, never SQL, credentials, stack traces, or hashes.
- Explicit duplicate-email feedback is a deliberate initial UX choice: it exposes
  whether an address is registered; email ownership verification is not included.

## Password storage

Author's proposed choice: built-in asynchronous Node.js `crypto.scrypt`, rather
than adding a full authentication framework to this initial local-signup feature.
Use a fresh cryptographically random salt of at least 16 bytes for every hash,
and a versioned encoded hash containing parameters, salt, and derived key. Use
`N=32768`, `r=8`, `p=3`, a 64-byte key, and an explicit adequate `maxmem` (at least
64 MiB). Do not block the event loop with synchronous hashing.

Treat passwords as opaque input; different salts must produce different stored
hashes for the same password. Never log plaintext, echo it into action state, or
send hashes to the client. Hash before opening the write transaction to avoid
holding database connections/transactions during the expensive operation.

Limit concurrent hashes per process, rejecting excess requests with a generic
retry response instead of accumulating an unbounded expensive work queue. This
is a resource guard, not a substitute for distributed abuse protection. CAPTCHA,
distributed rate limiting, and an external identity provider remain outside this
step. Public production rollout needs a separate abuse-protection review.

## Session foundation and persistence

Author's proposed choice: opaque, revocable database-backed sessions rather than
JWTs or storing user profile data in the cookie. This supports the requested
automatic login and immediate rejection of disabled users without new secrets
or an auth-framework schema migration.

- Generate a random 32-byte session token, encode safely for cookies, and store
  only its SHA-256 digest in a new `sessions` table.
- Table: database-generated UUID primary key, required `userId` foreign key to
  `users` with cascade delete, unique required `tokenHash`, required timezone-aware
  `expiresAt`, plus a fresh `auditColumns()` spread. Index the user foreign key.
  Add the required `public.set_updated_at()` trigger in a new migration; preserve
  existing migrations and include generated metadata.
- Fixed lifetime: 30 days, no sliding refresh in this step. Set expiry from the
  database clock and align cookie expiry with the stored value. Expired rows are
  invalid; automated pruning is deferred (they do not need deleting to expire).
- Cookie: `track_atlas_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no Domain,
  `Secure` in production. Permit ordinary HTTP only for local development.
- Cookie contains only the opaque token. Reject malformed tokens before lookup.
  Join the digest to an unexpired session and active existing user at request
  time. Return only the minimal identity needed by callers, initially user ID.
- Never publicly cache session/cookie reads or a viewer's authenticated state;
  request-scoped deduplication is acceptable. Respect the installed Next.js
  Cache Components guide and use Suspense around request-time auth UI/guards.
- Insert the user and initial session in one transaction. Failure rolls both
  back. Set the cookie only after commit and redirect outside generic error
  handling so Next.js redirect control flow is not swallowed.
- If a stale cookie is present, replace it on successful signup. Successful signup
  always generates a fresh token rather than using client-provided session data.
- Sessions persist across page reloads and server restarts. Reject inactive users
  on every lookup, not only at account creation.

There is intentionally no sign-out/login UI in this slice. Closing a tab does
not sign out a visitor; they remain signed in until cookie/session expiry or
revocation. A later authentication slice can provide sign-out and returning-user
login without changing the signup destination or form.

## Request handling and security boundaries

Use a server-only signup service with a Next.js Server Action adapter; keep
validation/hash/session logic independently testable. Use the framework's
same-origin Server Action protections; do not add a wildcard allowed-origin
exception. Recheck session status inside the action: hiding the form alone is
not authorization. Validate locale using the supported locales; no arbitrary
return URL or external redirect destination is accepted.

Keep database access, hashing, session digests, and cookie mutation on the server.
Expose only validation errors and safe non-secret form values to the UI. Session
validation errors caused by infrastructure failure must not be silently treated
as signed-out authorization success; show a generic failure instead.

## Acceptance and verification

- Fresh visitor reaches localized signup from the homepage link; switching
  languages preserves the signup path; header section links return to home.
- Selected layout works at mobile/desktop widths in both themes/locales with
  keyboard access, label associations, required/optional clarity, and error/pending
  announcements. No avatars, CAPTCHA, or strength rules appear.
- Valid signup with or without display name creates exactly one active user and
  one session, with an encoded salted hash and unaltered calendar date. Response
  sets the expected cookie and redirects to the matching homepage.
- Reloading home preserves authentication; homepage signup link is absent and
  direct signup navigation/submission cannot create a second account.
- Required fields, whitespace-only names, invalid/duplicate email, invalid/future
  dates, input bounds, and tampered/repeated/non-string inputs are rejected on
  the server even with browser validation bypassed.
- A one-character password is accepted for now; leading/trailing spaces are
  preserved; identical passwords produce distinct hashes with independently
  checkable scrypt derivations. Credential material never appears in returned
  action state, client markup, logs, or public-profile data.
- Case-variant/racing signup attempts cannot create duplicate users; failure to
  insert a session rolls back the new user. No cookie is issued on failure.
- Tampered, expired, unknown, and inactive-user sessions are rejected; valid
  sessions survive server restart. Cookie security attributes and hashed-token
  storage are covered by tests; production Secure behavior is tested separately
  from local HTTP behavior.
- Database tests isolate/roll back their records. Browser tests that must commit
  accounts use unique test addresses and delete only their own fixtures in teardown
  (cascade removes their sessions), never truncate tables or touch unrelated users.
- Run all existing and new unit/live DB/HTTP/browser tests, lint, TypeScript,
  production build, migration replay/schema drift, and whitespace checks. Obtain
  one independent whole-change code review before reporting completion.

## Left to the builder

Exact module filenames, validation implementation/library (native validation is
acceptable), translated copy, breakpoint/spacing details, hash encoding version
syntax, per-process hash concurrency bound, test organization, and minimal safe
error logging. Keep these consistent with the existing app and this design.

Implementation planning begins only after the user approves this document.

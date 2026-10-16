# Account settings and reusable modal

## Intent and agreed scope

Give signed-in users a localized settings page, accessible through a new
**Settings** item above **Log out** in the existing user-name dropdown.
Users can edit first name, last name, and optional display name, view but not
change their email, change their password, and deactivate their account.
Deactivation means setting `users.active = false`, not deleting the user.

The user approved the three-section interactive mockup: Profile, Password,
and Deactivate account. Profile has its own save button; password changes and
deactivation require a confirmation modal. Confirmation alone is sufficient:
neither operation requests the current password.

A password change keeps the current browser session valid and revokes every
other session. Deactivation revokes all sessions, signs out the current browser,
and returns it to the localized homepage. The existing login modal must use the
same reusable modal component as both confirmation dialogs.

## Proposed implementation decisions

These are builder defaults, not additional user requests:

- Routes are `/en/settings` and `/es/settings`, with localized metadata and
  locale-aware navigation. Unauthenticated visitors redirect to their localized
  homepage. Authentication or database outages show a generic unavailable state,
  never a false guest state or an editable form.
- Keep the existing shared header, footer, theme tokens, responsive spacing,
  and individual Phosphor icon imports. Provide all text in English and Spanish.
  Add semantic danger tokens if needed rather than inline component colors.
- Use independent forms and pending/error/success feedback for profile and
  password. Deactivation is a separate, clearly destructive section explaining
  that retained information is not deleted and login will no longer work.
- First and last names are required and trimmed; display name is trimmed,
  optional, and stored as null when blank. All three use signup's 200-Unicode-
  character limit. A successful profile save refreshes the header label in the
  same browser immediately. Email is read-only and never included in updates.
- Password entry includes a new-password field and matching confirmation, using
  `autocomplete="new-password"`. Preserve password whitespace and existing
  nonempty/1,024-UTF-8-byte limits; do not introduce strength rules. Validate
  before showing confirmation and again on the server before hashing. Closing
  the confirmation without submitting changes nothing. After an attempted
  password mutation, clear password fields and require fresh entry for retry;
  no password or confirmation value is returned through action state.
- Password confirmation explains that other devices will be signed out.
  Deactivation confirmation explains loss of access and retained data. Cancel
  receives initial focus. No new CAPTCHA or current-password challenge is added
  to these authenticated settings actions; signup/login ALTCHA remains unchanged.
- There is no reactivation UI. Deactivation retains the email and its uniqueness
  constraint, so the same email cannot be used to register another account.
- No date-of-birth/avatar editing, email changes, account hard deletion, password
  reset, admin controls, or continuous synchronization across browser tabs.

## Reusable modal

Extract the existing native `<dialog>` infrastructure into a shared client
component, with a small API for content, accessible title/description IDs,
close label/callback, initial focus, and busy state. It must support login's
custom form heading and initial email focus without duplicating visible titles.

Preserve `showModal()`, inert background, explicit keyboard focus wrapping,
Escape and true-backdrop dismissal, close icon, viewport-safe scrollable size,
theme overlay, and focus restoration without unwanted page scrolling.
Prevent all dismissal paths while a request is pending. Unmounting login must
still discard password/CAPTCHA state. Keep the login caller's existing
navigation, success, and scroll-restoration behavior; do not merge authentication
business logic into the shared modal.

Confirmations use this same primitive, default focus to Cancel, and only invoke
the relevant Server Action after explicit confirmation. Disable repeated
submission and dismissal while pending. Mutation failures are announced and
leave the user able to retry without suggesting success. The component and its
callers must handle unmounts and replacement/removed triggers safely.

## Server and persistence boundaries

Follow the current pure-validation, testable-action orchestration, server-only
service, and thin Next.js Server Action adapter pattern. Application database
access uses `getDb()`. Read installed Next.js request-time rendering/action/cache
guides before coding, and keep settings data under an appropriate request-time
Suspense boundary; never cache authenticated content publicly.

Every action validates locale and authenticates using the request cookie, not a
submitted user ID. Allowlist only each operation's fields; reject missing,
duplicate, file-valued, and oversized known inputs. Ignore injected email,
privilege flags, active flags, and arbitrary user IDs rather than persisting
them. Confirmation may be represented in the submitted operation, but is a UX
step, not an authorization credential. Direct action calls still require a valid
active, unexpired session. Use Next.js's existing same-origin Server Action
protections and do not introduce state-changing GET routes.

Read only safe profile fields for the page; never serialize a whole user row,
password hash, raw session token, or database exception to the client. Retain the
existing minimal header session identity rather than exposing email globally.

Serialize mutations with the user-row lock used by login. Recheck that the
request session still belongs to that active user and remains unexpired inside
the transaction, after acquiring the user lock. A session revoked while waiting
cannot authorize a mutation. Profile updates change only the three editable name
columns. Password updates atomically write a fresh hash and revoke all sessions
except the request's authenticated session. Use the existing bounded asynchronous
password hasher; authenticate before expensive work, then reauthorize inside the
transaction. Deactivation atomically disables the user and removes all their
sessions. Failures roll back both sides of either operation.

This locking must prevent concurrent login from issuing a usable session for a
disabled user or using an old password after a committed password change, while
existing login hash-recheck protection is preserved. A password action whose
session was revoked during hashing must not commit.

Clear the current cookie only after deactivation commits. If cookie clearing or
navigation fails after commit, the database remains authoritative: the account
is disabled and its revoked cookie cannot authenticate. Retrying with that
cookie cannot reactivate the account. Do not claim that a committed deactivation
was rolled back. Handle expired sessions during editing without allowing a
mutation or exposing private data; the user can return to the homepage to log in.

No schema migration is needed: required columns, timestamps, and update triggers
already exist. Preserve existing timestamp behavior and applied migrations.

## Verification and documentation

- Unit coverage for allowlisted validation, whitespace/Unicode/UTF-8 bounds,
  matching passwords, safe states, authentication/locale rejection, failures,
  and action/cookie ordering.
- Live development-database coverage for safe profile reads/updates, untouched
  immutable fields, session ownership/expiry/revocation, correct password hashes,
  current-session preservation, other-session revocation, deactivation without
  deletion, rollback, audit timestamps, and concurrency with login/settings.
- Browser coverage in both languages: dropdown navigation and protected page,
  profile persistence and refreshed name, read-only email and tampered input,
  password confirmation/cancel/change with two sessions and old/new credentials,
  deactivation confirmation/cancel/sign-out/blocked login, session expiry and
  failures, and modal keyboard/focus/backdrop/pending behavior.
- Re-run existing login/signup/logout and real ALTCHA checks after extraction;
  verify mobile layout, light/dark themes, and hydration diagnostics.
- Run `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`, and all relevant README
  test suites against a migrated local development database.
- Update `ARCHITECTURE.md` for settings, shared modal, mutations and session
  behavior, and `README.md` for user-visible behavior and any command changes.

## Delivery

Work directly on `master`, as required by the project. After design approval,
write the implementation plan, implement with regression tests, and verify.
Do not push or commit implementation changes unless separately requested.

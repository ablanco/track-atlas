# Account Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated profile/password/deactivation settings and extract the login dialog into a reusable modal.

**Architecture:** Follow existing pure validation, injectable action orchestration, server-only transactional services, and thin Next.js adapters. Settings streams request-specific safe profile data beneath Suspense; mutations authorize from the cookie and recheck under a user-row lock. Shared native-dialog behavior supports both login and confirmations.

**Tech Stack:** Next.js 16.4, React 19.3, TypeScript, next-intl, Tailwind semantic tokens, Drizzle/PostgreSQL, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-account-settings-design.md`

## Execution result — 2026-10-16

- [x] Task 1: Allowlisted settings validation
- [x] Task 2: Safe reads and atomic account mutations
- [x] Task 3: Testable action orchestration and Next.js adapters
- [x] Task 4: Reusable modal and menu navigation
- [x] Task 5: Protected settings page and independent forms
- [x] Task 6: Documentation, full verification, and independent review

Implemented natively on `master`. Follow-up changes add visible password-field
validation styling and a read-only date of birth, excluded from profile updates.
Final pre-commit verification passed lint, TypeScript, production build, and all
336 tests: auth 131, DB config 7, live DB 97, HTTP/localization 15, browser 86.
Independent read-only review found
no blocking issues. Deferred nonblocking coverage: previously cancelled dialog
remaining closed after profile refresh, menu ArrowUp/End specifically on the
settings route, and completed-deactivation UI when cookie clearing fails (the
orchestration state is tested). The task steps below preserve the original plan;
execution evidence and rulings remain in this plan's ignored SDD ledger.

## Global Constraints

- Work directly on `master`; do not create a branch/worktree. No implementation commits or pushes unless requested.
- Routes: `/en/settings` and `/es/settings`; all user-facing strings in both message catalogs; locale-aware navigation only.
- First/last names required and trimmed; display name optional/trimmed/null when blank; maximum 200 Unicode characters each.
- Passwords preserve whitespace, are nonempty, and allow at most 1,024 UTF-8 bytes; require a matching confirmation. Never return either password through action state.
- Confirmation alone authorizes the UX step: no current-password prompt or new settings CAPTCHA. Existing signup/login CAPTCHA verification remains unchanged.
- Password change preserves the requesting session and revokes all others atomically; deactivation sets `active=false` and revokes all sessions atomically, without deleting user data.
- Authenticate every action using its request cookie; reauthorize after acquiring the user-row lock. Never accept a submitted identity/privilege/email/active change.
- Use `getDb()` in application adapters; no secrets, hashes, or raw tokens sent to clients. No schema changes or shared caching of authenticated content.
- Keep shared theme tokens, Phosphor imports, next-themes patch, login focus/scroll/pending behavior, and database audit triggers.
- Live tests target only a migrated local development database, use owned fixtures, and clean up only owned records.

## Review Focus

- A session revoked while password hashing or waiting for the user lock must not authorize a settings mutation (Task 2).
- Deactivation committed before cookie clearing fails must remain disabled and never report an apparent rollback (Task 3).
- A confirmation dialog must not submit stale password values after cancel/retry or leave secrets in action state (Task 5).
- Adding Settings changes the first focused menu item; ArrowUp/End must still reach logout, including on the settings route (Task 4).
- Refreshing a profile must update the header without erasing unrelated unsaved password input or reviving a closed dialog (Task 5).

## File map

- `auth/settings-validation.ts`: profile/password parsing and exported safe value/error types.
- `auth/settings.ts`: safe authenticated profile read and transactional profile/password/deactivation services.
- `auth/settings-action.ts`: injectable orchestration, locale validation, safe action state, post-commit effects.
- `app/[locale]/settings/actions.ts`: cookie, database, refresh, and redirect adapters.
- `app/[locale]/settings/page.tsx`: metadata, request-time protected profile read, localized form props.
- `app/[locale]/settings/profile-form.tsx`, `password-form.tsx`, `deactivate-account.tsx`: independent UI/action state.
- `app/[locale]/settings/settings-labels.ts`: shared serializable label types; translation assembly stays server-side in the page.
- `components/modal.tsx`: reusable native dialog; `components/auth-control.tsx`: use it for login and add Settings link.
- `components/header-auth.tsx`, `messages/en.json`, `messages/es.json`: menu label and settings translations.
- `styles/themes.css`, `app/globals.css`: semantic destructive-action theme tokens.
- `tests/auth/settings-validation.test.ts`, `settings-action.test.ts`: pure/injected tests.
- `tests/db/settings.test.ts`: persistence, atomicity, authorization, concurrency.
- `tests/e2e/settings.spec.ts`, `tests/e2e/login.spec.ts`: settings and shared-dialog regression tests.
- `package.json`: include the new database suite in the explicit `test:db` script.
- `ARCHITECTURE.md`, `README.md`: implemented behavior and verification documentation.

### Task 1: Allowlisted settings validation

**Interfaces:** Export `ProfileValues = { firstName: string; lastName: string; displayName: string }`, `ProfileInput` with nullable displayName, `PasswordInput = { password: string }`, and `SettingsValidationCode = "required" | "invalid" | "tooLong" | "mismatch"`. `validateProfile(form: FormData)` returns a discriminated success/input/values or failure/errors/values result. `validatePassword(form: FormData)` parses `password` and `passwordConfirmation`, returns success/input or failure/errors, never password echoes.

- [ ] Write `tests/auth/settings-validation.test.ts`: required/blank names, optional omitted display name, 200/201 Unicode characters, bounded safe echoes, duplicate/file known fields, injected email/admin/userId/active ignored, whitespace-preserving passwords, empty/1,024/1,025 UTF-8 bytes, duplicate/file/missing confirmation and exact mismatch.
- [ ] Run `pnpm exec tsx --conditions=react-server --test tests/auth/settings-validation.test.ts`; confirm failure due to missing module.
- [ ] Implement `auth/settings-validation.ts` using the existing signup parser conventions, without coupling validation to database/UI code.
- [ ] Run the targeted command and `pnpm test:auth`; require zero failures.

### Task 2: Safe reads and atomic account mutations

**Interfaces:** In `auth/settings.ts`, export `SettingsProfile = ProfileValues & { email: string }`, `SettingsResult = { ok: true } | { ok: false; reason: "unauthorized" | "unavailable" }`. Use `Pick<Database, "select" | "transaction">` for the database parameter. Export `getSettingsProfile(db, token: string | undefined): Promise<SettingsProfile | null>`, `updateProfile(db, token, input: ProfileInput): Promise<SettingsResult>`, `updatePassword(db, token, input: PasswordInput): Promise<SettingsResult>`, `deactivateAccount(db, token): Promise<SettingsResult>`.

- [ ] Write `tests/db/settings.test.ts` using owned fixture accounts and cleanup like `tests/db/login.test.ts`. Pin safe profile selection, invalid/unknown/expired/revoked/inactive sessions, untouched email/privilege/birthday/avatar fields, trimmed names/null display, database-driven audit timestamps, and other-account isolation.
- [ ] Add password/deactivation tests: correct fresh hash, old password rejected/new accepted, same current token/expiry retained, other sessions gone, retained disabled row/email, all sessions gone, disabled login rejected, transaction rollback if session deletion fails.
- [ ] Add deterministic concurrency tests using transaction interception/barriers and independent connections: a revoked/expired request after preflight cannot update; deactivation/password changes serialize with login's existing user lock/hash recheck; password hashing followed by session revocation cannot commit. Use barriers rather than timing-only sleeps.
- [ ] Add `tests/db/settings.test.ts` to the `test:db` command. Confirm the configured DB is local/development without printing credentials, run `pnpm db:migrate`, then the targeted suite and observe expected missing-module failure.
- [ ] Implement safe joined profile lookup and a private transactional authorization helper: discover user from cookie token, lock that user row, then recheck token ownership, active status, and expiry against database `clock_timestamp()` after locking. Use explicit field selections and session digest matching, no public user ID parameter. Hash passwords with existing `hashPassword` only after successful preliminary authentication, then recheck authorization under lock. Return safe failures and propagate profile-read outages to the page boundary.
- [ ] Implement allowlisted profile update; password hash update plus deletion of all user sessions except the request digest; deactivation update plus deletion of all user sessions. Keep mutations and deletions in the same transaction; do not alter existing login checks.
- [ ] Run the targeted suite and `pnpm test:db`; require zero failures including existing login concurrency regressions.

### Task 3: Testable action orchestration and Next.js adapters

**Interfaces:** Export `ProfileActionState = { values: ProfileValues; fieldErrors: Partial<Record<keyof ProfileValues, SettingsValidationCode>>; formError?: "unauthorized" | "unavailable"; success?: boolean }`, `PasswordActionState` with password/confirmation error codes and the same non-value feedback, and `DeactivateActionState` with formError and optional `deactivated: true`. Handlers: `handleProfileUpdate(locale, form, dependencies)`, `handlePasswordUpdate(locale, form, dependencies)`, `handleDeactivation(locale, dependencies)`. Define explicit operation-specific dependencies for reading the request token, invoking Task 2 services, refreshing, and clearing cookie/redirecting home; no dependencies are arguments to public Server Actions.

- [ ] Write `tests/auth/settings-action.test.ts` with injected effects: invalid locale no service/effects, validation failure no mutation, unauthorized/service failure no success, thrown exceptions sanitized, password never echoed, mutation-before-refresh, deactivation-before-cookie-clear-before-redirect, redirect signal not swallowed.
- [ ] Pin the partial-success case: deactivation commits, cookie clearing throws, state indicates `deactivated: true` (not a retryable mutation failure); the UI must offer a homepage return and never claim rollback. Invalid sessions cannot trigger hashing/mutations. Test repeated deactivation with a revoked token cannot reactivate anything.
- [ ] Run the targeted auth command and confirm missing-module failure.
- [ ] Implement `auth/settings-action.ts` with bounded states and narrowly scoped catches. Implement `app/[locale]/settings/actions.ts`: public `saveProfile(locale, previous, form)`, `changePassword(locale, previous, form)`, and `disableAccount(locale, previous)` adapters using request cookies, `getDb()`, `refresh()` after successful updates, and locale-aware homepage redirect outside catches after deactivation.
- [ ] Read installed guides before writing adapters: `01-app/02-guides/server-actions.md`, `authentication-with-cache-components.md`, and `03-api-reference/04-functions/{refresh,redirect,cookies,connection}.md` under `node_modules/next/dist/docs/`. Do not use shared caches for profile data.
- [ ] Run `pnpm test:auth` and `pnpm exec tsc --noEmit`; require zero failures.

### Task 4: Reusable modal and menu navigation

**Interfaces:** Export `Modal(props: { children: ReactNode; titleId: string; descriptionId?: string; closeLabel: string; busy: boolean; onClose(): void; initialFocus?: string; returnFocus?: RefObject<HTMLElement | null> })` from `components/modal.tsx`. `initialFocus` is a selector scoped to the dialog; default to a focusable dialog target, not a global query. The caller provides the accessible heading/content and mounts/unmounts it. Keep login-specific pending state/callbacks in `LoginModal`.

- [ ] Update `tests/e2e/login.spec.ts` menu tests to assert Settings is first, ArrowDown moves to logout, ArrowUp/End reach logout, Home returns to Settings, and Settings uses the localized URL. Existing menu tests should fail before menu implementation.
- [ ] Extend login modal regressions to pin tab wrapping, X/Escape/outside click dismissal, focus restoration without scroll jumps, disabled dismissal while pending, form/proof reset on reopen, and route-change cleanup. Run `pnpm test:e2e tests/e2e/login.spec.ts --workers=1` to record failures from the newly expected Settings item.
- [ ] Extract native-dialog code into `components/modal.tsx`; preserve showModal/cleanup, inert background, focus trap, accessible labels, true-backdrop bounds testing, pending dismissal protection including close/cancel, safe connected-trigger focus restoration, and current styling.
- [ ] Replace duplicated login dialog infrastructure in `components/auth-control.tsx` using Modal, preserving login form IDs/initial email focus, success/navigation callbacks, pending protection, and caller scroll restoration.
- [ ] Add `settings` to `AuthLabels`, assemble it in `components/header-auth.tsx`, and add the locale-aware `Link` with `role="menuitem"` and `tabIndex={-1}` before logout. Let existing UserMenu keyboard behavior include links; close the menu on activation even when already on `/settings`.
- [ ] Add Auth.settings translations in both catalogs and run the focused login browser suite; require zero failures and no hydration errors.

### Task 5: Protected settings page and independent forms

**Interfaces:** `SettingsPage` renders localized heading/metadata and `<Suspense><AuthenticatedSettings /></Suspense>`. Request-time component reads token after `connection()`, calls `getSettingsProfile`, redirects guests home outside catches, renders unavailable on outages, and passes safe profile/labels to independent `ProfileForm`, `PasswordForm`, and `DeactivateAccount` client components. Define their serializable label types in `settings-labels.ts`; do not pass user IDs/tokens/hashes. Use Task 3 Server Actions with `useActionState` and Task 4 Modal for confirmations.

- [ ] Write `tests/e2e/settings.spec.ts` with owned database fixtures and real login CAPTCHA solving. For en/es, assert protected guest redirect, Settings menu navigation, read-only email, profile validation/persistence/null-display fallback, refreshed header and safe field allowlisting. Add mobile light/dark rendering, locale switching retaining `/settings`, and no hydration errors using existing test fixtures.
- [ ] Add password tests: mismatched confirmation prevents modal, valid form opens it, Cancel initially focused, Escape/backdrop/X cancel without mutation, Tab wraps, pending disables repeated submission/dismissal, confirmation changes credentials and revokes another browser while preserving this browser, old-password login fails/new succeeds, fields clear after attempted mutation, cancellation does not submit stale values. Pin unsaved password input surviving profile-save refresh and closed dialogs staying closed.
- [ ] Add deactivation tests: cancel leaves active/session state unchanged; confirm retains disabled user, revokes both browsers, clears current cookie and redirects to localized homepage; login fails afterward. Add expired-session during editing and safe server-failure feedback, including the Task 3 committed-but-cookie-clear-failed UI state.
- [ ] Run `pnpm test:e2e tests/e2e/settings.spec.ts --workers=1` and confirm missing settings-route failures.
- [ ] Implement request-time page/metadata and localized label assembly; keep private reads inside Suspense and keep redirect signals outside catches. No settings form is rendered during loading/unavailability or for unauthenticated users.
- [ ] Implement profile form with bounded errors, required names, optional display name, immutable email display, pending/status feedback and focused alert. Preserve form identity across server refreshes so unrelated password state is not lost.
- [ ] Implement password form with browser/server validation, same-snapshot confirmation submission (do not send secrets before confirmation), cancel-first Modal, pending locks, focused error/success feedback, and clearing secrets after attempted mutation. Do not rely solely on HTML maxlength for Unicode/UTF-8 constraints.
- [ ] Implement deactivation section/Modal with explicit retained-data/lost-access text, pending locks, failure feedback, and completed-deactivation fallback homepage link if cookie handling fails.
- [ ] Add all Settings strings to `messages/en.json` and `messages/es.json`. Add `--danger`/`--on-danger` semantic variables to both palettes and Tailwind mappings in `app/globals.css`; verify readable contrast without changing existing tokens/patches.
- [ ] Run focused settings/login browser suites and all auth/database tests; require zero failures. Review both locales at 375px and desktop in light/dark themes.

### Task 6: Documentation, full verification, and review

- [ ] Update `ARCHITECTURE.md`: scope/routes/module map, shared modal, safe profile fields, action authorization/locking, password revocation/deactivation, confirmation-only security tradeoff, retained data/email, and tests. Remove stale claims that account-management UI is absent.
- [ ] Update `README.md`: Settings menu entry, editable/immutable fields, confirmation dialogs, session behavior, account deactivation versus deletion, and lack of reactivation UI.
- [ ] Run `git diff --check`, `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build`; require success. Re-run type checking after build if generated route types changed.
- [ ] Confirm a local development DB, run `pnpm db:migrate`, `pnpm test:auth`, `pnpm test:db:unit`, `pnpm test:db`, `pnpm test` against the running server, and `pnpm test:e2e --workers=2`; require zero failures. Existing real-widget CAPTCHA and theme/hydration suites must remain enabled.
- [ ] Obtain read-only final review under the chosen execution workflow, covering modified source/tests/docs against the spec; fix accepted findings with failing regression tests first and rerun affected/full checks as appropriate.
- [ ] Mark the plan complete and report actual verification results and limitations. Leave all changes uncommitted/unpushed unless the user asks otherwise.

## Plan self-review

Checked every spec section against Tasks 1–6, including modal extraction, session concurrency, safe post-commit failures, bilingual UI, and unchanged CAPTCHA. Interfaces align across validation/services/actions/forms. All five review-focus conditions have explicit owning test steps. No dependency installation, schema migration generation, feature branch, worktree, or implementation commit is required.

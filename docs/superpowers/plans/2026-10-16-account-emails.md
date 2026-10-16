# Account Emails Implementation Plan

> Follow-up requirement: the user removed the second confirmation step. Opening
> a valid confirmation link now submits automatically after hydration and shows
> the result. Original explicit-button steps below are superseded by this change;
> passive GET rendering remains read-only, but JavaScript-capable scanners may confirm.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send application-rendered confirmation and password-recovery emails through Brevo, with secure single-use links and localized account UI.

**Architecture:** Keep Next.js Server Actions as thin request adapters over testable server-only authentication services. PostgreSQL owns token consumption, session revocation, and distributed sending limits. Send a single-recipient Brevo API request after commit; use a private capture transport for development/tests and no queue or worker.

**Tech Stack:** Next.js 16.4, React 19.3, TypeScript, next-intl, PostgreSQL 18, Drizzle, native fetch/crypto, Node test runner/tsx, Playwright Chromium. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-16-account-emails-design.md` (approved).

## Global Constraints

- Work directly on `master`; no branches/worktrees. Keep execution edits uncommitted until requested; checkpoint reviews replace per-task commits below. The design/plan are planning artifacts, not permission to push.
- HTTP API at `https://api.brevo.com/v3/smtp/email`; custom escaped HTML and plain text, one recipient; no SMTP, provider templates, batch mixing, or new runtime dependencies.
- Confirmation expiry: 24 hours. Reset expiry: 1 hour. Token: 32 random bytes, canonical base64url; store SHA-256 digest only.
- Sending limits: 60-second cooldown and 3 requests per rolling hour per normalized email/purpose; 250 provider attempts per UTC day overall. Database time and atomic shared storage decide all windows.
- Signup still signs in automatically; unconfirmed accounts retain access. Reset revokes all target-user sessions, never auto-signs-in, and never implicitly confirms email.
- Existing ALTCHA signup/login proof verification and atomic consumption before hashing remain unchanged; no recovery CAPTCHA or trusted-IP assumption is introduced.
- Every new table spreads fresh `auditColumns()` and installs `public.set_updated_at()` in a new migration. Applied migrations are immutable.
- Secrets, database access, hashing, tokens, and email delivery remain server-side; use `getDb()` in adapters. Clients never receive secrets/passwords through action state.
- All new user-facing copy is in both `messages/en.json` and `messages/es.json`; use semantic theme tokens, locale-aware navigation, and existing accessible Modal.
- Five-second provider timeout, no automatic retry, no external I/O under database locks, no detached promises; email failure never undoes committed signup.
- Request-specific reads stay under Suspense, outside shared caches; token pages are noindex/nofollow with no-referrer and noncached responses.
- Read `AGENTS.md`, the spec, `ARCHITECTURE.md`, and `README.md` before execution. Read installed Next.js guides for Cache Components authentication, `connection`, pages/searchParams, Server Actions, cookies, and response headers before modifying those boundaries.
- Only migrated development databases for live tests; no real provider sends or production account mutations in automated tests. Production rejects capture mode.

## Review Focus

1. Names containing HTML, template braces, CR/LF, or more than Brevo's 70-character recipient-name limit must not inject markup, trigger provider interpolation, or reject otherwise valid users (Task 1).
2. A newer reset request must not invalidate an earlier usable link, but a committed password change/deactivation must invalidate all appropriate links even under issuance races (Tasks 3–4).
3. A successful reset with cookie-clear failure, another account's current cookie, or a token-invalidating rerender must still show completion and revoke only the target account's database sessions (Tasks 4 and 7).
4. Language changes while a token is live must retain exactly one valid token on only the two token routes; malformed/duplicate query values and arbitrary redirect parameters confer no authority (Task 5).
5. UTC midnight, an hour/cooldown boundary during lock wait, and concurrent callers on different DB connections must not exceed email budgets or misreport remaining cooldown (Task 2).

---

## File and interface map

Read existing files before editing; file names below are the intended decomposition, not permission for unrelated refactors.

| Unit | Files and responsibility |
| --- | --- |
| Email contracts/config/rendering | `email/types.ts`, `email/config.ts`, `email/templates.ts`: shared types, private validated config, pure localized content |
| Transport | `email/brevo.ts`, `email/capture.ts`, `email/send.ts`: fixed-destination HTTP adapter, safe nonproduction capture, config-selected delivery |
| Tokens/limits | `auth/account-token.ts`, `auth/account-token-store.ts`, `auth/email-rate-limit.ts`, `db/schema.ts`, new `drizzle/0005_add-account-email-tokens.sql` and metadata |
| Account mutations | `auth/account-confirmation.ts`, `auth/password-recovery.ts`, existing `auth/settings.ts`: locked confirmation/reset and related invalidation |
| Orchestration | `auth/account-email.ts`, `auth/account-email-action.ts`, existing `auth/signup.ts`, `auth/signup-action.ts`: issuance, post-commit delivery, safe action results |
| Request adapters | `app/[locale]/email-actions.ts`, existing signup/settings action adapters; no request-specific work in shared caches |
| Token-route presentation | `app/[locale]/confirm-email/{page.tsx,confirmation-form.tsx}`, `app/[locale]/reset-password/{page.tsx,reset-form.tsx}`, `components/account-link-state.tsx` |
| Login/recovery | `components/auth-control.tsx`, `components/login-form.tsx`, new `components/password-recovery-form.tsx`, `components/header-auth.tsx`: same modal, explicit views and focus |
| Settings | existing page/profile/labels and new `app/[locale]/settings/email-confirmation.tsx`: independent status/resend control beside email |
| URL/privacy | `components/language-switcher.tsx`, new `components/account-link-language-links.tsx`, `proxy.ts`: narrow token-route locale preservation and headers |
| Verification | new auth/email unit and DB tests, `tests/e2e/account-emails.spec.ts`, `tests/helpers/email-test-server.ts`, `tests/helpers/email-sink.ts`, `tests/e2e/email-helpers.ts`, existing suites/config |

Core contracts (define once and import, rather than duplicating unions):

```ts
// email/types.ts
type EmailLocale = "en" | "es";
type AccountEmailPurpose = "email-confirmation" | "password-reset";
type EmailMessage = { to: { email: string; name: string }; subject: string; html: string; text: string };
type EmailSendResult = { ok: true; messageId: string } | { ok: false; reason: "unavailable" };
type SendEmail = (message: EmailMessage) => Promise<EmailSendResult>;
// auth/account-token-store.ts; server-only data, never a public action result
type IssuedAccountEmail = { userId: string; email: string; firstName: string; purpose: AccountEmailPurpose; token: string; expiresAt: Date };
type AccountLinkResult = { ok: true } | { ok: false; reason: "invalid" | "unavailable" };
// auth/email-rate-limit.ts
type EmailLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };
```

Use `Database` from `auth/database.ts`; export its transaction callback type as
`AuthTransaction` there for token/limiter helpers. Types shown here are exported
by their named modules. An issued token's only browser exposure is the link page
the recipient opened and that page's own submit authority, never safe action state.

## Task 1: Localized email rendering and safe delivery transport

**Files:** Create `email/{types,config,templates,brevo,capture,send}.ts`, `tests/auth/email.test.ts`, `tests/helpers/email-sink.ts`, `tests/helpers/email-test-server.ts`, `tests/e2e/email-helpers.ts`, `tests/e2e/email-capture.spec.ts`; modify `playwright.config.ts`, `.env.example`, messages, `tests/localization.test.mjs`, README email configuration section.

**Interfaces:** Produce `getEmailConfig(env: NodeJS.ProcessEnv): EmailConfig`, a discriminated union for `mode: "brevo" | "capture"`; `renderAccountEmail(purpose: AccountEmailPurpose, locale: EmailLocale, firstName: string, url: string): Pick<EmailMessage,"subject"|"html"|"text">`; `buildAccountEmailUrl(origin: string, locale: EmailLocale, purpose: AccountEmailPurpose, token: string): string`; `sendBrevoEmail(config: BrevoConfig, message: EmailMessage, fetcher?: typeof fetch): Promise<EmailSendResult>`; `sendEmail(message: EmailMessage): Promise<EmailSendResult>` selecting validated config internally. Export config types from `email/config.ts`.

- [ ] **1. Write failing unit tests** named `renders both purposes in both locales`, `origin cannot be controlled by a request`, `account text stays literal`, `provider failures stay private`, and `capture cannot run in production`. Assert `html.includes("&lt;script&gt;")`, no literal user `<script>` markup, no active `{{params.*}}`/`{{contact.*}}` interpolation, direct origin-bound URLs, 24-hour/1-hour copy, and plain-text fallback. Use hostile name `Ada <script>& {{contact.EMAIL}}\r\n` and a 200-code-point name; omit the provider `to.name` entirely if unsafe/over 70 characters, while keeping an escaped greeting in the body.
- [ ] **2. Run red:** `pnpm exec tsx --conditions=react-server --test tests/auth/email.test.ts`; expect missing module/export failures.
- [ ] **3. Implement config and templates.** `EMAIL_DELIVERY_MODE` defaults to capture outside production, Brevo in production. Brevo mode requires `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` (1–70 characters without CR/LF), `APP_ORIGIN`, and `EMAIL_RATE_LIMIT_SECRET` (at least 32 random bytes). Validate origin is an origin only (no userinfo/path/query/hash); HTTPS except nonproduction loopback HTTP. Capture uses a private ignored `.superpowers/mail/` directory by default, bounded permission-restricted JSON files, never stdout. Optional `EMAIL_TEST_SINK_URL`/`EMAIL_TEST_SINK_TOKEN` route capture to a test-owned HTTP receiver at literal loopback only, without redirects; both are rejected in production. These are configuration choices, never form arguments. Add `AccountEmails` translation namespace and update the exact namespace allowlist test.
- [ ] **4. Implement the Brevo adapter.** POST one recipient with API-key/JSON/accept headers, `htmlContent` and `textContent`, no template/params, native AbortSignal timeout of 5,000 ms, `redirect: "error"` and no retries. Require 201 plus a bounded nonempty `messageId`; 202/malformed JSON/429/5xx/network/timeout return only unavailable. Bound response parsing and never attach raw errors, recipients, URLs, or credentials to logs/state. Unit-test the abort signal and redirect rejection without waiting five real seconds. Document API-reference support for both body fields despite the introductory guide's conflicting one-body wording; do not silently drop the text alternative.
- [ ] **5. Write failing capture-harness tests** before implementing the runner. `startEmailSink(): Promise<{url:string;token:string;close():Promise<void>}>` binds literal loopback on an ephemeral port with a fresh bearer secret and in-memory messages accessible only to the runner. Assert unauthorized requests/redirects fail, messages remain scoped to the run, production rejects capture, and inherited environment values cannot activate live sends. `waitForCapturedEmail(email:string,purpose:AccountEmailPurpose): Promise<EmailMessage>` reads only that run's sink; add server-generated purpose tags to internal capture envelopes, never infer authorization from tags. The fixture test sends a synthetic rendered message through capture and proves it reaches the sink with no Brevo request.
- [ ] **6. Implement isolated test startup.** The wrapper starts sink then Next and stops both on termination. Default Playwright-managed app is `http://127.0.0.1:3100`, does not reuse unrelated servers, and has explicit capture env/`APP_ORIGIN`. Store run metadata/handshake under a permission-restricted `/tmp/opencode` run directory, not Next-public configuration or source control. Reject email-suite `TEST_BASE_URL` use without compatible private capture configuration. The existing HTTP suite's separate 3000/base-URL behavior stays documented. No sink endpoint lives in the application. Run `pnpm test:e2e tests/e2e/email-capture.spec.ts --workers=1` and the unit command red first, then green after implementing; real signup/token integration comes in later tasks.
- [ ] **7. Verify green** with the Task 1 unit/browser commands and `pnpm exec tsc --noEmit`. Document sender/domain verification and disabling transactional open/click tracking using Brevo account controls, not invented tracking JSON fields. Capture tests must assert no request reaches Brevo.
- [ ] **8. Checkpoint:** review only this deliverable's diff and record pass/fail evidence; no implementation commit/push without user request.

## Task 2: Audited persistence and atomic email sending limits

**Files:** Modify `db/schema.ts`, `auth/database.ts`, `package.json`; create `auth/account-token.ts`, `auth/email-rate-limit.ts`, `tests/auth/account-token.test.ts`, `tests/db/account-emails.test.ts`, migration SQL/metadata; update architecture persistence section.

**Interfaces:** Produce `createAccountToken(): { token: string; tokenHash: string }`, `isAccountToken(value: unknown): value is string`, `hashAccountToken(token: string): string`; `emailRateKey(email: string, secret: string): string`; `reserveEmailRequest(db: Database, purpose: AccountEmailPurpose, key: string): Promise<EmailLimitResult>`; `readEmailCooldown(db: Database, purpose: AccountEmailPurpose, key: string): Promise<number>`; `reserveEmailDailyBudget(db: Database): Promise<boolean>`. DB access types may be narrowed to matching method picks, but preserve callable signatures and transaction compatibility.

- [ ] **1. Write failing tests:** token is canonical 43-character base64url of 32 random bytes, distinct per call, digest is 64 hex characters, padded/noncanonical/malformed tokens rejected; normalized-case/trim email keys match and do not contain the email. Schema assertions cover purpose check, unique digest, FK cascade and timestamp triggers. Limiter assertions: `allowed` at times 0/60/120 seconds, denial on fourth within 3,600 seconds, correct retry seconds, independent purposes, allowance after rolling-hour expiry, exactly one winner on concurrent cooldown reservations, exactly 250 daily winners across separate connections, new UTC day permits again.
- [ ] **2. Run red:** `pnpm exec tsx --conditions=react-server --test tests/auth/account-token.test.ts tests/db/account-emails.test.ts`; expect missing schema/helpers.
- [ ] **3. Implement schema.** `accountActionTokens`: UUID, user FK, purpose, unique digest, `expiresAt`, nullable `consumedAt`/`revokedAt`, user/purpose and expiry indexes. `emailSendLimits`: text primary key, non-null `attemptedAt` timezone-aware timestamp array default empty, audit columns. Keys are `address:<purpose>:<HMAC>` and `daily:YYYY-MM-DD`; timestamps are trimmed to the active window and arrays bounded to 3 or 250 successful reservations. Both tables get audit triggers. Run `pnpm db:generate --name=add-account-email-tokens`; review generated `0005` SQL and metadata and add triggers without editing earlier migrations.
- [ ] **4. Implement limiter using insert-on-conflict then SELECT FOR UPDATE.** Get a fresh DB clock after acquiring the row lock; trim events at/before the window cutoff, check newest +60 seconds and count <3, append only on allowed request. Retry seconds is the ceiling of the maximum applicable cooldown/hour deadline minus DB time. Daily keys use DB UTC date, count only reserved provider attempts, and never refund on provider failure/timeout. Address reservation is a short standalone transaction completed before acquiring any user/session/token locks; daily reservation is another standalone transaction after account issuance commits. No transaction holds limiter and account locks together. Signup follows this order too.
- [ ] **5. Verify green** after confirming the database is development and running `pnpm db:migrate`, using Task 2's command and `pnpm test:db`. Include the new DB file explicitly in the `test:db` package script. Add lock-wait boundary tests with controlled DB timestamp updates/barriers, not sleeps of a minute/hour or changing production limits for tests.
- [ ] **6. Checkpoint:** review SQL constraints/defaults/audit triggers and record concurrency results. No commit/push.

## Task 3: Purpose-bound token issuance, inspection, and account mutations

**Files:** Create `auth/account-token-store.ts`, `auth/account-confirmation.ts`, `auth/password-recovery.ts`; modify `auth/settings.ts`; extend `tests/db/account-emails.test.ts`, `tests/db/settings.test.ts`, `tests/db/login.test.ts`, `tests/auth/account-token.test.ts`.

**Interfaces:** Produce `issueAccountToken(tx: AuthTransaction, user: {id:string;email:string;firstName:string}, purpose: AccountEmailPurpose): Promise<IssuedAccountEmail>` (caller already owns user lock/new user insert); `inspectAccountToken(db: Database, purpose: AccountEmailPurpose, token: unknown): Promise<"valid"|"already-confirmed"|"invalid">`; `revokeAccountTokens(tx: AuthTransaction, userId: string, purpose?: AccountEmailPurpose): Promise<void>`; `confirmAccountEmail(db: Database, token: string): Promise<AccountLinkResult>`; `resetAccountPassword(db: Database, token: string, input: PasswordInput): Promise<AccountLinkResult>`. Reuse `PasswordInput`/validator from settings; result types above. Inspection does not expose recipient details or mutate any row.

- [ ] **1. Write failing database tests:** exact 24h/1h DB-derived lifetime, no stored plaintext, wrong-purpose rejection, GET-style inspection does not consume, one concurrent consumer succeeds, expired-during-hashing/lock-wait fails, inactive user fails, and injected failure rolls back all rows. Create two reset links for one user and prove both inspect valid until the first consumption invalidates the other. Reset revokes all target sessions and no unrelated session, leaves confirmation false, and cannot resurrect a disabled account. A fresh token for a confirmed active user inspects already-confirmed, but consumed/revoked tokens still inspect invalid.
- [ ] **2. Run red:** `pnpm exec tsx --conditions=react-server --test tests/db/account-emails.test.ts tests/db/settings.test.ts tests/db/login.test.ts`; expect missing service exports or invalidation assertions to fail.
- [ ] **3. Implement read/issuance/consumption helpers.** Validate canonical token shape before querying. Lookup candidate, validate active/purpose/expiry before scrypt; lock user then token and recheck with fresh database time after waits. Confirmation invalidates remaining confirmation links and sets `emailConfirmed`; reset hashes outside locks, atomically updates hash/deletes sessions/revokes all reset links. Store consumption/revocation timestamps, not raw tokens. No send helper is called here.
- [ ] **4. Integrate settings invalidation.** Add `revokeAccountTokens(...,"password-reset")` inside existing password-change transaction; deactivation revokes both purposes in its existing transaction. Keep current-session preservation for settings password changes, unlike reset's all-session revocation. Add deterministic issuance-versus-settings-change, issuance-versus-reset-consumption, reset-versus-login and deactivation-versus-consumption tests. Lock issuance user first; record a preflight password hash before waiting and abort a stale reset issuance if that hash changed under the lock, so an in-flight old request cannot create a token after the password mutation. A genuinely new request started afterward remains allowed.
- [ ] **5. Verify green** with Task 3's command and `pnpm test:auth`; include unsupported hash/account rejection and scrypt-capacity failure without token consumption. All secret-bearing results stay server-only.
- [ ] **6. Checkpoint:** review lock ordering, final expiry checks and rollback/race evidence. No commit/push.

## Task 4: Safe email orchestration, signup integration, and request adapters

**Files:** Create `auth/account-email.ts`, `auth/account-email-action.ts`, `app/[locale]/email-actions.ts`, `tests/auth/account-email-action.test.ts`; modify `auth/signup.ts`, `auth/signup-action.ts`, signup action adapter and their unit/DB tests.

**Interfaces:** Produce `requestPasswordReset(db: Database, email: string, locale: EmailLocale, send: SendEmail): Promise<void>` (safe delivery failures absorbed); `requestEmailConfirmation(db: Database, sessionToken: string, locale: EmailLocale, send: SendEmail): Promise<ConfirmationRequestResult>`; `deliverIssuedAccountEmail(db: Database, issued: IssuedAccountEmail, locale: EmailLocale, send: SendEmail): Promise<EmailSendResult>` (daily reserve immediately before send). `ConfirmationRequestResult` is `{ok:true; retryAfterSeconds:number}|{ok:false;reason:"unauthorized"|"unavailable"|"throttled";retryAfterSeconds?:number}`.

Safe state types in `auth/account-email-action.ts`: `RecoveryActionState={values:{email:string};fieldErrors:{email?:"required"|"invalid"|"tooLong"};requested?:true;formError?:"unavailable"}`; `ConfirmationActionState={success?:true;retryAfterSeconds?:number;formError?:"unauthorized"|"unavailable"|"throttled"}`; `ConfirmLinkActionState={confirmed?:true;formError?:"invalid"|"unavailable"}`; `ResetLinkActionState={completed?:true;fieldErrors:PasswordErrors;formError?:"invalid"|"unavailable"}`. Export injectable `handleRecoveryRequest`, `handleConfirmationRequest`, `handleConfirmLink`, `handleResetLink` functions taking locale, FormData where applicable, and server-owned dependency objects matching these services; no injected dependencies in public action arguments.

Public adapters: `requestPasswordResetEmail(locale, previous:RecoveryActionState, form)`, `resendEmailConfirmation(locale, previous:ConfirmationActionState, form)`, `confirmEmailLink(locale, previous:ConfirmLinkActionState, form)`, `resetPasswordFromLink(locale, previous:ResetLinkActionState, form)`. Locale is validated before effects; FormData token is untrusted authority checked at commit, never a user ID/email selector for mutations.

- [ ] **1. Write failing action tests:** generic recovery result deep-equals `{values:{email},fieldErrors:{},requested:true}` for known/unknown/inactive/throttled/quota-limited/provider-failed accounts. Duplicate/file/oversized email/token values reject safely; no password/token/error-body leakage; confirmation targets cookie's account only. Cookie-clear failure after reset returns `completed:true`; a different account cookie clears only that browser cookie and no other account's database sessions. Use `assert.ok(!JSON.stringify(state).includes(rawToken))` and equivalent password assertions for every result path.
- [ ] **2. Run red:** `pnpm exec tsx --conditions=react-server --test tests/auth/account-email-action.test.ts tests/auth/signup-action.test.ts tests/db/signup.test.ts`.
- [ ] **3. Implement issuance and delivery orchestration.** Address reservation precedes lookup even for unknown/inactive reset addresses; normalize/validate as existing login (254-character max). Lock/recheck candidate user before issuing. Resend reauthorizes cookie after user lock and rejects confirmed accounts as successful no-send. Standalone address/daily reservation transactions follow Task 2's order; render/send after the account transaction commits; attempt counters remain on delivery failure. Public reset response is generic even when provider/lookup errors occur after lookup; configuration failure before lookup can return uniform unavailable. Nothing marks an account confirmed because email was merely accepted.
- [ ] **4. Extend signup atomically.** Change `registerUser(db,input,emailKey:string)` to reserve confirmation address allowance before hashing/registration transaction, then always insert confirmation token with user/session. Its internal success result adds `confirmation:IssuedAccountEmail` and `confirmationSendAllowed:boolean`. Throttling suppresses delivery, not account creation; token insert failure rolls back user/session; limiter storage failure may prevent registration, but external provider failure may not. The action adapter derives the key from validated configuration; `handleSignup` gains server-owned preparation and delivery dependencies, sends only when allowed after commit, swallows delivery errors, then sets the session and redirects outside catches as today. Do not serialize `SignupResult` or its secret-bearing additions to clients. Update every existing registration call/test explicitly, rather than adding a bypass/default production key.
- [ ] **5. Implement POST adapters** with `getDb()`, private send/config, request cookies, and safe orchestration. Reset consumes server-validated token, commits mutation, then attempts cookie deletion/refresh; refresh/cookie failures after commit cannot turn completed reset into retry failure. Settings refresh only follows successful resend status changes. No token echo via state; no redirect within broad catches.
- [ ] **6. Verify green** with Task 4's command, `pnpm test:auth`, `pnpm test:db`. Add signup provider outage/timeout and token-insert rollback cases, and assert proofs still consumed before hashing. Checkpoint; no commit/push.

## Task 5: Token routes, privacy headers, and narrow locale preservation

**Files:** Create token-route `page.tsx` files, `components/account-link-state.tsx`, `components/account-link-language-links.tsx`, `tests/auth/account-link-query.test.ts`, `auth/account-link-query.ts`, `tests/account-email-routes.test.mjs`; modify language switcher, `proxy.ts`, message catalogs and localization allowlist if new namespaces are used.

**Interfaces:** Produce `readAccountLinkToken(query: Record<string,string|string[]|undefined>): string|null` accepting exactly one canonical `token`; `AccountLinkLanguageLinks({locale,label}:{locale:string;label:string})` preserving only validated token on `/confirm-email` and `/reset-password`; page props use installed Next.js `PageProps`/async `searchParams`. `AccountLinkState({kind,locale,token}:{kind:AccountEmailPurpose;locale:EmailLocale;token:string|null})` owns request inspection and later renders Task 6/7 forms. Initial placeholder views may be server-rendered until forms land; never consume during rendering.

- [ ] **1. Write failing tests** for missing/array/oversized/noncanonical tokens, unknown `returnTo` ignored, and route metadata/headers. GET twice must leave token unconsumed. Assert response referrer policy `no-referrer`, robots noindex/nofollow, private/no-store behavior, no token in canonical/alternate metadata or shared cache tags. Test an English token link navigating to Spanish keeps exactly the original `token`, not unrelated query parameters. Malformed/duplicate tokens are not propagated.
- [ ] **2. Run red:** `pnpm exec tsx --conditions=react-server --test tests/auth/account-link-query.test.ts` and `node --test tests/account-email-routes.test.mjs` against the development server.
- [ ] **3. Implement request boundaries and privacy.** Shells are localized and under the shared layout; await `connection()` and `searchParams` only in Suspense descendants, inspect without writes and render generic invalid/unavailable states. Set referrer/cache headers in the localized proxy responses for the two exact routes, preserving next-intl responses and unsupported-locale handling. No shared cache, global `force-dynamic` workaround, or fetch-time token logging. Provide metadata without token-containing alternates. Disable automatic link prefetch where it would unnecessarily fetch secret-bearing routes.
- [ ] **4. Implement route-scoped language links** using a Suspense-wrapped client reader of search parameters only on the two known routes. Existing general language switching stays pathname-only. After successful POST, use the router/history integration supported by installed Next.js docs to replace the query with the token-free pathname while retaining mounted local completed state. Reloading a clean URL may show the no-link/request-another view; a query success flag must never stand in for an authenticated mutation.
- [ ] **5. Verify green** with Task 5's commands, `pnpm exec tsc --noEmit`, `pnpm build`, and existing HTTP localization tests. Note Next development request logs may include token query strings: document this local-only exposure and require production access-log redaction; do not claim no token ever reaches infrastructure logs. Checkpoint; no commit/push.

## Task 6: Confirmation status, resend, and explicit link confirmation

**Files:** Create `app/[locale]/settings/email-confirmation.tsx`, `app/[locale]/confirm-email/confirmation-form.tsx`; modify settings profile/page/labels, `auth/settings.ts`, `components/account-link-state.tsx`, messages, existing settings read expectations; create first cases in `tests/e2e/account-emails.spec.ts`.

**Interfaces:** Extend `SettingsProfile` with `emailConfirmed:boolean`; expose `EmailConfirmation({locale,confirmed,initialCooldownSeconds,labels})` inside profile's read-only email block but outside its form or via a sibling layout without nested forms. `ConfirmationForm({locale,token,labels})` consumes `confirmEmailLink` and owns `confirmed` success state. Shared labels are exact inferred types from server-built translated label objects, not passing entire message catalogs.

- [ ] **1. Write failing DB/browser tests:** safe projection includes only intended profile fields plus boolean; confirmed/unconfirmed views; resend uses logged-in identity despite injected email/userId; cooldown persists after reload and a real direct action call cannot bypass it. Confirm button POST succeeds for guest and another signed-in user without switching accounts. Repeated GET/scanner visit leaves status false. Consumed/expired/wrong-purpose tokens cannot set confirmation. Signup still auto-signs-in unconfirmed.
- [ ] **2. Run red** with the existing DB settings file and `pnpm test:e2e tests/e2e/account-emails.spec.ts --workers=1 --grep confirmation`; expect missing UI/control failures, using Task 1's private capture harness.
- [ ] **3. Implement approved UI.** Independent resend button/announcement/pending protection and server-derived cooldown; keep profile, date-of-birth, password and deactivation behavior intact. Initial cooldown comes from a request-time authorized server lookup, not client email selection. Show Already confirmed only for an otherwise valid fresh link; successful submit clears URL token and persists local completion. Guest/other-user success offers home/login; matching signed-in account gets Settings. Post-submit state must not leak the account address to guests.
- [ ] **4. Verify green** with `pnpm test:auth`, `pnpm test:db`, TypeScript, and the targeted browser/HTTP cases. Assert focus to result alert, no nested forms, both locales and themes. Checkpoint; no commit/push.

## Task 7: Modal recovery and completed password-reset experience

**Files:** Create `components/password-recovery-form.tsx`, `app/[locale]/reset-password/reset-form.tsx`; modify auth-control/login-form/header-auth, shared link state, messages, login browser tests and account-email browser cases.

**Interfaces:** `LoginModal` gains controlled initial view `"login"|"recovery"` while preserving existing trigger behavior; expose `AccountAccessButton({locale,initialView,labels})` from a focused `components/account-access-button.tsx` to reuse the same modal on reset success/invalid links. `PasswordRecoveryForm` consumes `requestPasswordResetEmail` and the modal's pending/view callbacks; `ResetForm({locale,token,labels})` consumes `resetPasswordFromLink`. Both use safe state from Task 4. LoginForm gains an `onForgotPassword(email:string)` callback; email extraction is bounded/validated and password/proof never cross views.

- [ ] **1. Write failing browser/action tests:** login → Forgot password → Back retains only email, resets password and real ALTCHA proof; close/reopen starts clean; Tab/Escape/backdrop/focus restoration and pending protection work in both modal views. Known/unknown/inactive/throttled recovery submissions show identical visible response. Blank/mismatched/over-1,024-byte passwords show visible localized fields without consuming token. Assert resetting another browser revokes all target sessions, old password fails/new password works with real ALTCHA, unrelated account sessions survive, and no automatic login occurs.
- [ ] **2. Run red** using `pnpm test:e2e tests/e2e/account-emails.spec.ts tests/e2e/login.spec.ts --workers=1 --grep 'recovery|reset|Forgot'`; expect missing recovery/reset UI failures, with safe action state and cookie-clear completion already covered by Task 4.
- [ ] **3. Implement shared modal view switching** without nesting dialogs or adding URL-return features. On each view change focus its heading/email; closing discards recovery state; pending disables dismiss/back navigation. Preserve the existing login scroll handling and CAPTCHA import/reset behavior. Reset/invalid page access buttons open the same component, not a second modal implementation.
- [ ] **4. Implement reset form** using settings' pure password validator and danger styling, with no extra confirmation dialog. Token goes only in its dedicated untrusted submit field/argument; state never echoes it or passwords. Clear password DOM state after attempted mutation. A `completed:true` response takes precedence over a stale invalid-token rerender, clears secret URL, and offers Log in. Do not authorize subsequent actions based on that client success view.
- [ ] **5. Verify green** with auth/unit/DB tests and targeted browser cases. Explicitly simulate post-commit cookie deletion/refresh failures in orchestration tests, and invalidating token inspection during a successful response in the browser; expect Password updated, not an error. Checkpoint; no commit/push.

## Task 8: Complete regression matrix and operational handoff

**Files:** Complete `tests/e2e/account-emails.spec.ts`, `tests/e2e/email-capture.spec.ts`, email helpers, HTTP tests; update `.env.example`, package test commands as needed, README and ARCHITECTURE.

**Interfaces:** Consume Task 1's `startEmailSink` and `waitForCapturedEmail`, all Task 4 action contracts, and the finished UI. No new runtime service or public test endpoint.

- [ ] **1. Write failing harness tests:** unauthorized and nonloopback access is rejected; sink and app use only explicit capture mode; no real network attempt to Brevo; only matching unique fixture emails are read, and captured URLs contain real DB-issued tokens. Sink lifetime survives the whole suite and is bounded/cleaned up. A manually supplied `TEST_BASE_URL` without a compatible capture sink must fail fast for email tests rather than send to a real provider or silently skip.
- [ ] **2. Run red:** `pnpm test:e2e tests/e2e/email-capture.spec.ts tests/e2e/account-emails.spec.ts --workers=1`; verify each newly added regression fails for its intended boundary before any needed correction, not missing configuration. Existing Task 1 harness checks remain green; do not manufacture a failing test if the new regression already passes.
- [ ] **3. Complete integration fixtures.** Capture real signup and recovery sends containing DB-issued tokens, including outage and delayed-delivery scenarios through the private sink. Tests never configure API auth bypasses or alter expiry/limit constants; age only owned fixtures via SQL when needed. If a new regression exposes a bug, investigate its cause, make the minimal owning-module correction, and rerun the associated unit/DB/browser tests before completing this step.
- [ ] **4. Complete browser matrix** for both locales, mobile widths, light/dark, no page/hydration diagnostics via existing fixtures; expired/used/revoked/duplicate links, scanner-safe GET, purpose confusion, safe copy, signed-in-other-account reset, resend pending/error/reload cooldown, link locale preservation and token removal. Browser cookies/session fixtures and real widgets remain real; only external email delivery is captured. Extend afterEach scoped cleanup for new limiter keys/token FKs; never truncate global tables shared with other tests. Keep daily-cap tests isolated using a separate temporary database or serial runner-owned fixture transaction so they cannot exhaust a dev app's real daily row.
- [ ] **5. Update operational docs** alongside code, not as claims of unverified behavior. Document production sender/domain verification, account tracking disablement, all private env vars and capture restrictions, accepted-vs-delivered copy, no automatic retry/worker, cleanup SQL for consumed/revoked/expired tokens and limit rows beyond active windows, secret rotation resetting rate-limit identities, access-log query redaction, quotas and known timing/bot/DoS limitations. Add a manual opt-in live-send checklist using an authorized recipient only; do not send real email as part of this task without user authorization.
- [ ] **6. Run full verification sequentially** against a confirmed local migrated development DB: `pnpm db:migrate`, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm test:auth`, `pnpm test:db:unit`, `pnpm test:db`, `pnpm test`, `pnpm test:e2e --workers=2`, then `git diff --check`. Ensure the HTTP server is running in capture mode; use a unique browser output directory under `/tmp/opencode` to avoid artifact collisions. Read exit codes and full summaries; investigate failures before proceeding.
- [ ] **7. Final review and handoff.** Follow the chosen execution method's independent review gate, including spec coverage and runtime/security boundaries. Resolve findings and rerun affected verification. Report implemented behavior, verified test counts, any operational blockers and the uncommitted state; commit/push only when explicitly requested.

## Execution order and plan review

Task 1 establishes email delivery and the private browser capture harness. Tasks
2–5 establish tokens, rate limits, mutations, and server/HTTP boundaries; Tasks
6–7 build the related UI against that working harness; Task 8 closes the full
regression and operational gates. These are one connected
authentication feature, not independently deployed products.

Before execution, self-check every spec section against Tasks 1–8, cross-check
all interface/type names, and record Review Focus tests in their owning task.
The user approved this plan and native execution on 2026-10-16. The implementation
was performed directly on master with uncommitted checkpoints. The independent
whole-change review uses the working-tree snapshot because HEAD remains unchanged.

### Verification record

Lint, TypeScript, production build, and 397 automated tests passed after the
independent review and one fix pass: authentication 152, DB configuration 7,
live DB 122, HTTP/localization 19, Chromium 97. CAPTCHA regressions additionally
passed twice with two workers (10 cases). Review fixes cover Unicode identity,
accurate cooldown responses, capture preflight, and the issuance/login/lock-wait/
midnight concurrency matrix. Provider abort/network/oversized-response cases also
pass. Automated delivery used only private capture; live Brevo delivery still
requires operator configuration and an explicitly authorized recipient check.

Deferred minor: after confirmation success, refresh may replace the matching
account's Settings link with a homepage link. The confirmation succeeds and
Settings remains available from the account menu. The user subsequently authorized
committing and pushing the implementation and automatic-confirmation follow-up;
the ignored execution ledger retains the review and verification evidence.

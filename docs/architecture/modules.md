# Module boundaries

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Module boundaries

```text
Browser
  ├─ Localized pages / Client Components
  ├─ Signup Server Action ── auth/signup-action.ts
  │                           ├─ validation + current-session check
  │                           ├─ auth/captcha.ts ── atomic proof consumption
  │                           ├─ auth/signup.ts
  │                                ├─ auth/password.ts
  │                                └─ transaction: user + legal evidence + session + confirmation token
  │                           └─ after commit: confirmation email → session cookie
  ├─ Login Server Action ── auth/login-action.ts → auth/login.ts
  │                           └─ proof → password verification → session rotation
  ├─ Logout Server Action ── auth/logout-action.ts → session revocation
  ├─ Settings Server Actions ── auth/settings-action.ts → auth/settings.ts
  │                            └─ session authorization → locked user/session mutation
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
| `tracks/mutations-http.ts`, `app/api/tracks/[id]/route.ts`                               | Owner-only metadata update and permanent deletion HTTP boundary                                                         |
| `scripts/cleanup-files.ts`                                                               | Operator-run abandoned-upload and deletion cleanup                                                                      |
| `db/`                                                                                    | Schema, audit-column factory, pool factory, server-only database accessor                                               |
| `drizzle/`                                                                               | Ordered SQL migrations, schema snapshots, migration journal                                                             |
| `i18n/`, `messages/`, `proxy.ts`                                                         | Locale configuration, navigation, translations, negotiation                                                             |
| `styles/`, `app/globals.css`                                                             | Shared scales, theme palettes, semantic Tailwind utilities                                                              |
| `tests/`                                                                                 | Unit, live-database, HTTP, and browser checks                                                                           |

The remaining feature boundaries are:

| Location                                              | Responsibility                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `tracks/`                                             | GPX ingestion/derivation, publication, explorer queries, lists, photos, votes, discussion, and preferences |
| `legal/`                                              | Shared document registry, immutable acceptance evidence, and server-side eligibility predicates            |
| `admin/`                                              | Staff authorization, safe model projections, allowlisted mutations, and model capabilities                 |
| `auth/account-erasure.ts`, `scripts/erase-account.ts` | Phased permanent erasure and its operator-only CLI                                                         |

Database access and authentication effects stay on the server. Client code
receives localized labels and safe form state, never password hashes, database
credentials, or the CAPTCHA signing secret. The public Server Action constructs
its dependencies itself; clients cannot inject verification or cookie functions.

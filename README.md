# Track Atlas

_Explore your tracks. Discover new paths._

Store GPX tracks, explore them on interactive maps, and discover public routes.
Track Atlas is under active development, with private and public collections,
private lists for organizing accessible tracks,
elevation and speed charts, staged track photos and a details gallery, inline editing and deletion of owned tracks, and an
English/Spanish interface.

Built with **Next.js, React, TypeScript, Tailwind CSS, and shadcn/ui**, backed by
**PostgreSQL/PostGIS and Drizzle ORM**. Maps use MapLibre; email uses Brevo.

## Setup

Requires **Node.js 22.22.1+** (24 LTS recommended), **pnpm 11.28.5**, and
**Docker Compose** for the local database.

1. Install dependencies and copy the local configuration:

   ```bash
   pnpm install
   cp .env.example .env
   ```

2. Create `.env.local` with two different secrets:

   ```dotenv
   ALTCHA_HMAC_SECRET=<generated secret>
   EMAIL_RATE_LIMIT_SECRET=<another generated secret>
   ```

   Run this twice, once for each value:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Start the database and apply migrations:

   ```bash
   pnpm db:up
   pnpm db:migrate
   ```

Local defaults store uploads in `.data/uploads/` and capture email as private JSON
files in `.superpowers/mail/`; open a captured message to find its confirmation
or password-reset link. No external service credentials are needed locally.

See the [configuration reference](docs/operations.md#setup) for custom database
settings, real email delivery, and [file storage](docs/operations.md#configure-file-storage).

## Run

### Development

```bash
pnpm dev
```

Open [localhost:3000](http://localhost:3000). English and Spanish are available
at `/en` and `/es`.

### Production

Configure `DATABASE_URL`, both secrets, an HTTPS `APP_ORIGIN`, Brevo email delivery,
and persistent private file storage before building. See the
[email](docs/operations.md#2-configure-secrets-and-email) and
[storage](docs/operations.md#configure-file-storage) configuration details.

```bash
pnpm db:migrate
pnpm build
pnpm start
```

Schedule `pnpm files:cleanup` at least every 15 minutes for upload cleanup.

## Commands

Use pnpm to run the scripts in [package.json](package.json).

| Command                               | Purpose                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                            | Start development mode.                                    |
| `pnpm build` / `pnpm start`           | Build / serve production mode.                             |
| `pnpm db:up` / `pnpm db:down`         | Start / stop the local database, preserving data.          |
| `pnpm db:migrate`                     | Apply database migrations.                                 |
| `pnpm db:generate --name=your-change` | Generate a migration.                                      |
| `pnpm lint`                           | Run ESLint.                                                |
| `pnpm exec tsc --noEmit`              | Check TypeScript types.                                    |
| `pnpm format` / `pnpm format:check`   | Format files / check formatting.                           |
| `pnpm test`                           | Run HTTP and localization checks against a running server. |
| `pnpm test:e2e`                       | Run Playwright browser tests.                              |
| `pnpm users:make-admin <email>`       | Grant an existing user admin status.                       |
| `pnpm files:cleanup`                  | Clean up abandoned uploads and retry deletions.            |

For example, `pnpm users:make-admin ada@example.com`. The command matches email
case-insensitively and uses the configured `DATABASE_URL` with Next.js environment
loading (development by default; set `NODE_ENV=production` for production). It
exits unsuccessfully for invalid arguments, a missing user, or a database failure.
Running it again for an existing admin succeeds.

Focused admin backend checks: `pnpm exec tsx --conditions=react-server --test tests/db/admin-mutations.test.ts tests/db/admin-comments.test.ts`. These require a migrated development database; use a separate database when running alongside other database suites. Email delivery is mocked.

Track discussion backend (including its DB/HTTP tests), GPX Studio handoff, track voting and explorer ranking checks run with `pnpm test:tracks:db`, including
paginated comments and owner replies, posting limits/cascades, session-bound GPX links, concurrent votes and authorization changes during lock waits. Apply migrations
with `pnpm db:migrate` first. Discussion notification/preferences backend checks
(mock transport only) run with
`pnpm exec tsx --conditions=react-server --test tests/db/discussion-notifications.test.ts`.
`DISCUSSION_EMAIL_DAILY_LIMIT` defaults to 250 attempts per UTC day, separately
from account email; set it to 0 to pause discussion sending. Focused localized browser coverage:
`pnpm exec playwright test tests/e2e/tracks.spec.ts --grep "details votes refresh"`.

Staged files are formatted automatically by the pre-commit hook.
See [all commands and test prerequisites](docs/operations.md#commands) for unit,
database, and browser suites. Use a migrated development database for tests.

## Further reading

- [Configuration and operations](docs/operations.md) — detailed setup, features, deployment, and testing.
- [Architecture](ARCHITECTURE.md) — implemented behavior, system boundaries, and security.
- [Product design](docs/DESIGN.md) — planned functionality.
- [Glossary](GLOSSARY.md) — domain terminology.
- [Contributor guidelines](AGENTS.md) — development conventions.

## License

[MIT License](LICENSE).

Localized discussion and notification-preference browser checks (migrated
loopback development database, isolated capture-email/local-storage harness):
`pnpm exec playwright test tests/e2e/comments.spec.ts --workers=1`.

Public legal-page HTTP and frozen historical-text checks (running server):
`TEST_BASE_URL=http://localhost:3000 node --test tests/legal-pages.test.mjs`.
Localized legal navigation, revision/language switching, keyboard, mobile,
theme persistence and hydration checks (capture-only browser harness, no account
or database mutations):
`pnpm exec playwright test tests/e2e/legal-pages.spec.ts --workers=1`.
The [legal revision contract](ARCHITECTURE.md#public-legal-documents-and-revision-contract)
describes how to publish corrections and material changes without rewriting
historical documents.

Adult signup and legal acceptance checks run in `pnpm test:auth`, `pnpm test:db`
and `pnpm exec playwright test tests/e2e/signup.spec.ts tests/e2e/captcha.spec.ts`.
The browser capture harness hides the Next.js development indicator so it cannot
cover mobile controls. It supports `E2E_PORT` (default `3100`) to isolate
worktrees, for example `E2E_PORT=3138 pnpm exec playwright test --workers=1`.
Use a separate migrated loopback development database per worktree; use another
separate database or run sequentially when suites exercise shared email limits.

Existing-session legal renewal uses `/{locale}/accept-legal`. Focused database
checks: `pnpm exec tsx --conditions=react-server --test tests/db/legal-gate.test.ts`.
Localized real-ALTCHA renewal, stale-action rejection, themes, language switching
and pending-session logout: `E2E_PORT=3139 pnpm exec playwright test tests/e2e/legal-gate.spec.ts --workers=1`.
Use a separate migrated loopback database and capture-only browser harness.

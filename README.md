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

Focused admin backend checks: `pnpm exec tsx --conditions=react-server --test tests/db/admin-mutations.test.ts`. These require a migrated development database; use a separate database when running alongside other database suites. Email delivery is mocked.

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

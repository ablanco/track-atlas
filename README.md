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
Regenerate the committed site icons from `app/favicon2.svg` with
`node scripts/generate-icons.mjs` after changing the simplified favicon artwork.
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
Development mode hides the Next.js development indicator so it cannot
cover mobile controls. It supports `E2E_PORT` (default `3100`) to isolate
worktrees, for example `E2E_PORT=3138 pnpm exec playwright test --workers=1`.
Use a separate migrated loopback development database per worktree; use another
separate database or run sequentially when suites exercise shared email limits.

Existing-session legal renewal uses `/{locale}/accept-legal`. Focused database
checks: `pnpm exec tsx --conditions=react-server --test tests/db/legal-gate.test.ts`.
Localized real-ALTCHA renewal, stale-action rejection, themes, language switching
and pending-session logout: `E2E_PORT=3139 pnpm exec playwright test tests/e2e/legal-gate.spec.ts --workers=1`.
Use a separate migrated loopback database and capture-only browser harness.

## Staff-operated permanent account erasure

`pnpm users:erase <account-uuid> --dry-run` reports account-owned counts and the
referenced storage-location digests, `erasureStartedAt`, and the snapshot
`lastActiveAdmin` blocker without changing the database or touching
storage. After verifying the request, run
`pnpm users:erase <account-uuid> --confirm <same-account-uuid>`.
This is irreversible, unlike reversible account deactivation. There is no public
erasure endpoint or self-service deletion UI.

Staff procedure:

1. Handle the request through the published privacy mailbox. Establish control
   of the **currently registered email** through a reply/challenge sent to that
   address; possession of an account UUID, public track, display name, or a
   forwarded message alone is insufficient. Resolve ambiguous or disputed
   requests before invoking the command. Record verification and the requested
   UUID in the private request correspondence. Do not put correspondence, email
   addresses, tokens, or credentials in application logs or tickets.
2. Use the intended server environment and database, apply migrations, and
   resolve the exact account UUID with a private, parameterized staff database
   lookup. Run the dry run and check the target against the verified request.
   Counts cover owned/authored records; owned-track deletion additionally removes
   **other people's** votes, comments/replies, and list memberships on those
   tracks. Deleting an authored comment on a surviving track also removes its
   attached owner's reply. Surviving lists and unrelated contributions remain.
3. Before first use, deploy these lifecycle-aware writers and cleaners to every
   instance and drain older upload workers. Confirm the UUID explicitly. The command uses `DATABASE_URL` and the ordinary
   `FILE_STORAGE_*` / `B2_*` configuration, loading Next environment files in
   development by default; set `NODE_ENV=production` for production. It refuses
   to remove the last active administrator under the same lock as administrative
   account changes. First establish another active administrator if necessary.
4. Read the result, not just whether the command ran. JSON `status: "pending"`
   means access is withdrawn but erasure is unfinished. `"failed"` means physical
   removals failed and remain retryable. Both exit **2**. `"complete"` exits **0**
   and means physical cleanup succeeded and the final account row was removed;
   only then is the email reusable. A successful dry run also exits **0**.
   Invalid arguments, absent accounts, last-admin refusal, and infrastructure
   errors exit **1** with safe text. Infrastructure errors may follow committed
   withdrawal; inspect with dry run and resume. An absent UUID does not provide
   a historical completion receipt: reconcile it with the private request record.
5. Preserve the cleanup rows and deadlines. Files, including pending reservations,
   old avatars and unassociated photos, retain **at least a 24-hour tombstone**
   from withdrawal (longer existing deadlines are retained). The first invocation
   normally returns pending even if it already removed all visible bytes.
   Re-run after `nextCleanupAt` (the latest remaining deadline), and retry failed
   removals. A command can wait for an in-flight object write; interrupting it
   leaves the operation resumable. Never shorten tombstones, delete bookkeeping
   manually, or declare completion from an empty bucket listing.
6. Each invocation can address the single storage location described by its
   current configuration. `locations` / `unconfiguredLocations` contain persistent
   digests, not credentials or bucket paths. Match them to the deployment's
   storage inventory, rerun with the original local directory or original B2
   endpoint/bucket and adequate credentials, then rerun for each remaining
   location. Renamed/moved directories, missing credentials, inaccessible buckets,
   retained object versions or provider failures require repair and another run;
   the command leaves these rows pending instead of dropping references.
   `pnpm files:cleanup` also retries physical cleanup for its configured location,
   but **does not finalize account erasure**; run `users:erase` again afterwards.
7. Retain shared protection windows. Erasure does not delete `captcha_uses` or
   `email_send_limits` (address HMACs, account-email daily budgets, and separate
   discussion daily budgets). Re-registration must not reset an address allowance
   or today's budget. Expired protections stop affecting admission by time checks;
   their rows are not thereby physically pruned. During coordinated maintenance
   with writers stopped, delete expired CAPTCHA proofs, address buckets whose
   latest attempt is older than one hour, and daily buckets before the current
   UTC day, using the maintenance SQL below.
   Do not rotate the HMAC secret or prune current windows to satisfy one erasure.
   Account-specific discussion events and upload retry identities disappear with
   the final account row after it can no longer authorize any new work.
8. Separately close out the private request correspondence and necessary Brevo
   contact/message or other provider follow-up under the operator's retention
   procedure. This command removes application data and the referenced stored
   originals, derivatives and B2 versions; it cannot retract delivered email or
   downloaded public copies, and does not promise removal of every provider's
   operational, correspondence, logging or backup records. Handle any retained
   copies and deployment backups separately; do not restore an erased account
   or its files from an old backup.

Focused verification: `pnpm test:erasure:db` (migrated loopback development
PostgreSQL, fake/failing and private local object stores) and
`E2E_PORT=3140 pnpm exec playwright test tests/e2e/account-erasure.spec.ts --workers=1`
(the capture-only harness). Tests advance only their own tombstone deadlines to
exercise completion; operators must wait for the real deadlines.

Run this only in a coordinated maintenance window with protection writers stopped:

```sql
DELETE FROM captcha_uses WHERE expires_at <= clock_timestamp();
DELETE FROM email_send_limits
WHERE key LIKE 'address:%'
  AND NOT EXISTS (
    SELECT 1 FROM unnest(attempted_at) AS attempt
    WHERE attempt > clock_timestamp() - interval '1 hour'
  );
DELETE FROM email_send_limits
WHERE (key LIKE 'daily:%' OR key LIKE 'discussion:daily:%')
  AND updated_at < date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
```

Explorer footer and shared footer browser checks: `pnpm exec playwright test tests/e2e/explorer-footer.spec.ts tests/e2e/legal-pages.spec.ts tests/e2e/homepage.spec.ts`. Use a migrated local development database; the browser harness captures email.

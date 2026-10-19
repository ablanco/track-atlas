# Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a local Docker PostgreSQL/PostGIS database, a server-side Drizzle connection, and repeatable migrations without defining application tables.

**Architecture:** Docker Compose runs the database while Next.js runs on the host. Drizzle uses the node-postgres driver and a lazily initialized connection pool. Drizzle Kit manages checked-in migrations, beginning with an idempotent PostGIS extension migration.

**Tech Stack:** PostgreSQL 18, PostGIS 3.6, Docker Compose v2, Drizzle ORM/Kit, pg, Next.js 16.4, TypeScript, pnpm.

**Spec:** Approved scope in this conversation: Docker Compose with persistent storage and health check; a Drizzle connection through `DATABASE_URL`; migration commands including enabling PostGIS; `.env.example` and local setup instructions. Users and tracks schemas are explicitly deferred.

## Global Constraints

- Work directly on `master`; do not create a branch or worktree.
- Do not add users/tracks tables, authentication, application routes, or an application container.
- Use `postgis/postgis:18-3.6`, not `latest`; mount its named volume at `/var/lib/postgresql`.
- Bind the published port to `127.0.0.1`, defaulting to host port 5432.
- Treat this Compose configuration and example credentials as local-development infrastructure, not production hardening.
- Never expose database credentials through `NEXT_PUBLIC_` variables or log connection URLs.
- Do not auto-run migrations during builds, imports, or requests.
- Use stable npm releases compatible with one another, not Drizzle prereleases; record resolutions in `pnpm-lock.yaml`.
- No automatic commits or destructive volume removal as part of execution.

## Execution Result

- [x] Task 1: Local PostgreSQL/PostGIS lifecycle, health, and persistence verified.
- [x] Task 2: Drizzle, migration bootstrap, documentation, and tests implemented.
- [x] Independent review completed; idle pool disconnection finding reproduced and fixed.
- [x] Final verification: 7 unit database tests, 4 live database tests, 12 existing HTTP tests,
      17 browser tests, lint, TypeScript, production build, and diff whitespace checks passed.
- Changes remain uncommitted on `master`; no application tables were added.

## Review Focus

- Repeated migrations must succeed even when the Docker image has already enabled PostGIS.
- Database unavailability must not prevent the existing static homepage from building.
- Next.js hot reload must not create a fresh pool on every module reload.
- Missing or blank `DATABASE_URL` must produce an actionable error without exposing secrets.
- Container recreation must preserve database contents; stop/start commands must not remove volumes.

## File Structure

- `compose.yaml`: local database service, volume, port, environment, and health check.
- `.env.example`: coherent local Compose credentials and host-side `DATABASE_URL`.
- `.gitignore`: permit `.env.example` while retaining other environment-file exclusions.
- `db/client.ts`: testable pool/Drizzle construction and configuration validation.
- `db/index.ts`: server-only, lazy, development-reload-safe database accessor.
- `db/schema.ts`: empty schema module reserved for later application tables.
- `drizzle.config.ts`: PostgreSQL migration configuration, loading environment with `@next/env`.
- `drizzle/`: generated migration metadata and custom PostGIS SQL migration.
- `tests/db/config.test.ts`: configuration validation and connection construction tests without Docker.
- `tests/db/integration.test.ts`: explicitly invoked live database and migration tests.
- `package.json`, `pnpm-lock.yaml`: dependencies and database commands.
- `README.md`: local lifecycle, migrations, verification, and operational caveats.

### Task 1: Local PostgreSQL/PostGIS lifecycle

**Files:** Create `compose.yaml`, `.env.example`; modify `.gitignore`, `README.md`, `package.json`.

**Interfaces:** Compose service `db`; named volume `postgres_data`; variables `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`. Defaults in the example: database/user/password `track_atlas`, port `5432`, URL `postgresql://track_atlas:track_atlas@localhost:5432/track_atlas`.

- [ ] Verify Docker/Compose availability and current listeners before starting anything. Report a blocker rather than replacing an existing database or service.
- [ ] Establish the failing baseline: `docker compose --env-file .env.example config --quiet` fails because no Compose file exists.
- [ ] Create the service using required Compose environment substitutions for credentials, loopback-only port publication, the PostgreSQL 18 volume path, and `pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"` health checking with Compose dollar escaping. Use a 5-second interval, 5-second timeout, 10 retries, and 10-second start period. Do not set a fixed container name.
- [ ] Add `db:up` (`docker compose up -d --wait db`) and `db:down` (`docker compose down`) scripts. Track `.env.example`; keep `.env` ignored. Explain copying the example to `.env` before startup.
- [ ] Verify Compose configuration, start the service, and query `SELECT version(), PostGIS_Version();` with container `psql`. The image is documented as amd64-only: report any platform mismatch rather than silently assuming native ARM support.
- [ ] Verify persistence with a uniquely named scratch table: insert a marker, run Compose down/up without `-v`, read the marker, then drop only that scratch table. Do not remove volumes.

### Task 2: Drizzle connection, migrations, and verification

**Files:** Create `db/client.ts`, `db/index.ts`, `db/schema.ts`, `drizzle.config.ts`, `drizzle/`, `tests/db/config.test.ts`, `tests/db/integration.test.ts`; modify `package.json`, `pnpm-lock.yaml`, `README.md`.

**Interfaces:** `createDatabase(connectionString: string | undefined)` in `db/client.ts` returns `{ db, pool }`, where `db` is the inferred Drizzle node-postgres database and `pool` is a `pg.Pool`. `getDb()` in `db/index.ts` returns the cached database lazily; server-only access is enforced there. Tests close their explicitly created pools.

- [ ] Install runtime `drizzle-orm`, `pg`, `server-only`, and `@next/env` (matching Next.js 16.4.0); install development `drizzle-kit`, `@types/pg`, and `tsx`. Inspect the installed Kit documentation/types for stable-version migration metadata conventions.
- [ ] Write `tests/db/config.test.ts` using `node:test`. Assert undefined, empty, and whitespace-only URLs throw `DATABASE_URL is required`; a supplied URL creates a Drizzle database and pool without connecting immediately; pool configuration retains the supplied URL. Close each pool with test teardown.
- [ ] Run `pnpm exec tsx --test tests/db/config.test.ts` and confirm failure from the missing implementation, not a runner problem.
- [ ] Implement the factory with trimmed-value validation and a pg connection timeout of 5 seconds. Implement `getDb()` behind `import "server-only"`; reuse a module-level instance in production and a typed `globalThis` cache in development. Do not require credentials or connect until called. Leave `db/schema.ts` without application tables.
- [ ] Rerun the configuration tests and type checking; confirm success. Review the server-only boundary and lazy/cache behavior explicitly.
- [ ] Configure Kit with dialect `postgresql`, schema `./db/schema.ts`, output `./drizzle`, and `DATABASE_URL`, loaded through `@next/env` in the project root. Missing credentials must fail clearly without printing their value. Use development environment loading consistently with local Next.js development.
- [ ] Add scripts `db:generate` (`drizzle-kit generate`), `db:migrate` (`drizzle-kit migrate`), `test:db:unit` (`tsx --test tests/db/config.test.ts`), and `test:db` (`tsx --test tests/db/integration.test.ts`). Do not add destructive push/reset commands.
- [ ] Write live integration tests that load the same environment, query `SELECT 1 AS value` through the connection factory, and assert PostGIS can execute `ST_AsText(ST_SetSRID(ST_MakePoint(1, 2), 4326))` returning `POINT(1 2)`. Assert the migration ledger records the bootstrap migration once. These tests require explicit invocation and must not depend on a Next.js HTTP server.
- [ ] Confirm the migration-ledger assertion fails before creating/applying the migration. Generate a custom migration using `pnpm exec drizzle-kit generate --custom --name=enable-postgis`; place `CREATE EXTENSION IF NOT EXISTS postgis;` in its SQL and retain the generated metadata.
- [ ] Run `pnpm db:migrate` twice, then `pnpm test:db`; both migration runs must succeed and tests must show the bootstrap migration recorded once. Also execute the idempotent extension SQL twice against the local database.
- [ ] Complete README instructions: requirements, copy `.env.example` to `.env`, start/wait, migrate, connect, generate/review/apply future migrations, run tests, and stop without data loss. Explain that Compose initialization credentials only apply to an empty volume, changed ports/credentials require updating the URL, host clients use localhost while containers use service `db:5432`, extension creation requires appropriate privileges, and major PostgreSQL upgrades need an explicit data migration. Flag amd64-only image support and the need for separate production credentials, backups, and network hardening.
- [ ] Run `pnpm test:db:unit`, `pnpm test:db`, `pnpm lint`, and `pnpm exec tsc --noEmit`. Run `pnpm build` without `DATABASE_URL` supplied to confirm the existing app needs neither database access nor configuration at build time. Run existing `pnpm test` with a Next.js server available as those tests require HTTP. Inspect `git diff --check` and the final diff; report any blocked verification accurately.

## References checked during planning

- Installed Next.js guide: `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md` (`@next/env` for tooling outside Next.js).
- https://github.com/postgis/docker-postgis (18-3.6 tag, PostgreSQL 18 mount path, initial PostGIS enablement, amd64 limitation).
- https://orm.drizzle.team/docs/kit-custom-migrations (custom migration generation; verify details against installed stable Kit).

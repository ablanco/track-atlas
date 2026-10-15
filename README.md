# Track Atlas

_Explore your tracks. Discover new paths._

Track Atlas is a website where users can store their GPX tracks, view
them on an interactive map, and search their track collection.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Planned features

- Upload and store GPX tracks.
- View tracks on an interactive map.
- Search stored tracks, including spatial search.

## Contributing

See [AGENTS.md](AGENTS.md) for repository conventions and guidance for coding
agents and contributors.

## Getting Started

Install dependencies with `pnpm install`. For local database development, install
Docker with Compose support, then create your local environment and start the database:

```bash
cp .env.example .env
pnpm db:up
```

This runs PostgreSQL 18 with PostGIS 3.6, waits for a healthy database, and stores
data in a named Docker volume. The published database port is bound to localhost.

Apply the database migrations before using database-backed features:

```bash
pnpm db:migrate
```

The first migration enables PostGIS if needed. The Docker image already enables
it for its initial database, so this migration is safe to apply there too.

Then run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Database development

The application uses Drizzle ORM with the `pg` driver. In server-side Next.js
code, import `getDb` from `@/db` and call it when a database query is needed.
Connections are lazy and reused, including during development hot reloads.
Application tables live in `db/schema.ts`, which exports the `users` table and
inferred `User` and `NewUser` TypeScript types.

### User model

The `users` table has a database-generated UUID identifier and these fields:

| Fields | Behavior |
| --- | --- |
| `firstName`, `lastName` | Required, nonblank text |
| `email` | Required, nonblank, no surrounding spaces; unique ignoring case, including for inactive users |
| `passwordHash` | Required encoded salted password hash, never a plaintext password |
| `dateOfBirth` | Required calendar date, represented as a `YYYY-MM-DD` string rather than a JavaScript instant |
| `displayName`, `avatarUrl` | Optional, nullable profile fields; display names are not unique |
| `active` | Defaults to `true`; setting `false` marks an account as disabled |
| `createdAt`, `updatedAt` | Automatic non-null timezone-aware database timestamps |

Apply the user migration with `pnpm db:migrate`. The shared `auditColumns()`
factory in `db/columns.ts` supplies creation/modification columns for every model.
Each table also needs a migration attaching the shared `public.set_updated_at()`
trigger: it updates modification time even for direct SQL and overrides an
explicit stale `updated_at`. Creation time is unaffected by ordinary updates.
See `AGENTS.md` for the convention to follow when adding models.

This is a database model only: registration, password hashing, email/password
login, and social login are not implemented yet. The future authentication layer
must supply a securely salted encoded hash (including its salt and parameters),
validate input, and enforce `active` status when authenticating users. The database
checks for nonblank hash text, not cryptographic validity. No separate salt field
is needed. Profile queries must explicitly select public fields rather than
automatically exposing email, date of birth, or password hashes.

### Migrations

After changing the schema, generate a migration, review the generated SQL in
`drizzle/`, and apply it explicitly:

```bash
pnpm db:generate --name=describe-your-change
pnpm db:migrate
```

For SQL changes not represented by the schema, such as extensions:

```bash
pnpm db:generate --custom --name=describe-your-change
```

Edit the generated SQL before applying it. Commit both SQL and migration metadata.
Do not edit migrations that have already been applied. Migrations never run
automatically during builds or requests. Creating PostGIS requires an appropriately
privileged migration role; the local Docker user has the necessary privileges.

### Connection and lifecycle

Open a database shell using the container's configured credentials:

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Stop the database without deleting its data, then start it again when needed:

```bash
pnpm db:down
pnpm db:up
```

Do not add `-v` to `docker compose down` unless you intend to delete the database.
Initialization credentials only take effect when the volume is empty: changing
`.env` does not update an existing database's roles, passwords, or database name.
PostgreSQL major-version upgrades require a planned data migration, not just an
image tag change.

Compose reads `.env`. Next.js and Drizzle tooling load `.env*` through Next.js's
environment loader; local tooling uses development-mode precedence, so an
existing `.env.local` or `.env.development.local` can override `.env`. Keep
database settings aligned across these files. If port 5432 is occupied, change
`POSTGRES_PORT` and the port in `DATABASE_URL`. If credentials change, update the
URL too, percent-encoding special characters in URL credentials. Host-side clients
use `localhost:<POSTGRES_PORT>`; clients on the Compose network use `db:5432`.
Never prefix the connection URL with `NEXT_PUBLIC_` or commit real secrets.

The upstream `postgis/postgis:18-3.6` image documents amd64 support only. ARM
machines need a compatible image or explicitly configured amd64 emulation.
This setup is for local development: production needs separate strong credentials,
least-privilege application roles, backups, and appropriate network/TLS hardening.

### Verification

```bash
pnpm test:db:unit  # Configuration, lazy initialization, server-only boundary, pool reuse
pnpm test:db       # Live queries, PostGIS, migrations, and user constraints/timestamps
```

Live tests require `pnpm db:up` and `pnpm db:migrate` first. The
connection-recovery check disconnects only a backend opened by that test.
Run these tests against a development database, not production. User-model tests
wrap their changes in transactions and roll them back without deleting other
records. The existing
`pnpm test` suite requires a running Next.js server at `http://localhost:3000`
(or a URL supplied through `TEST_BASE_URL`).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

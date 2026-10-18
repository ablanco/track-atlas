# Track Atlas

_Explore your tracks. Discover new paths._

Track Atlas is an in-development website for storing GPX tracks, viewing them on
an interactive map, and searching a personal or public track collection.

Currently available: an English/Spanish interface, light/dark/system themes,
account signup and login, profile settings, email confirmation, and password
recovery. A private file-upload API supports avatar images and GPX documents,
with local storage or Backblaze B2. Settings includes an optional avatar upload
and displays optimized avatar versions in Settings and the top-bar user menu. **GPX track management, interactive maps,
and track search are not implemented yet.** The homepage map
is an illustration.

Built with **Next.js 16.4, React 19.3, TypeScript, Tailwind CSS 4, and
PostgreSQL/PostGIS**, using Drizzle ORM for database access, next-intl for
translations, self-hosted ALTCHA for CAPTCHA, and Brevo for email delivery.
Dependencies are managed with pnpm.

## Setup

### Prerequisites

- Node.js and pnpm compatible with the versions in `package.json` (Node.js 24 LTS
  recommended; pnpm is pinned to 11.28.5).
- Docker with Compose support for the local PostgreSQL 18 / PostGIS 3.6 database.
  The database image documents amd64 support only; ARM machines need a compatible
  image or amd64 emulation.

### 1. Install dependencies

From the repository root:

```bash
pnpm install
cp .env.example .env
```

The example database credentials are for local development only.

### 2. Configure secrets and email

Create `.env.local` and add these two variables, using a **different generated
value** for each:

```dotenv
ALTCHA_HMAC_SECRET=<generated secret>
EMAIL_RATE_LIMIT_SECRET=<another generated secret>
```

Run this command twice to generate the values:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`ALTCHA_HMAC_SECRET` protects signup and login. `EMAIL_RATE_LIMIT_SECRET` protects
email rate-limit identities. Keep both private and stable across app instances;
never commit secrets or prefix them with `NEXT_PUBLIC_`.

**Local email (default):** `.env.example` sets `EMAIL_DELIVERY_MODE=capture`.
No API key is needed. Confirmation and password-reset messages are saved as JSON
files in `.superpowers/mail/`; open a file to find its link. These files contain
live account links, so keep them private. Set `EMAIL_CAPTURE_DIR` to use another
private directory.

**Real email through Brevo:** verify your sender/domain in Brevo, configure
SPF/DKIM/DMARC, and disable transactional open/click tracking so account links stay
direct. Add the following to `.env.local`:

```dotenv
EMAIL_DELIVERY_MODE=brevo
BREVO_API_KEY=<your Brevo API key>
EMAIL_FROM_ADDRESS=<your verified sender address>
EMAIL_FROM_NAME=Track Atlas
```

`APP_ORIGIN` defaults to `http://localhost:3000` and controls the origin of account
links. Change it if you use another address. Use an origin only, without a path,
query, or fragment; production requires HTTPS and Brevo delivery, not capture.

### 3. Start and migrate the database

```bash
pnpm db:up
pnpm db:migrate
```

The database port defaults to `5432`. If it is occupied, change `POSTGRES_PORT`
and the port in `DATABASE_URL` in `.env`. Keep the URL aligned with the database
name, username, and password too.

Docker Compose reads `.env`; Next.js and Drizzle also load `.env.local` and other
Next.js environment overrides. Avoid conflicting database settings. Database
credentials are initialized only when the Docker volume is empty; editing `.env`
does not change an existing database's credentials.

## Configure file storage

The default development backend stores private files in `.data/uploads/`.
This directory is ignored by Git and must not be served by a web server.
Production requires an explicit backend selection.

For storage on the application host, set:

```dotenv
FILE_STORAGE_BACKEND=local
FILE_STORAGE_LOCAL_DIR=/var/lib/track-atlas/uploads
```

Give the application user ownership of this directory. Use persistent disk and
back up the files with the database. Do not put uploads inside `public/` or
`.next/`. All instances must access the same storage directory; separate
ephemeral disks are not supported.

For Backblaze B2, create a **private** bucket and set:

```dotenv
FILE_STORAGE_BACKEND=b2
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_REGION=us-west-004
B2_BUCKET=<your private bucket>
B2_KEY_ID=<bucket-restricted application key ID>
B2_APPLICATION_KEY=<application key>
```

Use the endpoint and region shown for your bucket. The key needs `listFiles`,
`readFiles`, `writeFiles`, and `deleteFiles` permissions for that bucket.
Use a dedicated bucket without Object Lock retention. Keep credentials server-side.
Do not expose the bucket publicly or add browser CORS access.

`APP_ORIGIN` also defines the trusted origin for upload and deletion requests.
Requests must send that exact `Origin` and an active session cookie.
The API accepts raw file bytes, not multipart form data:

| Method and path | Behavior |
| --- | --- |
| `POST /api/files?purpose=avatar` | Accept server-decodable raster images up to 5 MiB. Return private file metadata. |
| `POST /api/files?purpose=gpx` | Accept UTF-8 GPX XML up to 10 MiB. Return private file metadata. |
| `GET /api/files/:id` | Download an owned file as a private attachment. |
| `DELETE /api/files/:id` | Hide an owned file and delete its stored bytes. |

Set `Content-Type` to the image type or `application/gpx+xml`.
Each successful upload returns an `id` and `downloadUrl`.
Avatar uploads also save the authenticated user's current avatar. Original bytes
are stored unchanged under `avatars/original/<file-id>`. Before publishing the
avatar, the server also stores 128×128 and 24×24 WebP versions under
`avatars/128/<file-id>` and `avatars/24/<file-id>`. Versions are orientation-corrected,
center-cropped (small inputs are enlarged), encoded at quality 80, and stripped
of embedded metadata while preserving transparency. Uploads succeed only after
all three objects are stored; failures keep the previous avatar. The server detects the image type from its bytes
and validates it with the installed decoder rather than trusting browser MIME
labels. GIF, AVIF, and TIFF are supported alongside JPEG, PNG, and WebP on the
bundled decoder. SVG, unknown or undecodable content, and animation remain
rejected. Existing flat files remain readable in place.

In **Settings**, choose an optional avatar file and click **Upload avatar**.
The saved image appears after upload and remains after reload. No avatar is
required to save a profile. The picker accepts `image/*`; actual decoding support
depends on the server. Settings displays the 128px version and the top-bar user
menu displays the 24px version; neither displays originals. Existing avatars
without versions show the no-avatar fallback and require reupload; no backfill
or processing on reads is performed. Originals retain embedded metadata, which
can include location information, and remain available through the private file
download endpoint. Images remain private to their owner.

Click **Remove photo** to detach the avatar and delete its original and both versions. Failed
removal can be retried; the cleanup command also retries queued deletions.

`GET /api/avatars/:id` serves the owned 128px WebP inline for display. Use
`?size=24` for the 24px version (`?size=128` is also accepted); other sizes are
rejected. There is no fallback to original bytes. The regular file download
endpoint remains an attachment containing the original. These endpoints do not create a track.
See [File uploads](ARCHITECTURE.md#10-file-uploads) for validation and lifecycle rules.

Schedule `pnpm files:cleanup` at least every 15 minutes with the same database
and storage configuration as the application. It retries failed deletions,
expires unfinished uploads, and retains deletion records for 24 hours before
removing them. B2 cleanup deletes object versions and delete markers permanently.
The repository does not install a scheduler.

Changing the backend, directory, endpoint, or bucket does not migrate existing
files. Existing records retain their storage-location fingerprint and fail closed
under a different configuration. Keep the original configuration until you plan
and perform a separate migration.

## Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). English and Spanish are
available at `/en` and `/es`. Create an account through **Sign up**, or use
**Log in** in the top bar. Signed-in users can open **Settings** from their menu.

To run a local production build with your configured database:

```bash
pnpm build
pnpm start
```

Production also needs HTTPS, private credentials, backups, and operational
hardening. Abuse protection and automated expiry cleanup remain incomplete;
see [ARCHITECTURE.md](ARCHITECTURE.md) for current security boundaries.

## Commands

Run commands from the repository root with `pnpm`:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the development server. |
| `pnpm build` | Create a production build. |
| `pnpm start` | Serve the production build. |
| `pnpm lint` | Run ESLint. |
| `pnpm db:up` | Start the database and wait until it is healthy. |
| `pnpm db:down` | Stop the database, keeping its data volume. |
| `pnpm db:generate --name=describe-your-change` | Generate a migration from schema changes. |
| `pnpm db:migrate` | Apply pending migrations. |
| `pnpm test:db:unit` | Test database configuration and connection initialization. |
| `pnpm files:cleanup` | Remove abandoned uploads and retry file deletion. |
| `pnpm test:storage` | Test file validation, private local storage, and the B2 wire contract on loopback. |
| `pnpm test:storage:db` | Test file and avatar services against the migrated development database. |
| `pnpm test:auth` | Run authentication, CAPTCHA, and account-email unit tests. |
| `pnpm test:db` | Run live database integration tests. |
| `pnpm test` | Run HTTP and localization checks against a running server. |
| `pnpm test:e2e` | Run Playwright browser tests. |

For SQL-only migrations, use
`pnpm db:generate --custom --name=describe-your-change`. Review generated SQL before
applying it, commit SQL and metadata together, and do not edit applied migrations.
Migrations do not run automatically during builds or requests.

Additional checks and browser setup:

```bash
pnpm exec tsc --noEmit
pnpm exec playwright install chromium
```

Live database and browser tests require a running, migrated **development
database**; never point them at production. `pnpm test` needs a server at
`http://localhost:3000` (override with `TEST_BASE_URL`). By default, Playwright
starts its own app on `127.0.0.1:3100` with isolated build output and private email
capture and an ephemeral local upload directory. It does not send real emails,
access B2, or reuse your development server. File endpoint tests skip external
servers selected with `TEST_BASE_URL` because they require isolated storage.

`pnpm db:down` preserves database data. Do not run `docker compose down -v` unless
you intend to delete it.

## Further reading

- [Architecture](ARCHITECTURE.md): implemented system, data model, security, and tests.
- [Product design](docs/DESIGN.md): intended product and planned features.

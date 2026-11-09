# Configuration and operations reference

[Documentation index](README.md) · [Quick start](../README.md) · [Feature guide](features.md) · [Testing](testing.md)

## Setup

### Prerequisites

- Node.js 22.22.1 or newer (required by lint-staged; Node.js 24 LTS recommended)
  and pnpm 11.28.5, as pinned in `package.json`.
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

`APP_ORIGIN` also defines the trusted origin for upload, track metadata updates,
and deletion requests.
Requests must send that exact `Origin` and an active session cookie.
The API accepts raw file bytes, not multipart form data:

| Method and path                  | Behavior                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `POST /api/files?purpose=avatar` | Accept server-decodable raster images up to 5 MiB. Return private file metadata. |
| `POST /api/files?purpose=photo`  | Stage JPEG/PNG/WebP/AVIF originals up to 20 MiB and six display versions.        |
| `POST /api/files?purpose=gpx`    | Accept UTF-8 GPX XML up to 10 MiB. Return private file metadata.                 |
| `GET /api/files/:id`             | Download an owned file as a private attachment.                                  |
| `DELETE /api/files/:id`          | Hide an owned file and delete its stored bytes.                                  |

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
See [File uploads](architecture/files.md#file-uploads) for validation and lifecycle rules.

Schedule `pnpm files:cleanup` at least every 15 minutes with the same database
and storage configuration as the application. It retries failed deletions,
expires unfinished uploads, and retains abandoned-upload deletion records for 24 hours before
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

Open [http://localhost:3000](http://localhost:3000). English, Spanish, French, Portuguese, German, and Italian are
available at `/en`, `/es`, `/fr`, `/pt`, `/de`, and `/it`. Create an account through **Sign up**, or use
**Log in** in the top bar. Signed-in users can open **Settings** from their menu.

To run a local production build with your configured database:

```bash
pnpm build
pnpm start
```

Production also needs HTTPS, private credentials, backups, and operational
hardening. Broader abuse protection remains incomplete;
see [ARCHITECTURE.md](../ARCHITECTURE.md) for current security boundaries.

For prebuilt GitHub release packages and deployment with nginx/systemd, see
[VPS deployment](deployment.md). No build or dependency installation is needed
on the VPS when using these packages.
The same guide covers automatic stable-release deployment, GitHub SSH settings,
and a manual connection-only check that does not migrate or restart the service.

## Commands

Run commands from the repository root with `pnpm`:

| Command                                        | Purpose                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Start the development server.                                                                                              |
| `pnpm build`                                   | Create a production build.                                                                                                 |
| `pnpm start`                                   | Serve the production build.                                                                                                |
| `pnpm lint`                                    | Run ESLint.                                                                                                                |
| `pnpm format`                                  | Format the repository with Prettier defaults.                                                                              |
| `pnpm format:check`                            | Check formatting without changing files.                                                                                   |
| `pnpm users:make-admin <email>`                | Grant an existing account admin status.                                                                                    |
| `pnpm users:erase <uuid> --dry-run`            | Inspect permanent erasure; follow the staff runbook before confirming.                                                     |
| `pnpm test:erasure:db`                         | Test phased account erasure and cleanup against the development database.                                                  |
| `pnpm db:up`                                   | Start the database and wait until it is healthy.                                                                           |
| `pnpm db:down`                                 | Stop the database, keeping its data volume.                                                                                |
| `pnpm db:generate --name=describe-your-change` | Generate a migration from schema changes.                                                                                  |
| `pnpm db:migrate`                              | Apply pending migrations.                                                                                                  |
| `pnpm test:db:unit`                            | Test database configuration and connection initialization.                                                                 |
| `pnpm files:cleanup`                           | Remove abandoned uploads and retry file deletion.                                                                          |
| `pnpm test:storage`                            | Test file validation, private local storage, and the B2 wire contract on loopback.                                         |
| `pnpm test:tracks`                             | Test GPX parsing, WGS84 derivation, metadata, Outdoor style, worker deadlines/memory and 100,000-point processing.         |
| `pnpm test:tracks:db`                          | Test publication, explorer, lists, votes, GPX Studio, discussion/notifications, and HTTP against the development database. |
| `pnpm test:storage:db`                         | Test file, avatar, and photo services against the migrated development database.                                           |
| `pnpm test:auth`                               | Run authentication, CAPTCHA, and account-email unit tests.                                                                 |
| `pnpm test:db`                                 | Run live database integration tests.                                                                                       |
| `pnpm test`                                    | Run HTTP and localization checks against a running server.                                                                 |
| `pnpm test:e2e`                                | Run Playwright browser tests.                                                                                              |

For SQL-only migrations, use
`pnpm db:generate --custom --name=describe-your-change`. Review generated SQL before
applying it, commit SQL and metadata together, and do not edit applied migrations.
Migrations do not run automatically during builds or requests. The first release
uses `0000_initial-schema.sql` to initialize an empty database, including PostGIS,
`unaccent`, audit triggers, and publication/security guards. The unreleased
development history has been replaced; databases using it must be recreated.
Future changes append migrations to this baseline. Use `pnpm db:migrate`, rather
than schema push, to include custom SQL functions and triggers.

### Automatic formatting

`pnpm install` installs the Husky pre-commit hook. Before each commit, lint-staged
formats staged files with the pinned Prettier version and stages the formatting
changes. Partially staged files retain their unstaged changes. Unsupported file
types are skipped.

Prettier uses its default rules (`.prettierrc.json` has no overrides).
`eslint-config-prettier` disables conflicting ESLint formatting rules; ESLint
continues to check code correctness separately. Run `pnpm format` after broad
edits and `pnpm format:check` as a non-mutating verification check.
Generated output, private runtime data, the lockfile, applied migrations and their
metadata, and dependency patches are excluded in `.prettierignore`. SQL has no
built-in Prettier formatter. No formatting plugins are installed.

See [testing](testing.md) for suite selection, browser installation, isolated
servers, and development database requirements.

## Track maps

Default basemaps need no credentials. To enable optional Mapbox Satellite, set
`NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` in the **build environment**. This browser-visible
token must be restricted to the deployed origins and necessary tile scopes;
monitor usage in the provider account. Without it, Satellite is omitted.

MapLibre requires WebGL and browser workers. Deployment CSP must allow
`worker-src 'self' blob:` and style/tile/glyph/sprite requests to
`https://tiles.openfreemap.org`, Topographic tiles from
`https://tile.opentopomap.org`, and, when enabled, Satellite TileJSON from
`https://api.mapbox.com` plus tiles from `https://a.tiles.mapbox.com` and
`https://b.tiles.mapbox.com`. Satellite TileJSON uses `secure=true` for HTTPS
returned templates. Preserve provider attribution and no-referrer requests.

See [map usage and provider limitations](features.md#track-maps) and
[map architecture](architecture/tracks.md#interactive-original-point-map) for
basemap behavior, failure recovery, and recorded-geometry boundaries. Automated
browser tests stub provider assets; the feature guide includes the opt-in live
provider check.

## Track photo operations

Apply `pnpm db:migrate` before deploying photo support. The existing private local/B2
configuration and cleanup command serve photos as well as avatars and GPX files.
Schedule cleanup every 15 minutes: unattached staged photos expire after 15 minutes,
and removed originals plus all six derivatives are retried for 24 hours before row
removal. Account allowance is now 1 GiB and 100 original files, with two pending
uploads. Budget deployment memory/CPU for six bounded Sharp encodings per photo.
No public bucket or image optimizer access is required.

Run `pnpm exec tsx --conditions=react-server --test tests/db/photos.test.ts` for
transactional photo lifecycle verification against a migrated loopback development
database, and `pnpm exec playwright test tests/e2e/tracks.spec.ts --grep 'photo picker' --workers=1`
for bilingual browser smoke coverage using the capture-email harness.

The picker retains selected Files in memory while the draft is preserved. At 14
minutes from each upload attempt it conservatively asks for a per-photo retry,
keeping captions and ordering. Retry uploads a new staged original through the
same session, validation and quota checks; it cannot revive an expired identity.
Cleanup must continue running to release abandoned originals and versions. Leaving
and restoring a preserved page recreates previews and offers retry for interrupted
uploads. Save locks all picker edits and file drops until the request completes.

### GPX Studio external editing

The toolbox's GPX Studio link uses the configured `APP_ORIGIN` to build a
ten-minute, session-bound GPX URL. Use the site's public HTTPS origin in
production; the editor fetches this URL from the user's browser. No additional
secret, storage bucket exposure, or migration is required.

Exclude or redact requests beneath `/api/tracks/:id/gpx-studio/:key/` from
reverse-proxy, CDN, and application monitoring access logs: the key grants
temporary read access to one track. Next.js development request logging already
excludes these URLs. Preserve the endpoint's CORS header for
`https://gpx.studio` and its private/no-store and no-referrer headers.
Editing in GPX Studio opens an external copy; it does not update the stored track.

## Discussion email operations

New comments notify the track owner; new owner replies notify the parent author.
The HTTP creation adapter attempts delivery once after commit and waits for that
bounded transport attempt before returning 201. Failure cannot undo the post.
There is no outbox, retry, or retroactive delivery. Brevo/capture configuration and
trusted `APP_ORIGIN` are shared with account email. Messages in all six supported languages identify sender/track and link to `/<locale>/tracks/:id?comment=:parentId`,
without discussion text. Links resolve the current page through the comments API.

`DISCUSSION_EMAIL_DAILY_LIMIT` is a nonnegative safe integer, default `250`;
`0` pauses discussion sending. Invalid configuration skips delivery and records a
safe failure. PostgreSQL serializes a distinct `discussion:daily:YYYY-MM-DD`
bucket using database UTC time after lock waits. Failed sends consume allowance;
account confirmation/recovery buckets and their fixed allowance are independent.
A reservation followed by an eligibility change can also consume allowance
without a transport attempt. Do not delete today's buckets to recover capacity.
Prune expired buckets only through the [coordinated protection-record maintenance
procedure](account-erasure.md#expired-protection-record-maintenance), preserving
the current UTC day and running with protection writers stopped.

Immediately before transport, delivery rechecks the current post, recipient email
confirmation, active account, preference and ordinary track access (including
active owner/ready owned GPX), suppressing self-notifications. Null language means
English. A concurrent change after the final database read cannot recall an email
already handed to transport. Operational failure logs contain only a fixed message
and post kind; exception/provider details, email addresses, tokens and post text
are omitted. Capture messages remain private under the existing capture policy.

`GET /api/discussion-preferences` returns `{enabled,locale}` for the active session,
with nullable initial locale. `PUT` requires exactly `{enabled:boolean,locale:"en"|"es"}`,
trusted Origin, JSON and at most 1KiB; it locks user then session and rechecks
expiry before commit. Email confirmation is not required. Clients initialize a
null locale from the current site language on save. Responses are private/no-store;
errors use the discussion codes (400 invalidRequest, 401 unauthorized, 403 forbidden,
413 tooLarge, 503 unavailable; unsupported methods return 405).

Run the captured/mocked notification and preferences suite against a dedicated,
migrated loopback development database:

```bash
pnpm exec tsx --conditions=react-server --test tests/db/discussion-notifications.test.ts
```

The suite exercises actual PostgreSQL concurrency and isolated test-only clock
schemas; it never sends real email. Settings exposes the localized discussion-email
toggle and preferred language;
see [discussion UI architecture](architecture/discussion-and-votes.md#localized-discussion-interface).

## Staff account operations

Grant an existing user administrator status with `pnpm users:make-admin <email>`.
The match is case-insensitive, and repeating the promotion succeeds. The CLI uses
Next.js environment loading (development by default); set `NODE_ENV=production`
for the production configuration. Invalid arguments, missing users, and database
failures exit unsuccessfully. This command does not change other account flags.

For permanent deletion, follow the [staff erasure runbook](account-erasure.md),
including registered-email verification, dry run, explicit UUID confirmation,
storage retries, and finalization. `pnpm files:cleanup` retries physical file
cleanup but does not finalize account erasure.

## Expired protection records

See [database pruning](#database-pruning) for online cleanup of expired CAPTCHA
proofs, email-limit buckets, sessions, and unusable account links. Expiry checks
remain effective independently of physical cleanup.

## Database pruning

Deploy the pruning-aware CAPTCHA and email writers to every application instance
and drain requests from older versions before enabling this command. Run it from
the project root with the same database configuration as the application:

```bash
NODE_ENV=production pnpm db:prune
```

Schedule it externally, initially once per day. Each invocation deletes at most
1,000 eligible rows from each of four tables: sessions, account links, CAPTCHA
proofs, and email limits. JSON output reports `sessions`, `accountTokens`,
`captchaProofs`, and `emailLimits` deletion counts, never tokens or address keys.
If a count reaches 1,000, run again to drain the backlog or increase the schedule
frequency. Locked session/token/CAPTCHA rows are skipped and revisited later.
Email pruning briefly blocks email-limit writers to preserve their allowances;
no application downtime is required.

Each table commits independently. A two-second lock timeout or ten-second
statement timeout fails the command with a nonzero exit status; earlier batches
may already have committed. Capture failures in the scheduler and retry. Overlapping
runs are safe, but schedule one job to avoid unnecessary contention. The command
loads development environment files unless `NODE_ENV=production`; keep production
credentials in the intended environment. It needs database access, not email or
file-storage credentials, and sends no email.

This command does not delete file storage, release pending file quotas, prune
upload retry identities, or finish account erasure. Continue scheduling
`pnpm files:cleanup` at least every 15 minutes and follow the staff erasure runbook.

## Multi-track GPX operations

Apply `pnpm db:migrate` before serving multi-track creation. No new
credentials, storage backend, worker queue or cleanup command is needed. Each
output reserves one file and its actual stored bytes atomically; all output rows
share one pending-attempt allowance. The existing 100-file/1-GiB/two-pending limits
apply, including deleting files until cleanup releases them. The source document
is not retained for multiple outputs; backup every standalone Track GPX with its
database association. Singleton originals stay byte-exact. Keep cleanup scheduled
at least every 15 minutes and preserve deletion/attempt identities until account
erasure; deleting those receipts to recover capacity would permit replay.

The browser preview worker needs same-origin worker assets. Native processing
retains the shared two-worker admission and ten-second deadline for the entire
upload, rather than multiplying budgets by output count. Deployment memory/rate
controls remain necessary; browser structural/deadline bounds are not a V8 heap
quota. See [upload contracts](architecture/tracks.md) and
[integrated suite selection](testing.md#multi-track-upload-ui).

## Search indexing deployment

Leave `SEO_INDEXING_ENABLED` unset or `false` on development and staging. Only the
exact value `true` enables homepage/public Track indexing and sitemap advertising.
Set `APP_ORIGIN` to the trusted public origin (HTTPS in production, no credentials,
path, query or fragment) in both the build and server environment. Rebuild and
restart when changing either setting so prerendered homepage data and request-time
metadata/headers agree. SEO does not require Brevo or email-limit credentials.
For a local production build use a synthetic HTTPS origin, for example
`APP_ORIGIN=https://atlas.example.test pnpm build`; it is not an email-send test.

Check `/robots.txt`, `/sitemap.xml`, and page robot directives in every supported locale
before opting in. Do not block framework assets, `/images/`, or Track photo
versions at a reverse proxy. Preserve existing private/no-store photo and Track
headers; do not add a CDN cache that bypasses their authorization. Sitemaps read
current eligibility from PostgreSQL on every request. The single sitemap supports
up to the protocol's 50,000 localized URLs; split it before reaching that size.
Search engines and sharing services may retain previous public copies after
withdrawal. The localized publishing notice explains that limitation.

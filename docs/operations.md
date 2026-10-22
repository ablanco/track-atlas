# Configuration and operations reference

Detailed feature behavior, storage and email configuration, deployment notes,
and verification commands. For a quick start, see the [README](../README.md).

## Track uploads and visibility

Sign in with a confirmed email, open **Upload track** from the user menu, and
complete the required name, plain-text description, GPX, activity, difficulty
(1–5). Tags are optional; add up to 10, each up to 30 characters.
Visibility defaults **Private**. Select **Public** deliberately
to let anyone view details, geometry, charts and download the unchanged original.
The warning explains that originals can expose timestamps, author metadata,
waypoints and extra locations not shown on the map, plus uploader identity/avatar.
The upload redirects to details only after processing and storage finish. Open
**My tracks** from the user menu to find uploaded tracks again.

Only one GPX track containing exactly one segment is accepted. Loops are valid;
multiple tracks/segments and route elements are rejected. GPX 1.0/1.1 UTF-8 input
is limited to 10 MiB and 100,000 points. Missing elevation/timestamps are allowed.
Private details, structured data and originals are owner-only; public resources
allow anonymous access. Inactive owners are hidden immediately on subsequent requests.
Details show the uploader's current display name (or first name/surname initial)
and derived avatar with initials fallback; avatar originals stay owner-only. The generic file deletion API cannot delete an attached original.

`POST /api/tracks` accepts bounded multipart form fields `name`, `description`,
`activity`, `difficulty`, `tags` (JSON string array), `requestId` (UUID), and `file`,
plus optional `visibility` (`private` by default or explicit `public`).
Send `tags` as `[]` when no tags are supplied.
It requires the trusted origin, active session and confirmed email. Successful
creation returns `{id}`; reuse the same request ID and payload to safely retry a
lost response. A changed payload requires a new ID. Track resources are
`GET /api/tracks/:id/data`, `GET /api/tracks/:id/download`, and
`GET /api/tracks/:id/avatar` (current derived 128px WebP only, no query parameters).
All apply Track visibility/active-owner checks and return no-store responses.
Apply migration `0012` with `pnpm db:migrate` before enabling public uploads.

The request body cap is 11 MiB including multipart overhead, with a 30-second
body deadline. Parsing/derivation runs in a Node worker with an interrupting
10-second deadline, 128 MiB V8 old-space/16 MiB young-space/4 MiB stack limits,
and at most two active workers per application process. These are not total RSS
or distributed resource limits; enforce request rate/concurrency and host memory
limits at deployment. Busy processing fails recoverably instead of queuing.

Run the application from the project root. Deployments must preserve the worker
runtime assets/dependencies in the upload route's output trace; `next.config.ts`
includes the native CJS assets, and Turbopack also emits worker chunks. Do not
copy only the main route bundle. Existing private-storage configuration, quotas,
and `pnpm files:cleanup` apply; schedule cleanup yourself for abandoned uploads.
No additional credentials are required.

### Explore tracks and collections

Open **Explore tracks** or visit `/en/tracks` (`/es/tracks` in Spanish) to search
public tracks without signing in. Search matches every entered word against titles
and tags, ignoring case and accents. Optional activity and difficulty selections
match any selected value within each category; categories combine. Distance limits
are in kilometres. The elevation slider limits highest-minus-lowest recorded
elevation and excludes incomplete elevation data while active. Numeric limits are
inclusive and use stored measurements before rounding.

Each page lists up to ten tracks, newest first, and displays those tracks on the
map. Hover or keyboard focus connects entries to their paths. Click a path to
reveal its entry; overlapping paths offer a chooser. Matching numbers and selected
outlines supplement track colors. Use **Fit results** to restore the page's map
extent. Moving the map does not change search results. On mobile, switch between
List and Map and open Filters for the optional controls.

Uploader links open `/[locale]/users/[id]/tracks`. Visitors see public tracks;
**My tracks** opens the same collection with private tracks included for its
signed-in owner. Owners can select All/Public/Private. Shared URLs retain search,
filters and pagination, and access is checked for each viewer. Active collection
owners expose only their displayed identity and current derived avatar, even if
the collection has no public tracks; profile details and avatar originals remain
private. Search and collection responses are not shared-cacheable.

Apply migration `0014_explorer-search` with `pnpm db:migrate` before using the
explorer. PostgreSQL must permit installation of the `unaccent` extension; no new
credentials are required. The explorer uses bounded display geometry from
`GET /api/tracks/:id/explore-geometry`, independently of unchanged full-resolution
details and GPX downloads. Search uses `GET /api/tracks/explore` with optional
`ownerId`; collection avatar versions use `GET /api/users/:id/avatar`.

### Track maps

Optional Mapbox satellite imagery requires a public Mapbox access token. Add
`NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=<token>` to the build environment; restrict the
token to the deployed site origins and enable only required tile scopes. It is
intentionally public because the browser requests satellite tiles directly. The
Satellite option is omitted when the token is unset. Mapbox usage is billed per
satellite raster tile request; monitor usage and current rates in your Mapbox
account. Provider terms and credits are supplied through Mapbox TileJSON.

Details use pinned MapLibre GL JS 5.24.0 through react-map-gl 8.1.3, with the
hosted [OpenFreeMap Liberty](https://openfreemap.org/quick_start/) **Street**
basemap, a default custom **Outdoors** vector style over the same provider's
[OpenMapTiles-compatible data](https://tiles.openfreemap.org/planet), and a
**Topographic** choice using [OpenTopoMap](https://opentopomap.org/about) raster
topography (trails, contours and shaded relief). Outdoors
emphasizes paths/tracks, woodland, water, protected areas and selected outdoor
labels, while keeping roads/buildings subdued. It has **no contour lines or shaded
relief**; choose Topographic for that context instead. All three remain 2D and
unchanged by the UI theme. Switching preserves the camera and full recorded path;
the choice is not saved as an account preference. Labels prefer English/Spanish
where present, falling back to local names. No account or API key is needed.
Browser requests disclose IP/viewed area to the selected provider; GPX bytes, metadata and
account data stay on this application's service. Provider requests omit referrers.
The service has no SLA: localized map failure/reload guidance leaves details,
charts and downloads available. Outdoors/Topographic failures/timeouts keep the selector and
recorded path available: choose Street to recover, or switch away/back to retry.
Tile features vary by region and zoom, and the current vector tiles top out at
native zoom 14 (overzoom adds no new source detail). Styling cannot restore
omitted OSM features or establish trail completeness, difficulty, or permitted
access. OpenTopoMap tiles have native zoom levels 1–17; overzoom adds no new
detail. OpenTopoMap is volunteer-hosted with limited capacity and no SLA: do not
add bulk, offline or speculative tile downloads, and contact its maintainers
before material public traffic. Mapbox Satellite imagery is an optional basemap, shown only when `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured. It uses Mapbox Satellite raster TileJSON, preserving provider-supplied attribution. Satellite and 3D terrain do not change recorded elevations or analytics.

WebGL and browser workers must be available. MapLibre's bundled worker runs from
a browser-created blob; a deployment CSP must allow `worker-src 'self' blob:` and
the hosted style/tile/glyph/sprite requests to `https://tiles.openfreemap.org`
Topographic raster requests to `https://tile.opentopomap.org`, and Mapbox Satellite TileJSON requests to `https://api.mapbox.com` and raster requests to
`https://a.tiles.mapbox.com` / `https://b.tiles.mapbox.com`. TileJSON uses
`secure=true` so the returned tile templates use HTTPS, not HTTP.
Street/Outdoors retain linked OpenFreeMap/OpenMapTiles/OpenStreetMap attribution;
Topographic retains OpenStreetMap, SRTM/Viewfinderpanoramas, Sonny, OpenTopoMap
and CC BY-SA 3.0 credits, including on mobile and fullscreen. Outdoors uses a
bundled style and hosted fonts without sprites, remote icons or elevation tiles.
OpenTopoMap is contacted only when Topographic is selected; Mapbox is contacted only when Satellite is selected.
JavaScript and MapLibre CSS load through the application's own build, not a CDN.
Do not replace the full geometry source with Directional representations.
Longitude world wrapping is display-only; Mercator clips polar latitudes beyond
85.05°, with a visible notice. Originals and persisted coordinates stay unchanged.
Use the mouse wheel to zoom without Ctrl/Cmd; scrolling outside the map scrolls
the page. Touch panning requires two fingers so one-finger swipes scroll the page.
Buttons provide zoom, fit-to-track and fullscreen where supported. Map interaction
and privacy explanations are available under **Map help and privacy**.

Details show length, difficulty, elevation range, ascent and descent above the
map, followed by elevation/speed charts, description, tags when supplied, and
additional metadata. Elevation range is the highest minus lowest recorded
altitude; partial data is explicitly marked. Satellite imagery and 3D terrain remain
deferred; basemap relief never changes recorded elevations or analytics.
See [map-layer research](research/track-map-layers.md) and
[no-account provider assessment](research/no-account-map-layers.md) for
options, licensing and hosting trade-offs.

Automated Track browser tests stub provider assets but run the real WebGL renderer
and workers, including a synthetic vector tile for Outdoors and a deterministic
raster tile for Topographic. Unit tests validate
the style against the pinned MapLibre style specification and exercise label and
feature-filter expressions and the restored raster source. To check the real
providers and Street/Outdoors/Topographic switching
(no external GPX upload):

```bash
RUN_LIVE_BASEMAP=1 pnpm exec playwright test tests/e2e/tracks.spec.ts -g 'live hosted basemap' --workers=1
```

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

`APP_ORIGIN` also defines the trusted origin for upload and deletion requests.
Requests must send that exact `Origin` and an active session cookie.
The API accepts raw file bytes, not multipart form data:

| Method and path                  | Behavior                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `POST /api/files?purpose=avatar` | Accept server-decodable raster images up to 5 MiB. Return private file metadata. |
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
See [File uploads](../ARCHITECTURE.md#10-file-uploads) for validation and lifecycle rules.

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
see [ARCHITECTURE.md](../ARCHITECTURE.md) for current security boundaries.

## Commands

Run commands from the repository root with `pnpm`:

| Command                                        | Purpose                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Start the development server.                                                                                           |
| `pnpm build`                                   | Create a production build.                                                                                              |
| `pnpm start`                                   | Serve the production build.                                                                                             |
| `pnpm lint`                                    | Run ESLint.                                                                                                             |
| `pnpm format`                                  | Format the repository with Prettier defaults.                                                                           |
| `pnpm format:check`                            | Check formatting without changing files.                                                                                |
| `pnpm db:up`                                   | Start the database and wait until it is healthy.                                                                        |
| `pnpm db:down`                                 | Stop the database, keeping its data volume.                                                                             |
| `pnpm db:generate --name=describe-your-change` | Generate a migration from schema changes.                                                                               |
| `pnpm db:migrate`                              | Apply pending migrations.                                                                                               |
| `pnpm test:db:unit`                            | Test database configuration and connection initialization.                                                              |
| `pnpm files:cleanup`                           | Remove abandoned uploads and retry file deletion.                                                                       |
| `pnpm test:storage`                            | Test file validation, private local storage, and the B2 wire contract on loopback.                                      |
| `pnpm test:tracks`                             | Test GPX parsing, WGS84 derivation, metadata, Outdoor style, worker deadlines/memory and 100,000-point processing.      |
| `pnpm test:tracks:db`                          | Test Track publication, explorer search/privacy/pagination/geometry, avatars and HTTP against the development database. |
| `pnpm test:storage:db`                         | Test file and avatar services against the migrated development database.                                                |
| `pnpm test:auth`                               | Run authentication, CAPTCHA, and account-email unit tests.                                                              |
| `pnpm test:db`                                 | Run live database integration tests.                                                                                    |
| `pnpm test`                                    | Run HTTP and localization checks against a running server.                                                              |
| `pnpm test:e2e`                                | Run Playwright browser tests.                                                                                           |

For SQL-only migrations, use
`pnpm db:generate --custom --name=describe-your-change`. Review generated SQL before
applying it, commit SQL and metadata together, and do not edit applied migrations.
Migrations do not run automatically during builds or requests.

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

Additional checks and browser setup:

```bash
pnpm exec tsc --noEmit
pnpm exec playwright install chromium
```

Explorer UI and real database access coverage:

```bash
pnpm exec playwright test tests/e2e/explore-ui.spec.ts tests/e2e/explore-access.spec.ts --workers=1
```

The isolated map-component browser suite uses real WebGL/workers with deterministic
HTTP responses and does not need a database or email configuration:

```bash
pnpm exec playwright test --config=playwright.explore-map.config.ts
```

Live database and browser tests require a running, migrated **development
database**; never point them at production. `pnpm test` needs a server at
`http://localhost:3000` (override with `TEST_BASE_URL`). By default, Playwright
uses two browser workers and starts its own app on `127.0.0.1:3100` with isolated build output and private email
capture and an ephemeral local upload directory. It does not send real emails,
access B2, or reuse your development server. File endpoint tests skip external
servers selected with `TEST_BASE_URL` because they require isolated storage.

`pnpm db:down` preserves database data. Do not run `docker compose down -v` unless
you intend to delete it.

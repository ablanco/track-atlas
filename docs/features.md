# Track features and usage

[Documentation index](README.md) · [Configuration and operations](operations.md)

Authenticated features require current terms acceptance and privacy acknowledgment.
Existing sessions with missing or outdated evidence must complete the legal renewal
step before continuing. Individual features may also require confirmed email.

## Track uploads and visibility

Sign in with a confirmed email, open **Upload track** from the user menu, and
complete the required name, plain-text description, GPX, activity, difficulty
(1–5). Tags are optional; add up to 10, each up to 30 characters.
Visibility defaults **Private**. Select **Public** deliberately to let anyone
view details, geometry and charts. Signed-in users with current legal acceptance
can download public Track GPX files; private downloads are owner-only. Missing or
invalid sessions receive 401 for downloads; authenticated viewers receive 404 for
inaccessible Tracks. Inactive owners are hidden on subsequent requests.

A GPX 1.0/1.1 UTF-8 document creates one independent Track per `<trk>` in document
order. One upload accepts at most **100 tracks, 100 segments total, 100,000 points
total and 10 MiB**. Every segment needs at least two points and positive length.
Routes are unsupported even alongside valid tracks; waypoints alone create no
Tracks. Invalid or empty later tracks/segments reject the whole upload with
one-based track and local segment positions. Nothing is skipped or truncated.

Before submission, a background preview shows every generated title, the output
count and first-Track-only photo destination. For multiple outputs, all names get
a space and document number, beginning at 1. Only the base shortens to fit the
200-Unicode-character limit. Description, activity, difficulty, tags and visibility
are shared at creation; each output can be edited independently afterward.
Photos, captions and ordering attach only to the first Track. The server validates
the entire document independently of the preview.

Creation is all-or-nothing, including storage and quota reservation. Each output
uses one file allowance and its actual stored bytes. Success opens details for a
singleton, or the owner's collection with a localized success toast showing only
the total created count, beyond the explorer's ten-result page. That collection
view shows only Tracks from the new upload, including while filtering or changing
pages. Choose **View all tracks** to return to the full collection. The confirmation is derived
from the current owner's receipt; query-supplied IDs/counts grant no access.

Downloads for a singleton retain the uploaded original byte-for-byte, including
any document metadata, waypoints and extra locations. Multi-track downloads are
standalone GPX documents containing only the selected track, its ordered segments,
recorded values, names and track-local extensions with required namespaces.
Document-wide metadata, waypoints, extensions and siblings are omitted; the
multi-track source is not stored. These downloads still contain timestamps and
local metadata: isolation does not promise complete metadata scrubbing. Public
upload warnings also disclose the uploader's current identity/avatar.

Loops, repeated positions and shared endpoints remain valid. Maps preserve breaks
and numbered endpoints in one Track color. Charts mark segment starts without
connecting lines or adding distance. Duration sums time within each segment,
excluding gaps; timestamps may reset or overlap across segments or Tracks.
Missing elevation/timestamps are allowed and never inferred. Details show the
segment count; measurements never cross Track or segment boundaries.
Track editing remains metadata-only; segment editing/selection and per-segment
statistics or filters are unavailable.

On failure the form retains its file, metadata and staged photos/captions/order.
Correctable rejections permit edits. After an uncertain acknowledgement or live
processing response, retry the same immutable submission before editing or
replacing photos; it resolves the original attempt without duplicate creation.
Expired uncommitted photos need a new picker upload. Deleting any sibling blocks
all creation retries of that attempt, even after file cleanup. Deliberately
reselect the file to start a new attempt. Open **My tracks** to find outputs again.

Details show the uploader's current display name (or first name/surname initial)
and derived avatar with initials fallback; avatar originals remain owner-only.
Generic file deletion cannot delete an attached Track GPX.

`POST /api/tracks` accepts bounded multipart fields `name`, `description`,
`activity`, `difficulty`, `tags` (JSON string array), `requestId` (UUID), `file`,
optional `visibility` (`private` by default or explicit `public`), and ordered
staged `photos` (JSON array of IDs/captions). Send `tags` as `[]` when absent.
Trusted origin, active session, current legal acceptance and confirmed email are
required. Creation/replay returns `{id, ids}` with nonempty, unique, document-ordered
`ids` and `id === ids[0]`. Reuse the same request ID and payload after a lost
response; changed content conflicts and needs a new identity. Resources include
`GET /api/tracks/:id/data`, `GET /api/tracks/:id/download`, and
`GET /api/tracks/:id/avatar` (derived 128px WebP only, no query parameters).
All enforce visibility/active-owner checks and private/no-store responses.
Apply migrations through `0027` using `pnpm db:migrate` before multi-track uploads.

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

Each page lists up to ten tracks, ranked by popularity (thumbs up minus thumbs
down), and displays those tracks on the map. Equal scores use newest upload
first for public search and user collections, or newest addition first within
private lists, followed by track ID descending. Rankings update when results are
fetched; votes do not reorder an already displayed page live.
Hover or keyboard focus connects entries to their paths. Click a path to
reveal its entry; overlapping paths offer a chooser. Matching numbers and selected
outlines supplement track colors. Use **Fit results** to restore the page's map
extent. Moving the map does not change search results. On mobile, switch between
List and Map below the toolbar. On mobile, the Filters button opens a bottom
drawer with every optional filter, including distance/elevation sliders and
numeric limits. Changes apply immediately; close the drawer to browse results.
On desktop, the toolbar exposes activity and difficulty directly; distance and
elevation open individual dropdown panels.

Uploader links open `/[locale]/users/[id]/tracks`. Visitors see public tracks;
**My tracks** opens the same collection with private tracks included for its
signed-in owner. Owners can select All/Public/Private. Shared URLs retain search,
filters and pagination, and access is checked for each viewer. Active collection
owners expose only their displayed identity and current derived avatar, even if
the collection has no public tracks; profile details and avatar originals remain
private. Search and collection responses are not shared-cacheable.

Apply migrations through `0017_explorer-spatial-geography` with `pnpm db:migrate`
before using the explorer, including the spatial geography index. PostgreSQL must permit installation of the `unaccent` extension; no new
credentials are required. The explorer uses bounded display geometry from
`GET /api/tracks/:id/explore-geometry`, independently of unchanged full-resolution
details and GPX downloads. Search uses `GET /api/tracks/explore` with optional
`ownerId` or `listId`; collection avatar versions use `GET /api/users/:id/avatar`.
The shared explorer offers a viewed-area checkbox and Arrow/Line drawing with a
rendered 0.1–50 km corridor on each side (default 1 km). Search approximates tracks
with seven sampled vertices/six edges. Select Arrow or Line, then click/tap the start and end to apply the filter.
Pointer movement previews the drawing and corridor without searching. Keyboard
use reveals a crosshair and controls for setting endpoints after panning the map. Escape cancels
replacement without removing the committed filter. Spatial criteria, bounds and
corridor persist in shareable URLs and locale links, including private lists.
Active criteria freeze automatic result fitting; completed viewport moves replace
history after a short debounce. Search/map failures retain clearable criteria.
No additional credentials, dependencies, or background services are required.

### Track votes

Track details show thumbs-up and thumbs-down totals and their difference as
popularity. Controls appear only there. Active signed-in users with confirmed
email can vote on someone else's public track. Select the same thumb to withdraw
the vote or the other thumb to switch direction. Guests and owners see totals
without controls; unconfirmed users see an email-confirmation prompt.

Making a track private retains its votes and shows its totals to its owner,
without voting controls. Votes count again when the track becomes public.
Deactivating a voter retains their votes; deleting a track removes its votes.
Administrators can inspect votes but cannot edit them or override popularity.

`PUT /api/tracks/:id/vote` accepts a JSON object with only `vote`, set to `up`,
`down`, or `null` to withdraw. It requires the trusted `Origin`, an eligible
session, and an accessible public track. The request sets the desired state, so
retrying the same request does not toggle the vote. Responses are private and
not cacheable. Apply all pending migrations with `pnpm db:migrate` before serving
voting or popularity-ranked explorer requests.

### Track maps

Optional Satellite requires operator configuration. See [map deployment settings](operations.md#track-maps).

Details use pinned MapLibre GL JS 5.24.0 through react-map-gl 8.1.3, with the
hosted [OpenFreeMap Liberty](https://openfreemap.org/quick_start/) **Street**
basemap, custom **Outdoors** and **Dark** vector styles over the same provider's
[OpenMapTiles-compatible data](https://tiles.openfreemap.org/planet), and a
**Topographic** choice using [OpenTopoMap](https://opentopomap.org/about) raster
topography (trails, contours and shaded relief). Outdoors and Dark
emphasize paths/tracks, woodland, water, protected areas and selected outdoor
labels, while keeping roads/buildings subdued. It has **no contour lines or shaded
relief**; choose Topographic for that context instead. All styles remain 2D. Without a manual choice, the map follows the site theme:
Outdoors for light, Dark for dark. Manual selections are remembered in browser
local storage under `track-atlas-basemap`, shared across explorer and details maps
and browser tabs, and survive reloads and theme changes. There is no separate
automatic-mode control. Blocked storage falls back to an in-memory choice.
Switching preserves the camera and full recorded path; the choice is not saved
as an account preference. Labels prefer English/Spanish
where present, falling back to local names. No account or API key is needed.
Browser requests disclose IP/viewed area to the selected provider; GPX bytes, metadata and
account data stay on this application's service. Provider requests omit referrers.
The service has no SLA: localized map failure/reload guidance leaves details,
charts and downloads available. Outdoors/Dark/Topographic failures/timeouts keep the selector and
recorded path available: choose Street to recover, or switch away/back to retry.
Tile features vary by region and zoom, and the current vector tiles top out at
native zoom 14 (overzoom adds no new source detail). Styling cannot restore
omitted OSM features or establish trail completeness, difficulty, or permitted
access. OpenTopoMap tiles have native zoom levels 1–17; overzoom adds no new
detail. OpenTopoMap is volunteer-hosted with limited capacity and no SLA: do not
add bulk, offline or speculative tile downloads, and contact its maintainers
before material public traffic. Mapbox Satellite imagery is an optional basemap, shown only when `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured. It uses Mapbox Satellite raster TileJSON, preserving provider-supplied attribution. Satellite and 3D terrain do not change recorded elevations or analytics.

Deployment requirements and CSP destinations are listed in the
[map operations reference](operations.md#track-maps).
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
altitude; partial data is explicitly marked. Optional satellite imagery is available when configured; 3D terrain remains
deferred. Basemap relief never changes recorded elevations or analytics.
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

## Edit and delete tracks

Signed-in track owners can choose **Edit track** on the details page to edit the
title, description, activity, difficulty, tags and visibility in place. Save
commits the draft; Cancel and navigation warn before discarding unsaved changes.
Email reconfirmation is not required to manage existing tracks. The stored Track GPX
and derived measurements cannot be edited.

**Delete track** appears in edit mode and requires permanent-deletion confirmation.
Access ends immediately after the transaction commits. The scheduled
`pnpm files:cleanup` job removes queued original GPX files and retries storage
failures; their quota is released when cleanup removes the file record.
Deletion retains only owner/request/track identifiers to prevent a delayed retry
of the original upload from recreating the track. There is no undo. Sibling Tracks, files and later edits remain independent; deleting
one output invalidates the original upload attempt and its collection confirmation.

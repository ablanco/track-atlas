# Tracks, maps, and external editing

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Tracks and public publication

`tracks/validation.ts` owns allowlisted metadata and the shared activity catalog.
Names/descriptions are trimmed plain text (200/5,000 Unicode code points); tags
are optional (0–10, up to 30 Unicode code points each) and
retain trimmed display spelling/order and deduplicate with NFKC plus
locale-independent lowercasing. Difficulty is uploader-selected 1–5. Visibility defaults
private; only explicit `private`/`public` values are accepted. Ownership/status
are never taken from the caller. Public selection warns that the unchanged
original exposes timestamps, author metadata, waypoints and extra locations,
plus the current uploader identity and avatar, even if not mapped. Both languages use
shared fields and radio groups. `activity-grid.tsx` presents the 16 activities as
single-select tiles in two columns on small screens and four from the `sm`
breakpoint. Each tile places a regular-weight Phosphor icon above its localized
name; terrain/snow badges distinguish related activities. Icons are decorative,
with labeled radios, arrow-key navigation, focus rings and selection checkmarks.
The form remains disabled until hydration, retains browser-held
input on recoverable errors, and focuses committed error summaries. Confirmed
successful uploads clear all draft fields, the file selection, tag/error messages,
and the request identity before navigating to details; visibility returns to
private. Returning through client navigation or browser history starts fresh,
even when Cache Components preserves the upload page.

The locale-aware upload page and UUID details page isolate request authentication
behind connection/Suspense boundaries. Generic static metadata never contains a
private Track name. Language navigation also has an outer Suspense boundary:
unknown Track IDs prevent resolving usePathname at prerender time. Details expose
metadata and full-data metric summaries, with lazy map/chart visualizations.
Collection navigation is provided by the explorer. Owners can enter inline edit
mode on the details page to replace title, description, activity, difficulty,
tags and visibility. GPX originals, geometry and calculated measurements are not
editable. A single Save commits all metadata and tags atomically; Cancel discards
the draft. Later saves overwrite earlier metadata without conflict detection.
Recoverable errors retain inputs and focus an error summary. Successful saves
return to read mode, announce success, and refresh request-time details; explorer
results requery on return using current popularity rankings. Both languages and
themes share the editor.

`PATCH /api/tracks/[id]` and `DELETE /api/tracks/[id]` use exact trusted Origin
and Fetch Metadata checks, private/no-store and nosniff responses. PATCH accepts
only the complete six-field metadata object in bounded UTF-8 JSON (32 KiB,
30-second body deadline), reusing upload validation. Authentication is checked
before body ingestion and rechecked with user-before-session locks inside each
mutation. Only the active signed-in owner can mutate; email reconfirmation is
not required for existing tracks. Foreign and missing tracks return 404.
Ownership, originals, derived metrics and privilege fields are never accepted.
Visibility applies to subsequent requests for every track resource; downloaded
copies cannot be recalled. Public drafts display the upload disclosure and
private drafts explain this limitation before saving.

`tracks/deletion.ts` owns the internal `deleteLockedTrack` lifecycle shared by
owner deletion in `tracks/service.ts` and Administrator deletion in
`admin/mutations.ts`. It retains the upload identity, withdraws attached photos,
deletes the Track with its cascades, and queues the GPX original for cleanup.
Callers authorize and lock accounts, sessions and target Tracks in their existing
order, own the transaction, and preserve their distinct missing-target/retry
errors. The lifecycle neither opens a transaction nor accesses physical storage;
Administrator batches commit or roll back together, including earlier lifecycle
work when a later target fails. The existing file cleanup handles originals and
all photo versions after commit, retaining retryable quota-accounted records on
storage failure and photo deletion records for the 24-hour late-write window.

Shared lifecycle acceptance in `tests/db/photos.test.ts` exercises both existing
caller interfaces against migrated development PostgreSQL and private local
storage: photo-bearing Tracks, retained identities, delayed creation retries
before and after cleanup, storage failure/retry, quota retention and owner
acknowledgement retries. `tests/db/admin-mutations.test.ts` additionally checks
missing-target and later database-failure rollback of Track/photo state,
identities, memberships and derived-data cascades.

Edit mode exposes Delete track, with a modal naming the saved track and an
explicit irreversible confirmation. Deletion atomically removes the Track and
its cascading derived data/tags/upload receipt, queues the original file as
`deleting`, and retains only owner/request/track identifiers in
`deleted_track_uploads`. The new table has database audit defaults and an update
trigger. These identifiers survive physical file cleanup to reject delayed
creation retries; deleting again with the same owner and track ID is safe after
a lost acknowledgement. A deliberate upload with a new request ID remains valid.
The scheduled file cleanup removes the original and frees quota; storage failures
leave retryable metadata. No storage credentials are needed to edit or queue
deletion. Success returns to the owner's collection; failure or dialog dismissal
preserves the edit draft. Save and Delete cannot run together.

Cancel and outgoing link navigation ask before discarding dirty drafts. Reload
and tab closing use the browser's beforeunload warning where supported; the
Navigation API guards cancellable history traversal, with a capture-phase
popstate fallback restoring the current page when traversal cannot be cancelled.
Without the Navigation API, one reusable same-page history guard entry keeps a
normal Back press on the editor until the owner decides; legacy browsers may
therefore need an extra Back press after a clean edit. Confirmed navigation clears
edit mode and draft UI. Navigation API confirmation/cancellation is synchronous;
its draft UI reset runs in a microtask because Next's history writes can dispatch
the event during React's insertion effects. Public/private disclosures, validation and
confirmation dialogs are localized and use semantic theme tokens.

The details header places the shared activity icon at 32px inside a 56px muted
tile to the left of the title;
its localized activity name opens on hover, keyboard navigation, or click/tap
using the same hint component as explorer entries.
The details header shows the original-GPX download link only for a validated
current session. Guests see a localized Log in to download button that opens the
existing login/recovery dialog on the same page. The download service also
requires a validated active session before looking up the Track or reading storage.
Missing, malformed, unknown, expired, revoked and inactive-user sessions receive
401 without revealing Track existence. Email confirmation is not required to
download. Authenticated users can download public Tracks; private originals remain
owner-only, with inaccessible resources returning 404.

`tracks/service.ts` is the public creation/read/download boundary. Active,
confirmed eligibility is checked before reading/processing and rechecked under
user-before-session locks at publication for both visibility choices. The central
read query requires an active owner and ready same-owner GPX original, plus either
public visibility or a valid owner session. Guests, foreign and expired/revoked
sessions can read public Tracks, but not private ones. Missing, foreign-private
and inactive-owner resources are indistinguishable. Details, geometry, chart
samples and track-scoped avatars all use this contract; originals additionally
require an active viewer session as described above. Deactivation
hides every resource on subsequent requests without deleting Track data. No shared auth
cache or raw storage URLs are used. The details DTO excludes source keys/hashes,
email and full surname by default. Identity is read afresh: current display name,
else first name plus surname initial. Details include an initials fallback and
`GET /api/tracks/:id/avatar`, serving only the current derived 128px WebP.
That endpoint checks same-owner avatar purpose, readiness, storage location,
size/SHA-256 and current-avatar association; it rechecks association and Track
access after storage reads. Absent, legacy, replaced or removed images never
fall back to originals. Storage faults fail closed and the UI retains initials.
No client-selected file ID or size is accepted, and generic file/avatar routes
remain owner-only. All Track HTTP responses use private/no-store; localized
details additionally receive no-referrer/noindex headers from the proxy. No shared
image optimizer or auth cache serves these resources. Data/download routes use private/no-store and
nosniff; originals additionally use attachment and sandbox headers and retain
byte-count/SHA-256 integrity checks.

`POST /api/tracks` uses exact trusted Origin and Fetch Metadata checks, bounded
multipart ingestion (11 MiB total, 10 MiB GPX) and a 30-second body deadline.
Unknown/duplicate fields, non-allowlisted visibility and invalid metadata are rejected.
Visibility participates in the payload fingerprint, so changing it cannot reuse a
previous request identity. Private requests retain the pre-publication canonical
metadata shape (visibility omitted), preserving retries of existing attempts;
public requests include explicit visibility and cannot match private attempts.
A stable UUID request ID is bound to owner plus canonical metadata/file digest;
concurrent retries cannot create duplicates, mismatched reuse is rejected, and a
lost acknowledgement can recover the committed Track. This is request idempotency,
not global GPX deduplication: intentional new requests may reuse a file.

Parsing and WGS84 calculations run in a bounded Node worker. The plain CJS engine
is shared by pure known-answer tests and native execution; Next/Turbopack can
bundle the worker and its imports. Binary input is nested inside a workerData
object because Turbopack merges forwarded globals into the top-level envelope.
The worker interrupts synchronous CPU work after ten seconds, has V8 old/young/
stack bounds of 128/16/4 MiB, and admits two workers per application process.
V8 bounds are not an absolute RSS limit; upstream and host resource controls are
still required. Native worker assets/dependencies are explicitly traced; dev and
production uploads must be checked when changing packaging or framework versions.

GPX accepts UTF-8 1.0/1.1 with existing hostile-XML limits, exactly one track and
one segment, up to 100,000 positions and at least two distinct positions with
positive recorded length. Reject routes/multiple segments rather than inventing
connections. Preserve all coordinates/order and original bytes; ignore metadata,
waypoints/extensions for derivation and never fetch embedded URLs. Loops/repeats
are valid. GeographicLib supplies WGS84 distances and edge interpolation for the
five variants with 0/1/3/4/5 equal-recorded-distance intermediate points.
Directionless edges are flagged rather than assigned fake bearings.

Full geometry is a PostGIS SRID-4326 LineString. Ordered JSONB samples record
cumulative distance, optional elevation and usable interval-average speed.
Recorded duration includes stops and requires complete increasing timestamps with
usable timezones; missing/bad timing creates unavailable duration and speed gaps.
Ascent/descent sum raw elevation deltas only for complete elevation; partial
min/max and samples carry coverage via sample count. No smoothing, moving-time
inference, zero-fill or external elevation enrichment is applied.

Details expose the persisted duration, ascent/descent, min/max elevation and
sample coverage through the existing authorized details DTO. The details page
has a 1,152px maximum width and orders content as title/download, main statistics,
map, elevation chart, interval-average speed chart, description, optional tags,
and secondary metadata (including uploader identity). The uploader block displays
the existing 128px avatar version at its native size, with larger name text and
wrapping for narrow screens; initials retain the same footprint when unavailable. The five main statistics
are length, difficulty, elevation range, ascent and descent: one row from the
`lg` breakpoint, wrapping on smaller screens. Elevation range is computed from
persisted maximum minus minimum, not cumulative ascent; partial coverage is
marked beside the value and explained above the elevation chart. Absent values
remain unavailable, not zero. Empty tag sections are omitted and description
text stays within a readable measure. Metric/map explanations use keyboard-
accessible native disclosures, while missing-data and failure notices stay
visible. Additional metadata retains visibility, upload date, point count,
elevation extrema and recorded duration. Server-rendered
English/Spanish summaries distinguish null (unavailable) from zero and explicitly
label absent/partial elevation coverage. Distance uses metres below one kilometre
and kilometres otherwise; elevation uses metres. Recorded duration uses localized
elapsed hours/minutes/seconds, not a timezone-dependent Date, and includes stops.
The UI explains completeness requirements and raw, unsmoothed GPS noise.
`getTrackSamples` applies the same centralized access query but selects only
samples, not the large GeoJSON geometry. A separate Suspense boundary streams
chart preparation independently of metadata/downloads. The server maps elevation
and interval speed to cumulative-distance series and converts speed from m/s to
km/h. Each speed is a constant over its preceding interval, including zero for
stops; every speed-change boundary is retained to avoid inventing ramps across
omitted intervals. Consecutive exactly equal speeds (or missing intervals) can
be coalesced without changing their constant value or gap extent. Elevation uses a display-only min/max envelope, retaining bucket
endpoints, extrema separately within each uninterrupted run, and both sides of
every gap. The target is roughly 1,600 values, but fragmented recordings may
exceed it. Both charts render at most 1,600 values at once using overlapping,
keyboard/touch-navigable sections; all full-data metrics and persisted samples
remain unchanged. Chart payload size still scales with input fragmentation and
speed interval count, bounded by the 100,000-point ingestion limit.

shadcn Chart with pinned Recharts 3.8.0 loads lazily behind a client error boundary.
Charts have keyboard tooltips with localized live-region announcements, axis
labels/units, visible focus, theme tokens and no animation. Gaps are never
connected or zero-filled; isolated samples remain visible. Missing data has
explicit states, and chart-library failures offer reload without hiding metadata
or original downloads. Only chart distances/values are serialized, not full
geometry, account data, or GPX extension telemetry. No external chart requests
or additional credentials are required.

A local Chromium development performance gate covers complete and alternating-
elevation-gap 100,000-point recordings. One complete-data run measured a 13.82 MB
decoded details document, 3.31 seconds to rendered charts, 68 ms keyboard tooltip
interaction, a 62.8 MB JS heap snapshot, and 173 SVG descendants. The fragmented
case measured a 5.47 MB document, 2.05 seconds to charts, 424 ms section navigation,
and 886 SVG descendants (800 isolated samples). These are local observations,
not device/network guarantees; speed-rich pages can transfer large payloads even
though per-section rendering is bounded. Tests attach benchmark artifacts and
assert bounded SVG cardinality and sub-two-second interaction on the test host.
Playwright defaults to two browser workers to avoid oversubscribing processing
and concurrent development compilation. Track tests also run sequentially within
their file. Chart section controls and keyboard interactions remain disabled
until hydration so a large streamed payload cannot silently discard early input.
Automated email delivery stays capture-only.

### Interactive original-point map

`components/track-map.tsx` isolates dynamic browser-only rendering behind a client
error boundary. The MapLibre/react-map-gl chunk and package CSS load locally;
MapLibre's bundled worker uses a blob URL, verified with Turbopack. The pinned
pair is MapLibre GL JS 5.24.0 / react-map-gl 8.1.3 (v8's MapLibre entry point
supports MapLibre v4+). Renderer teardown removes per-map GL/source resources;
MapLibre retains a bounded shared worker for its global RTL dispatcher. Client-navigation tests observe
per-map release messages and verify that the worker pool does not grow. Activity
hide cleanup clears private geometry/loading state synchronously and detaches the
context-loss listener before deliberate teardown; returning reauthorizes geometry.
Changing theme does not replace the map or resubmit its geometry.

The renderer fetches existing `GET /api/tracks/:id/data` at request time with
same-origin credentials and no-store. This retains the centralized ready-file,
active-owner and visibility/owner-session policy; no private geometry is prefetched in a public
shell. The browser validates finite/bounded coordinates, uses every original
position/order/repetition in its GeoJSON source with source tolerance zero, and
never requests Directional representations. A display-only nearest-world-copy
longitude adjustment keeps dateline crossings local; persisted geometry and
original downloads are unchanged. Mercator clips polar latitudes beyond 85.05°;
a localized notice explains this without changing the source latitudes.

The **Outdoors** basemap uses an independently authored vector style
from `tracks/outdoor-style.ts`. A native selector with a screen-reader-only **Basemap** label also
offers **Street**, using OpenFreeMap's hosted Liberty style, and **Topographic**, the
restored OpenTopoMap raster style in `tracks/topographic-style.ts`. Outdoors uses OpenFreeMap's `/planet` TileJSON and fonts, with a distinct `outdoor`
source ID for error isolation. Its curated layers emphasize wood/grass/water,
protected-area boundaries, cased brown tracks/paths with different dash patterns,
peaks with available elevations, places and named outdoor POIs. Roads and buildings
are subdued. Names prefer the route's English/Spanish locale and fall back to
local/Latin names. No sprites or external icons are used. **Dark** uses the same feature layers,
localized labels and provider data with a dark palette and a distinct `dark`
source ID for error isolation. All basemaps are 2D; Outdoors and Dark do not
include contours or hillshade.
Topographic uses 256px HTTPS raster tiles with baked-in trails, contours, shaded
relief and labels (native zoom 1–17), under a distinct `topographic` source ID.
Neither raster relief nor basemap labels change recorded elevations or analytics.
Mapbox Satellite is an optional basemap enabled only when `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured. It uses Mapbox Satellite TileJSON with `secure=true` through MapLibre's raster source, preserving provider-supplied attribution and requesting HTTPS tile templates. The `satellite` source ID matches the selector value so active-source errors are not mistaken for stale errors. Satellite imagery and 3D terrain do not change recorded elevations or analytics.
Source features and availability are limited to the provider's published schema
and per-zoom contents (currently native maxzoom 14). Styling cannot invent missing
OSM features or establish access rights, route membership or difficulty. Peak-label
elevations are basemap context, never recorded-track samples or analytics. Basemap changes use the renderer's
React style binding, not a map remount or imperative style replacement; camera,
markers and full-geometry overlays survive. `components/use-basemap.ts` shares
selection across explorer and details maps. With no manual preference, selection
follows the resolved site theme (including system changes): Outdoors for light
and Dark for dark. A manual choice is stored under `track-atlas-basemap` in
browser local storage, surviving navigation, reloads, locale and theme changes.
Same-page and cross-tab changes update mounted maps. This is a browser preference,
not an account preference; there is no automatic-mode or reset control. Invalid
values and Satellite preferences without a configured token fall back to theme
defaults. If browser storage is blocked, manual choices remain usable in memory
for the page lifetime.
Only the selected style's sources are active, with no bulk/offline downloading.
Street/Outdoors/Dark retain source-supplied OpenFreeMap/OpenMapTiles/OpenStreetMap
linked credits; Topographic retains linked OpenStreetMap, SRTM/Viewfinderpanoramas,
Sonny, OpenTopoMap and CC BY-SA 3.0 credits, including on mobile and fullscreen.
Both providers have no SLA. OpenTopoMap permits embedding but is volunteer-hosted
with limited capacity and variable regional completeness; contact maintainers
before material public traffic. No backup-server substitution is performed.
OpenTopoMap is contacted only when Topographic is selected; Mapbox is contacted only when Satellite is selected. Distinct text start/end markers combine for closed loops.
Semantic-theme shadcn controls with Phosphor icons provide 44px zoom/fit/fullscreen
buttons. Plain mouse-wheel zoom is enabled without Ctrl/Cmd; wheel capture and
bubble handlers temporarily disable and restore MapLibre's cooperative gesture
gate using its public API, so two-finger touch panning remains protected even on
hybrid devices. Rotation is disabled, and keyboard focus can leave the canvas.
Attribution links inherit semantic foreground color in both themes. Browser tile/style/glyph/sprite
requests disclose IP/viewed area, but omit referrers and carry no GPX, track
metadata or account data. No embedded GPX URLs are fetched. The provider has no
SLA, and can have missing point-of-interest sprite warnings independently of
successful basemap rendering.

Geometry requests have a 20-second abort deadline, initial map loading a
25-second deadline. Data/library/worker/WebGL/initial-provider failures show
localized reload guidance inside the map section; metadata, charts and original
downloads remain independent. Outdoors/Dark/Topographic/Satellite tile failures or a 25-second
style-switch timeout instead keep the map, recorded path and selector mounted
with a visible localized alert: choose Street to recover, or switch away/back to
retry. Late errors from a removed optional source do not fail Street or the other
optional basemap. Switching
back to Street retains the existing general map failure behavior if Street itself
fails. No server/provider keys, remote JS/CSS, public storage URLs or database
changes are needed. Deployment CSP must permit blob workers and OpenFreeMap asset
connections plus `https://tile.opentopomap.org` for Topographic and `https://api.mapbox.com`, `https://a.tiles.mapbox.com`, `https://b.tiles.mapbox.com` for Satellite. See the [map deployment notes](../operations.md#track-maps).

Browser tests substitute deterministic external provider assets, not the renderer
or worker. They observe source coordinates at the actual browser-worker boundary,
check section order, responsive statistics, partial/absent elevation range,
keyboard disclosures, plain-wheel zoom without page scrolling, real CDP one-
and two-finger touch gestures, endpoints, attribution/fullscreen, loops/repeats, high-latitude
and dateline bounds, both languages/themes and mobile/desktop, plus locale-aware
client navigation away/back and to a different Track. HTTP tests retain
full original coordinates and indistinguishable guest/foreign/expired/revoked/
inactive denial. Street/Outdoors/Topographic tests also check keyboard selection,
absence of optional-provider requests
before selection, camera/geometry stability, complete attribution, theme and
fullscreen behavior, tile failure/retry, switch timeout and late-cancellation
recovery across both optional layers. Topographic uses a deterministic raster
fixture and style-spec validation. Outdoors assets use an invented vector-tile fixture (no real geographic
data) and empty glyph sets; unit tests validate the style and evaluate localized
labels and feature filters using the pinned MapLibre style-spec dev dependency.
Font-failure coverage also verifies the pinned renderer's local glyph fallback
keeps the map usable. An opt-in live-provider check renders all three styles,
including real Outdoors vector tiles/fonts and OpenTopoMap raster tiles in a
synthetic Pyrenees track scene. No provider
receives GPX data.
A local 100,000-point run measured a 11.08 MB decoded geometry+samples response,
5.85 seconds from navigation to map/source inspection, 180 ms zoom+fit, and a
101.4 MB main-thread JS heap snapshot (including charts and test instrumentation;
not GPU/worker memory or a total RSS bound). The details document was 13.83 MB.
These are host-specific observations, not low-end-device guarantees. The test
asserts all 100,000 worker-source coordinates and sub-two-second controls, without
reducing the source to sampled variants.

New tables are tracks, track_data, track_tags, track_directional_representations
and track_upload_attempts. All have audit columns/update triggers; geometry/tag
indexes, metric/value/coverage checks and unique file/request/variant keys enforce
meaningful invariants. Deferred publication triggers require owned ready GPX,
complete data, five variants, contiguous tags when supplied and a matching committed
attempt result. Attached source metadata is immutable; the generic file deletion
service rejects attachment before object removal, with database guards as defense
in depth. Migrations 0010/0011 add these tables and publication constraints;
migration 0013 permits publication with zero tags without relaxing other checks.

`storage/quota.ts` centralizes account usage and capacity checks for both file
and Track reservations, including avatar-version byte accounting. Callers hold
the owner row lock in the reservation transaction, preserving shared quotas
across both entry points.

Creation reserves storage under existing account quotas, derives/writes outside
long database transactions, then atomically publishes the ready file plus Track,
data, tags, variants and result. Pending attempts are fenced by their current
file reservation and expiry. Failure abandons only still-pending files; a failed
COMMIT acknowledgement cannot remove an already-ready original. Expired pending
files follow existing repeated cleanup/late-write protection, with attempt rows
removed by file cleanup cascades; ready attached originals are protected.

Track verification adds pure parser/metadata/execution tests, real PostgreSQL/
private-object-store/HTTP tests (including lost-COMMIT acknowledgement, stale
attempts, SQL constraints/audit and upper-limit publication), and localized browser
flows for validation, retry retention, eligibility, access and original integrity.
The real HTTP browser probe catches worker/bundler regressions missed by native
unit tests. Public publication verification includes the guest/owner/foreign/session access
matrix, current derived-avatar replacement/removal/integrity, unchanged downloads,
private-default versus explicit public upload and warning, live identity refresh,
and deactivation hiding in both languages/themes and desktop/mobile. Migration
0012 permits only private/public visibility while retaining the existing classification
constraints; no storage publicity or account/session mutations were introduced.

### GPX Studio handoff

The track toolbox offers a PencilLine “Edit in GPX Studio” link to signed-in
users, including unconfirmed accounts, for every track they can download. Guests
receive a localized login control, matching GPX download. Opening the link calls
`GET /api/tracks/:id/gpx-studio?locale=en|es` and redirects a new tab to
`https://gpx.studio/:locale/app?files=...`. It opens a copy of the original GPX;
changes are not saved back to Track Atlas.

The handoff mints a ten-minute, track-specific capability on click, rather than
embedding expiring links in page HTML. HMAC-SHA256 uses the high-entropy session
token digest as its server-only key, with a versioned GPX Studio purpose, session
ID, track ID and database-derived expiry in the signed message. The capability
contains no session credentials or storage keys. No new secret or table is
required. Its expiry never exceeds the session expiry. It is reusable during its
lifetime to support editor fetch retries.

`GET /api/tracks/:id/gpx-studio/:key/track.gpx` verifies the capability and
rechecks the active session, active viewer/owner, current public-or-owner access,
and ready original file before reading storage and checking size/SHA-256.
Logout, session expiry/revocation, deactivation, deletion, and a public-to-private
change that removes the viewer's access invalidate the link. Invalid links and
inaccessible tracks share a not-found response. The filename remains
`track.gpx`, so GPX Studio does not use the capability as the imported filename.
The file endpoint requires no cookies and permits CORS only for
`https://gpx.studio`, without credential sharing. Redirect and file responses use
private/no-store caching and no-referrer policies. Treat capability URLs as
temporary bearer secrets. Next.js development request logging excludes this file
route; infrastructure access logs must likewise exclude or redact it.

Database tests cover scope, expiry, revocation, private/public access, integrity,
and HTTP/CORS behavior. Browser coverage verifies localized toolbox links, a new
tab handoff and cookie-free GPX delivery against a stubbed external editor.

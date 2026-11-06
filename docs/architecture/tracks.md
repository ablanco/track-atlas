# Tracks, maps, and external editing

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Tracks and public publication

### Multi-track processing, publication and preview contract

The parser/worker and authenticated upload service support independent GPX
tracks. The localized form previews all output titles before submission and
opens the owner's collection on multi-track success. Existing `parseGpx` and `processGpx` retain their singleton return
shape; creation uses `processGpxDocument` to validate the entire document.

`tracks/gpx.ts` exports `parseGpxDocument(Uint8Array)` (pure test seam) and
`processGpxDocument(Uint8Array)` (request-handler seam). Both return
`ProcessedGpxDocument`: `{ tracks: { trackIndex, data, gpx }[] }` in document
order. `trackIndex` is zero-based; `data` is the existing version-2 `ProcessedGpx`
with independently reset samples, segment offsets, measurements and five
representations per segment; `gpx` is a `Uint8Array` ready for independent quota,
hash and storage accounting. A singleton copies the exact submitted bytes.
Multiple tracks receive standalone GPX documents containing their verbatim
selected XML subtree, inherited namespace bindings, original GPX version and a
fixed creator. Other root attributes, document-wide metadata, waypoints,
extensions and sibling tracks are excluded. Recorded values and track-local
extensions are never rebuilt from derived geometry. QName namespace bindings
are retained even when extension text spans ordinary text and CDATA.

One SAX parse enforces 10 MiB, 100 tracks, 100 segments total, 100,000 points total,
500,000 elements and depth 64 for the whole input. Routes reject even alongside
tracks; empty/invalid tracks or segments reject the whole result. Track errors
carry safe one-based `TrackError.track` and, for invalid segments,
`TrackError.segment` local to that track. `tooManyTracks` is an additional error
code. XML/limit errors never include source text. All worker APIs share the
same two-worker admission limit, ten-second wall deadline and 128/16 MiB V8
old/young heap and 4 MiB stack bounds; no track gets a separate worker budget.

`tracks/gpx-preview.ts` is browser-safe and exports `GPX_LIMITS`,
`generateTrackTitles(title, trackCount)` and `previewGpxUpload(bytes, title)`.
Titles take an already metadata-validated base: a singleton is unchanged; all
multiple-output titles get a space and one-based ordinal, shortening only the
base to fit 200 Unicode code points. Preview returns `{ trackCount, titles,
firstPhotoTrackIndex: 0 }`, with zero-based photo destination. It shares the
bounded structural scanner but skips geodesic derivation, so it does not
establish positive segment length or server validity. The form runs file reading
and scanning in a browser Web Worker with a ten-second deadline; file/title changes and Activity cleanup terminate it and fence late
replies. Only a preview matching the current File and title enables submission.
The generated-title list is bounded to 100 entries in a keyboard-scrollable area.
The server independently validates through `processGpxDocument` and uses shared
title generation. HTTP and preview errors display only allowlisted localized
messages and safe one-based track/segment ordinals; `tooManyTracks` maps to 422.

`createTrack` and `POST /api/tracks` return `{ id: string, ids: string[] }` for
both singleton and multi-track creation. `ids` is nonempty, in document order,
and contains at most 100 IDs; `id === ids[0]` preserves existing callers. Success
and replay both use HTTP 201 with private/no-store headers. The singleton title
and stored/downloaded bytes are unchanged. Multiple outputs use
`generateTrackTitles`, copy description/activity/difficulty/tags/visibility,
and receive independent files and derived datasets. Staged photos, captions and
order attach only to `ids[0]`. Each file's actual isolated byte count and SHA-256
are persisted; the original multi-track document is never written to storage.
Existing download integrity, session/legal gates and access rules apply to each
output independently. Waypoints and document-wide metadata are absent from
multi-track downloads.

Creation checks authorization before reading, resolves existing receipts before
worker admission, validates the complete document in one bounded worker, then
reserves all output files in a single owner-locked transaction. Publication
reauthorizes and commits all files/Tracks/derived data/tags/photos and the ordered
receipt together. Any storage or database failure publishes no subset; cleanup
withdraws only still-pending files and attempts every temporary key, preserving
staged photos. Uncertain publication acknowledgements leave ready files intact;
the caller must retry the same request identity and content to resolve them.
A live attempt returns `processing` (409, Retry-After 2); changed fingerprint
returns `conflict` (409). Successful retries return the original ordered IDs even
after independent metadata edits. Deleting any output changes the receipt to
`deleted`, scrubs its fingerprint/file/first-Track references, and retains only
ordered output identities plus audit timestamps. Every deletion adds an
owner/request/deleted-Track tombstone. Retries then return `notFound` (404), even
after file cleanup and deletion of all siblings. New deliberate submissions
require a new request ID. Later metadata, visibility and deletion are independent.

Singleton success opens details. A validated `{id, ids}` response with multiple
outputs opens the owner's locale-aware collection with `?created=<requestId>`.
The query contains no output IDs or count. `getTrackUploadResult` authorizes the
current owner/session/legal acceptance, looks up their committed receipt, and
requires the entire ordered output set to remain ready and present. Only that
safe projection supplies a localized success toast containing only the created
count, independently of explorer pagination. The collection explorer sends
`created` as an owner-authorized upload scope, separate from normal filters, so
only that upload’s Tracks appear. Filters, pagination and reload preserve the
scope; View all tracks returns to the full collection. Missing, foreign, deleted and incomplete
attempts show no confirmation; arbitrary query IDs/counts cannot reveal private
data. No output links or titles are rendered in the toast.
The form retains its File, shared metadata, staged photo order/captions and request
identity on failure. A transport failure, unavailable acknowledgement or live
processing response keeps editing disabled until the same exact submission is
resolved. Retry retains original photo identities even after the local lease
expires, allowing committed receipts to resolve without duplicate publication.
A definitive rejection enables correction again; expired uncommitted photos
still require a fresh upload through the picker. Preview count/titles are
advisory: server results remain authoritative. No client cleanup removes outputs
after a missing response.

`tracks/validation.ts` owns allowlisted metadata and the shared activity catalog.
Names/descriptions are trimmed plain text (200/5,000 Unicode code points); tags
are optional (0–10, up to 30 Unicode code points each) and
retain trimmed display spelling/order and deduplicate with NFKC plus
locale-independent lowercasing. Difficulty is uploader-selected 1–5. Visibility defaults
private; only explicit `private`/`public` values are accepted. Ownership/status
are never taken from the caller. Public selection warns about the current
uploader identity/avatar and downloadable GPX contents: singleton files remain
unchanged and can expose metadata, waypoints and locations beyond the map;
multi-track outputs isolate each Track but retain names, timestamps and track-local
extensions. The UI never promises complete metadata removal. Both languages use
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
behind connection/Suspense boundaries. Request-time metadata uses anonymous public authority and never contains a
private Track name. See [search discovery](presentation.md#search-discovery-and-link-previews)
for canonical links, previews, structured data and sitemap eligibility. Language navigation also has an outer Suspense boundary:
unknown Track IDs prevent resolving usePathname at prerender time. Details expose
metadata and full-data metric summaries, with lazy map/chart visualizations.
Collection navigation is provided by the explorer. Owners can enter inline edit
mode on the details page to replace title, description, activity, difficulty,
tags and visibility. Track GPX files, geometry and calculated measurements are not
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
its cascading derived data/tags,
queues its independent GPX as `deleting`, invalidates the attempt receipt, and
retains owner/request/track identifiers in `deleted_track_uploads`. Existing
audit defaults and update triggers remain in force. These identifiers survive
physical file cleanup to reject delayed
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
The details header shows the Track GPX download link only for a validated
current session. Guests see a localized Log in to download button that opens the
existing login/recovery dialog on the same page. The download service also
requires a validated active session before looking up the Track or reading storage.
Missing, malformed, unknown, expired, revoked and inactive-user sessions receive
401 without revealing Track existence. Email confirmation is not required to
download. Authenticated users can download public Tracks; private Track GPX files remain
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
details additionally receive no-referrer headers from the proxy, with noindex
unless public eligibility and the deployment opt-in permit indexing. No shared
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
lost acknowledgement can recover the complete committed Track set. This is request idempotency,
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

GPX accepts UTF-8 1.0/1.1 with the upload-wide hostile-XML limits, 1–100 tracks,
1–100 segments total, up to 100,000 recorded positions total and 10 MiB. Every
segment needs at least two positions and positive recorded length; an empty,
singleton or stationary segment rejects the entire upload with one-based Track
and local segment positions. Routes remain unsupported, including mixed inputs.
Coordinates, document order and repeated/shared endpoints survive per-Track
extraction. Only singleton originals retain all original bytes; multi-track
outputs use the isolated XML contract above. Derivation ignores metadata,
waypoints/extensions and never fetches embedded URLs. Loops are valid.
GeographicLib supplies WGS84 distances and edge interpolation independently for
each segment's five variants with 0/1/3/4/5 equal-recorded-distance intermediate
points. Directionless edges are flagged rather than assigned fake bearings.
No distance, elevation delta, speed interval or search edge crosses a boundary.

Full geometry is a PostGIS SRID-4326 MultiLineString, including singleton Tracks.
The data API returns `{geometry, samples, segmentStarts, waypoints}` (see
[retained waypoints](#retained-gpx-waypoints-on-details-maps)): ordered flat JSONB
samples hold cumulative distance, optional elevation and interval-average speed;
`segmentStarts` holds zero-based sample offsets, beginning at zero, one per part.
Each segment starts at the preceding segment's ending cumulative distance with
null speed. Geometry parts and sample slices have matching point counts.
Recorded duration sums elapsed time within segments, retaining stops and excluding
gaps between segments. It requires complete strictly increasing timestamps with
usable timezones within every segment; later segments may reset backwards or
overlap earlier timestamps without changing document order. Missing/bad timing
makes duration unavailable and creates speed gaps. Ascent/descent sum only
within-segment raw elevation deltas and require complete elevation across the
Track; partial min/max and samples carry coverage via sample count. No smoothing,
moving-time inference, zero-fill or external elevation enrichment is applied.

Details expose the persisted duration, ascent/descent, min/max elevation and
sample coverage through the existing authorized details DTO. The details page
has a 1,152px maximum width and orders content as title, main statistics,
map with its tools panel (including downloads, editing and voting), elevation chart, interval-average speed chart, description, optional tags,
and secondary metadata (including uploader identity). The uploader block displays
the existing 128px avatar version at its native size, with larger name text and
wrapping for narrow screens; initials retain the same footprint when unavailable. The main statistics
are popularity, length, difficulty, elevation range, ascent and descent: one row from the
`lg` breakpoint, wrapping on smaller screens. Elevation range is computed from
persisted maximum minus minimum, not cumulative ascent; partial coverage is
marked beside the value and explained above the elevation chart. Absent values
remain unavailable, not zero. Empty tag sections are omitted and description
text stays within a readable measure. Metric/map explanations use keyboard-
accessible native disclosures, while missing-data and failure notices stay
visible. Additional metadata retains visibility, upload date, point count, segment count,
elevation extrema and recorded duration. Server-rendered
Localized summaries distinguish null (unavailable) from zero and explicitly
label absent/partial elevation coverage. Distance uses metres below one kilometre
and kilometres otherwise; elevation uses metres. Recorded duration uses localized
elapsed hours/minutes/seconds, not a timezone-dependent Date, and includes stops.
The UI explains completeness requirements and raw, unsmoothed GPS noise.
`getTrackSamples` applies the same centralized access query but selects only
samples and segment offsets, not the large GeoJSON geometry. A separate Suspense boundary streams
chart preparation independently of metadata/downloads. The server maps elevation
and interval speed to cumulative-distance series and converts speed from m/s to
km/h. Each speed is a constant over its preceding interval, including zero for
stops; every speed-change boundary is retained to avoid inventing ramps across
omitted intervals. Consecutive exactly equal speeds (or missing intervals) can
be coalesced within a segment without changing their constant value or gap extent. Elevation uses a display-only min/max envelope, retaining bucket
endpoints, extrema separately within each uninterrupted run, and both sides of
every gap. The target is roughly 1,600 values, but fragmented recordings may
exceed it. Both charts render at most 1,600 values at once using overlapping,
keyboard/touch-navigable sections; all full-data metrics and persisted samples
remain unchanged. Chart payload size still scales with input fragmentation and
speed interval count, bounded by the 100,000-point ingestion limit.

Explicit null separators preserve both endpoint measurements even at a shared
endpoint/distance. Numbered dashed boundary markers and localized accessible
explanations distinguish segment breaks from missing measurements. Envelope
sampling and overlapping chart sections retain these breaks and relevant markers.

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
With a manual basemap choice, changing the UI theme does not replace the map or
resubmit its geometry. Automatic theme-based basemap switches can restore sources
when MapLibre changes styles, retaining the recorded coordinates and camera.

The renderer fetches existing `GET /api/tracks/:id/data` at request time with
same-origin credentials and no-store. This retains the centralized ready-file,
active-owner and visibility/owner-session policy; no private geometry is prefetched in a public
shell. The browser validates finite/bounded coordinates, uses every original
position/order/repetition in its GeoJSON source with source tolerance zero, and
never requests Directional representations. A display-only nearest-world-copy
longitude adjustment unwraps each segment independently and aligns it with a stable
Track anchor, preserving MultiLineString breaks and a shared Track color.
A single-segment Track shows localized Start and End markers (Start / end for a
closed loop). These labels are static and have no popover.
Tracks with multiple segments show numbered start/end markers with
keyboard/touch disclosures. All markers have localized accessible labels;
coincident endpoints share a marker listing all labels. An open endpoint
disclosure sits above neighboring markers.
Labels open on Enter and close on Escape with focus retained. Persisted geometry and
original downloads are unchanged. Mercator clips polar latitudes beyond 85.05°;
a localized notice explains this without changing the source latitudes.

The **Outdoors** basemap uses an independently authored vector style
from `tracks/outdoor-style.ts`. A native selector with a screen-reader-only **Basemap** label also
offers **Street**, using OpenFreeMap's hosted Liberty style, and **Topographic**, the
restored OpenTopoMap raster style in `tracks/topographic-style.ts`. Outdoors uses OpenFreeMap's `/planet` TileJSON and fonts, with a distinct `outdoor`
source ID for error isolation. Its curated layers emphasize wood/grass/water,
protected-area boundaries, cased brown tracks/paths with different dash patterns,
peaks with available elevations, places and named outdoor POIs. Roads and buildings
are subdued. Names prefer the route's selected locale and fall back to
local/Latin names. No sprites or external icons are used. **Dark** uses the same feature layers,
localized labels and provider data with a dark palette and a distinct `dark`
source ID for error isolation. All basemaps are 2D; Outdoors and Dark do not
include contours or hillshade.
Topographic uses 256px HTTPS raster tiles with baked-in trails, contours, shaded
relief and labels (native zoom 1–17), under a distinct `topographic` source ID.
Neither raster relief nor basemap labels change recorded elevations or analytics.
Mapbox Satellite is an optional basemap enabled only when `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured. It uses Mapbox Satellite TileJSON with `secure=true` through MapLibre's raster source, preserving provider-supplied attribution and requesting HTTPS tile templates. The `satellite` source ID matches the selector value so active-source errors are not mistaken for stale errors. Satellite imagery does not change recorded elevations or analytics; 3D terrain
remains deferred.
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
OpenTopoMap is contacted only when Topographic is selected; Mapbox is contacted only when Satellite is selected. Endpoint markers combine coincident positions, including closed loops.
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
complete data, five variants per segment, contiguous tags when supplied and a matching committed
attempt result. Attached source metadata is immutable; the generic file deletion
service rejects attachment before object removal, with database guards as defense
in depth. Migrations 0010/0011 add these tables and publication constraints;
migration 0013 permits publication with zero tags without relaxing other checks.
Migration 0024 preserves existing singleton data and adds the segment-aware
geometry, offsets, counts and representation keys; see [persistence](persistence.md).

`storage/quota.ts` centralizes account usage and capacity checks for both file
and Track reservations, including avatar-version byte accounting. Callers hold
the owner row lock in the reservation transaction, preserving shared quotas
across both entry points.

Creation derives outside long database transactions and reserves all outputs
under shared account quotas. It writes objects outside the publication
transaction, then atomically publishes all ready files, Tracks, derived data,
tags, variants and the ordered result. Pending attempts are fenced by their current
file reservation and expiry. Failure abandons only still-pending files; a failed
COMMIT acknowledgement cannot remove an already-ready original. Expired pending
files follow existing repeated cleanup/late-write protection. File cleanup
nulls the first-file pointer rather than cascading the receipt; request identity
protection survives cleanup and account erasure cascades receipts. Ready attached
originals remain protected.

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

### Retained GPX waypoints on details maps

`GET /api/tracks/:id/data` adds `waypoints: { position: [longitude, latitude],
name, description }[]` to the recorded-path response. `getTrackWaypoints` applies
existing active-owner/public-or-owner/session/legal access checks **before**
reading the Track's own ready private object, verifies byte size and SHA-256,
and extracts in the shared bounded worker. Guest public reads are permitted;
private and inaccessible Tracks retain the existing denial behavior. Responses
remain private/no-store, with no shared cache of private metadata. Explorer
queries and geometry endpoints never read or return waypoints.

Extraction happens on each detail data read, including retained singleton files
uploaded before this feature. There is no migration, background job or backfill
command. The cost is one bounded private-object read and structural SAX scan per
request; overload returns the existing processing-timeout response rather than
queuing unbounded work. `parseGpxWaypoints` is the pure parser seam;
`processGpxWaypoints` uses the same two-worker admission limit, ten-second wall
deadline, heap/stack bounds and upload-wide byte/element/depth/track/segment/point
limits as ingestion. It skips geodesic rederivation. Only root GPX-namespace
`wpt` positions and their immediate `name`/`desc` text are extracted. Invalid,
missing, non-decimal or out-of-range coordinates are skipped individually;
malformed XML and existing structural/resource failures still reject. Metadata
is bounded by the original 10 MiB input, without truncating valid text or points.
Multi-track retained outputs have no document-wide waypoints, as required by
ADR 0010; no discarded data is reconstructed. Downloaded bytes are never rewritten.

Details use regular Phosphor MapPin controls and semantic theme colors. Identical
geographic positions (including ±180° and pole aliases) share a popup listing their
waypoints in source order and all coincident segment endpoints. Names/descriptions
are React text, never interpreted as markup or used for resource requests. Blank
names use the localized fallback. Marker accessible names include waypoint
counts, endpoint labels and the first waypoint name. Popups focus their close
control, dismiss with Escape, Close or canvas click, and restore marker focus.
The popup card stays inside the map with a mobile-sized width and scrollable
content, avoiding clipped edge anchors without moving the camera. Activity/Track
navigation clears private waypoints and unmounts popup/page state alongside the map.

At most 100 geographic waypoint groups are mounted at once. Larger sets expose
explicit localized previous/next marker pages and a range/count; each popup lists
50 entries per page with the same controls. All valid waypoints remain reachable,
without an arbitrary marker or metadata truncation cap. Grouping aligns longitude
to the recorded path's world copy while grouping source coordinates without
rounding distinct nearby positions together. Initial bounds and Fit still use only recorded
path positions; off-path waypoints can be reached by panning/zooming (and by
selecting their marker page for large sets). Waypoints never enter geometry,
samples, measurements, charts or directional representations. Endpoint-only maps
keep their existing rendering.

### GPX Studio handoff

The track toolbox offers a PencilLine “Edit in GPX Studio” link to signed-in
users, including unconfirmed accounts, for every track they can download. Guests
receive a localized login control, matching GPX download. Opening the link calls
`GET /api/tracks/:id/gpx-studio?locale=<supported-locale>` and redirects a new tab to
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

### Sharing public Tracks

The toolbox places an outlined Share action below GPX Studio and above voting
for guests and signed-in viewers of public Tracks. The editor's saved title and
visibility drive sharing immediately after successful saves; draft edits do not
change the payload or reveal a private Track's control. The server supplies the
absolute localized details URL from the trusted configured application origin,
independently of request query parameters, fragments, or GPX Studio capabilities.
Sharing grants no additional access.

The client invokes native sharing directly during activation whenever the browser
supports the title/URL payload (including desktop browsers). Without native
support, it writes the URL to the clipboard and shows a localized success toast
only after that write succeeds. Repeated activation is disabled while either
operation is pending. Native cancellation is silent; other native errors show an
error toast and never copy automatically. Missing or rejected clipboard access
opens the shared accessible dialog with a selected, read-only URL, manual-copy
guidance, keyboard dismissal and focus restoration to Share. No file, photograph,
or description is attached; destination services may use existing social metadata.

Browser acceptance controls browser-native share/clipboard boundaries while
observing the actual toolbox, dialogs and toasts. It covers saved edits, guest
access, clean localized URLs, pending operations, cancellation/errors, both
languages/themes, keyboard use and hydration diagnostics.

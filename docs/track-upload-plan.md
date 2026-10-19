# Track upload and details — planning draft

Status: product decisions agreed during the requirements interview; technical
proposal below awaits final review. This is not implemented behavior or
authorization to start implementation.

## 1. Delivery scope

```text
User menu → Upload track → Validate and process → Track details
```

- Add a localized **Upload track** entry to the signed-in user menu.
- Use a dedicated upload page and shadcn/ui Base UI Vega components.
- Require track name, description, GPX file, activity type, difficulty, and tags.
- Add a public/private visibility control, defaulting to private.
- Require an active session and confirmed email for every upload.
- Process synchronously, with bounded input and execution: redirect only after
  the original, metadata, geometry, metrics, and directional representations are
  ready. No job queue or partially ready details page.
- Details include name, description, activity, difficulty, tags, visibility,
  uploader identity/avatar, upload date, interactive original-point map,
  distance/elevation/duration metrics, elevation/speed charts, and original GPX
  download.
- Public tracks are viewable/downloadable without signing in; private tracks
  are owner-only, including direct page, geometry, chart, and download requests.

Out of scope: search, a My tracks collection page, owner editing/deletion,
weather, votes, comments, external-editor integration, terrain/satellite imagery,
and chart-to-map hover synchronization. The user explicitly chose to defer even a
minimal collection list: users must retain their details URLs until collection
navigation is delivered. Private is still the upload default.

## 2. Form and classification

| Field       | Agreed rule                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Name        | Required, 1–200 characters after trimming; plain text                                                            |
| Description | Required, 1–5,000 characters after trimming; plain text with line breaks, no Markdown/HTML interpretation        |
| GPX         | Required, UTF-8 GPX 1.0/1.1, at most 10 MiB and 100,000 track points                                             |
| Activity    | One required choice from the catalog below                                                                       |
| Difficulty  | Required integer 1–5: 1 is least difficult, 5 most difficult, assessed by the uploader for the selected activity |
| Tags        | 1–10 distinct user-created tags, each at most 30 characters; trimmed and deduplicated case-insensitively         |
| Visibility  | Private/public, default private                                                                                  |

Activity catalog:

- Walking
- Hiking
- Road running
- Trail running
- Cycling
- Mountain biking
- Ski touring
- Cross-country skiing
- Snowshoeing
- Paddling
- Horse riding
- 4x4
- Road motorcycling
- Off-road motorcycling
- ATV/quad
- Other

Store stable activity identifiers and localize their labels. Activity labels and
difficulty do not imply legal access or guarantee safety. Tags and uploaded text
are not automatically translated.

### Proposed form details

- Use shadcn Field, Input, Textarea, Select, RadioGroup, Badge, Button, and Alert
  primitives as appropriate; retain Phosphor icons.
- Activity and difficulty start unselected, not silently defaulted.
- Use an accessible tag input with explicit add/remove controls. Enter adds a
  tag rather than submitting the form; announce additions/removals and associate
  field errors correctly. Commas need not split tags; multiword tags are valid.
- Count Unicode code points, not UTF-16 code units. Preserve trimmed tag display
  text; use NFKC normalization followed by locale-independent lowercasing for
  duplicate keys. Preserve first-entered order and display spelling.
- Show an explicit public-upload warning next to visibility and submission:
  publication exposes the original file, including timestamps, author metadata,
  waypoints, and other embedded locations, as well as the uploader identity.
- Do not upload on file selection. Submit the form as one logical operation.
- Keep text, classification, visibility, tags, and the selected File in browser
  memory on recoverable failure. A full reload or browser security restrictions
  may require reselecting the file; do not promise file restoration after reload.
- Guests get localized account-access guidance; unconfirmed accounts get
  confirmation guidance linking to Settings. Never rely on disabled UI for
  authorization.

## 3. GPX and geometry semantics

- Exactly one GPX `trk` containing exactly one `trkseg`.
- At least two distinct positions and a nonzero recorded path length.
- Reject multiple tracks, multiple segments (even touching segments), route-only
  documents, and any document containing `rte` elements. Give specific localized
  errors rather than merging or silently selecting one path.
- Closed loops are valid; coincident start/end positions do not mean the entire
  track has zero length. Repeated consecutive points must not cause division by
  zero.
- Metadata, waypoints, and extensions remain in the unchanged original but do
  not become map markers, chart series, or automatically published metadata.
- Preserve the original file bytes. Derive map/search/analytics data server-side
  from the single track segment, not from namespaced lookalikes in extensions.
- Validate coordinates and numbers as finite, in the supported WGS84 domain;
  reject invalid geometry rather than silently dropping points. Missing optional
  elevation/time is allowed. Exact parser validation details belong in the spec.
- Keep existing hostile-XML protections: no DTD/entity expansion, external
  resource fetching, processing instructions, or unbounded nesting/elements.
- Preserve every original track position and its order in the stored full
  geometry. The map must not use directional representations as display data.

The earlier interview decision to accept multiple segments is superseded by
this single-segment policy.

### Directional representations

Generate five variants with intermediate-point counts **0, 1, 3, 4, and 5**,
matching the existing product design. Do not silently add a two-intermediate-point
variant.

For a path of length `L` and `n` intermediate points, sample point `i` at recorded
path distance `i × L / (n + 1)`. Interpolate within the containing original edge;
do not select by timestamps, point count, or straight start/end distance.

Technical proposal: use WGS84-aware distance/interpolation, not planar distances
in longitude/latitude degrees. Version the derivation algorithm. Preserve loop
variants even when an entire variant or one of its edges has zero length; mark
it directionless rather than assigning an invented bearing. Future directional
search must ignore directionless edges. Search matching itself remains deferred.

## 4. Metrics and charts

### Agreed semantics

- Distance: horizontal length along the original recorded points, in metric
  units. No fabricated connection between disconnected segments; such files
  are rejected in this delivery.
- Recorded duration: elapsed time including stops, not inferred moving time.
  Because only one segment is accepted, this is last timestamp minus first.
- Whole-track duration requires complete, strictly increasing timestamps.
  Missing/non-increasing timestamps do not invalidate otherwise valid geometry.
- Speed: distance/time between consecutive points with usable increasing
  timestamps. No speed across missing or unusable timing intervals.
- Elevation and speed charts use cumulative recorded distance on the horizontal
  axis.
- Missing elevation/timestamps do not prevent upload. Show unavailable states
  and gaps, not fabricated values or externally fetched replacement elevation.
- Whole-track ascent/descent require complete elevation data. Partial charts
  may still show usable samples.

### Proposed calculation/display details

- Calculate ascent/descent by summing positive/negative consecutive elevation
  deltas without silently applying an undocumented smoothing threshold. Label
  these as GPX-derived estimates: GPS noise can inflate them.
- Minimum/maximum elevation may describe available recorded samples; label
  partial coverage explicitly. With no elevation samples, both are unavailable.
- Timestamps without a usable timezone must not be interpreted in the server's
  local timezone. Treat them as unusable analytics input.
- Speed chart values are interval-average derived speeds, not instantaneously
  measured device speed. Do not substitute extension telemetry silently.
- Use kilometres/metres, kilometres per hour, and localized duration formatting.
- Use shadcn Chart with Recharts, preserving chart accessibility and keyboard
  tooltips. Provide textual metric summaries even if charts cannot render.
- Do not connect chart lines across missing data. If performance requires
  display-only downsampling, preserve extrema and discontinuities, disclose it,
  and calculate all statistics from full data. Never downsample the source map
  geometry to the directional variants.

## 5. Map and details page

### Agreed map stack

- MapLibre GL JS through `react-map-gl`; verify and pin a compatible release pair.
- OpenFreeMap's hosted **Liberty** basemap, standard 2D, in both light/dark themes.
  Theme surrounding controls without pretending the basemap itself changes.
- Fit the track, distinct start/end markers, zoom and fullscreen controls.
- Render the original-point geometry, not the directional search aids.
- Retain required attribution. OpenFreeMap offers no SLA. Browser tile requests
  expose the viewer's IP and viewed area; GPX geometry stays on our application.
- A map failure must not make information, charts, or downloads unusable.

### Proposed layout and routes

- Upload: `/[locale]/tracks/upload`.
- Details: `/[locale]/tracks/[id]`, with an opaque UUID rather than mutable title
  slugs. Links remain locale-aware.
- Header: name, uploader avatar/name, upload date, visibility, download action.
- Classification: activity, numbered difficulty, tags.
- Large responsive map, followed by metrics, description, and the two charts.
  Use a single-column mobile layout, no sideways page scrolling.
- Keep visualization loading client-side/lazy while retaining server-rendered
  metadata and accessible fallback messages. Isolate map and chart failures.
- Do not send original GPX text, author metadata, email, or account details to
  the map provider. Never fetch arbitrary URLs found inside a GPX document.

### Uploader and visibility

- Show the uploader's current display name, falling back to first name plus
  surname initial, and current derived avatar; use initials if unavailable.
- No new public profile page. Do not expose email or full surname by default.
- Authorize derived-avatar display through the requested track. Avatar originals
  and the general owner-only avatar API remain private.
- Original GPX downloads obey track visibility on every request and retain
  integrity checks and safe attachment headers.
- An inactive owner immediately hides public details, geometry, charts,
  original downloads, and track-scoped avatars. Retain the data without deletion.
- Proposed read contract: return indistinguishable 404 responses for missing,
  foreign private, or inactive-owner tracks. Do not share-cache request-specific
  authorization or sensitive responses.

## 6. Proposed database model

Keep the original in the existing private object store and retain `stored_files`
as its lifecycle/quota/integrity record. Store structured geometry and derived
information in PostgreSQL/PostGIS rather than reparsing the original on reads.

| Table                               | Main data and relationships                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tracks`                            | UUID; owner FK; unique original-file FK; name; description; allowlisted activity identifier; difficulty 1–5; visibility; point count; distance; nullable elevation/duration metrics; derivation version; creation request identity; audit columns |
| `track_data`                        | One-to-one track FK; full ordered `LineString` geometry, SRID 4326; validated ordered chart samples/availability information in JSONB; audit columns                                                                                              |
| `track_tags`                        | Track FK; ordinal; display label; normalized key; unique normalized key and ordinal per track; audit columns                                                                                                                                      |
| `track_directional_representations` | Track FK; intermediate count restricted to 0/1/3/4/5; sampled geometry; directionless metadata; derivation version; unique variant per track; audit columns                                                                                       |
| `track_upload_attempts`             | Private operational bookkeeping for request identity, payload fingerprint, current reservation/lease, and completion result; used for idempotent retries, not a public processing page; audit columns                                             |

Important invariants:

- Owner identity always comes from the session. A client-provided owner ID or
  processing status is never accepted.
- A track's original must be an owned, ready GPX file and must not attach to
  multiple tracks. Enforce same-owner relationships and lifecycle safety with
  appropriate constraints plus locked service checks.
- Required fields, allowed activity/difficulty/visibility, sizes, finite metrics,
  geometry type/SRID, tag uniqueness, and variant uniqueness are validated at the
  server boundary and constrained in SQL where applicable.
- Original-file deletion while attached must be rejected by the generic file
  lifecycle; generic `DELETE /api/files/:id` must not become an undeclared track
  deletion API. Retain referential integrity and cleanup safety.
- Suggested indexes: owner/creation time, visibility as appropriate for future
  discovery, normalized tags, and GiST indexes for full/directional geometry.
  Adding spatial indexes does not implement search.
- Each table spreads a fresh `auditColumns()` and its migration attaches the
  database-maintained update trigger. Generate new migrations and metadata;
  never edit applied migrations.
- JSONB sample layout, upload-lease fencing, exact constraints, and migration SQL
  need precise definitions in the implementation spec; this table is the model
  proposal, not a migration ready to apply.

## 7. Proposed submission and failure contract

1. Render localized form with current account eligibility.
2. On submit, validate required metadata and selection locally for feedback.
   Send a stable creation-request identifier with this logical submission.
3. A bounded same-origin Route Handler receives metadata and GPX. Authenticate
   and check confirmed email before expensive processing. Enforce actual request
   size, not just declared length; avoid the default Server Action body-size
   limit for this 10 MiB file flow.
4. Validate/parse once and derive full geometry, metrics, chart samples, and all
   five representations. Bound CPU/memory as well as file bytes/point count.
5. Integrate with existing file reservations and private storage. Write objects
   outside long database transactions; never make the bucket public.
6. Recheck active/confirmed account and session under the existing lock order.
   Atomically finalize the ready file, track, tags, derived data, representations,
   and creation-request result. No track is readable before full publication.
7. Return the track ID and navigate to its locale-aware details page.

Retries of the same logical request must not create duplicate tracks, including
concurrent retries and a lost success response. Bind the request identifier to
its owner and a payload fingerprint; reject reuse with different content. A
separate intentional submission may upload the same GPX again. A failed attempt
must not delete an already committed ready file after an uncertain commit.

Partial failures leave no visible half-track. Abandoned reservations/objects
remain safely retryable or are handled by the existing cleanup lifecycle, with
appropriate extension for upload attempts. Session expiry produces account-access
feedback, not a successful upload; recoverable errors retain form input when the
browser permits it.

Reuse existing account storage limits (100 files, 250 MiB, two pending uploads)
unless deliberately revised later. These are not request-rate or CPU limits:
retain deployment-boundary throttling/concurrency responsibilities, measure
processing limits, and document any additional enforcement before shipping.

## 8. Verification and delivery proposal

### Tracer-bullet slices

1. **Core private upload-to-details:** schema, bounded single-segment parser,
   geometry/directional derivation, confirmed-session service, original lifecycle,
   minimal shadcn form, and owner-authorized details. Include original download
   and happy/rejection tests so this slice is usable end-to-end.
2. **Public visibility and uploader presentation:** anonymous reads, public
   warning, private/foreign denial, deactivation hiding, current display identity,
   and track-authorized derived avatar serving. Keep publication unavailable until
   all public access boundaries are ready.
3. **Interactive original-point map:** MapLibre integration, hosted basemap,
   start/end and navigation controls, attribution, themes/mobile, and failure
   fallback. This requires renderer/bundler compatibility and performance checks.
4. **Analytics presentation:** complete metrics, accessible elevation/speed
   charts, partial/missing data, performance safeguards, and visual verification.
5. **Hardening and closeout:** concurrency/idempotency/uncertain-commit failures,
   representative upper-limit GPX, security regressions, full suites,
   documentation, and two-axis review against standards and the approved spec.

These are proposed delivery boundaries, not published tickets. The final product
includes every agreed feature even when an intermediate slice does not.

### Acceptance coverage

- Real GPX 1.0/1.1, namespaces, malformed/hostile XML, wrong structures, route
  content, invalid coordinates, point/file bounds, repeated points, loops,
  missing elevation/time, timezone ambiguity, non-increasing time, interpolation
  at exact distance boundaries, dateline/high-latitude fixtures.
- Known-distance/elevation/time fixtures; all five variants; raw original
  byte-for-byte preservation; no invented values or chart connections.
- Unit tests for parser/derivation/validation and injectable upload orchestration.
- Migrated development PostgreSQL/PostGIS tests for constraints/audit triggers,
  ownership, complete publication, active/confirmed rechecks, concurrent retry,
  quotas, attached-file deletion rejection, cleanup, and uncertain commits.
- HTTP tests for same-origin protection, actual body limits, visibility, direct
  downloads, chart/geometry/avatar access, safe headers, and unavailable storage.
- Browser tests in English/Spanish, light/dark, desktop/mobile: user-menu entry,
  eligibility, required fields, tags and keyboard controls, errors/retry,
  successful redirect, private/public details, original map data, charts,
  missing-data states, attribution, and visualization failures.
- Upper-limit performance checks for parsing, database publication, full-point
  map rendering, chart rendering, and response sizes. Validate the 100,000-point
  policy empirically rather than promising unsupported latency.
- Automated browser tests should stub map-provider requests deterministically;
  separately verify a real basemap integration without uploading GPX externally.
- Run required lint, TypeScript, production build, relevant unit/database/HTTP/
  browser suites, formatting, whitespace checks, and final standards/spec review.
- Update ARCHITECTURE only when behavior is implemented; update README for new
  setup, provider configuration, limits, commands, and cleanup responsibilities.

## 9. Sources and current boundaries

- [Existing implementation](../ARCHITECTURE.md), especially file lifecycle,
  ownership, quotas, and private avatar delivery.
- [Product design](DESIGN.md), including equal-distance directional
  representations; this interview narrows initial GPX structure support.
- [Domain terms](../GLOSSARY.md).
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).
- [react-map-gl](https://visgl.github.io/react-map-gl/docs).
- [OpenFreeMap service, attribution, and SLA statements](https://openfreemap.org/).
- [OpenFreeMap integration and Liberty style](https://openfreemap.org/quick_start/).
- [GPX 1.1 schema and segment semantics](https://www.topografix.com/GPX/1/1/).
- [shadcn Base UI Chart](https://ui.shadcn.com/docs/components/base/chart).

## 10. Review gate

Confirm that this captures the shared product scope and accept or amend the
technical proposal before turning it into a buildable spec and dependency-linked
GitHub tickets. Do not begin application implementation as part of this planning
request.

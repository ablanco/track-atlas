# Track explorer

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Track explorer

Public exploration is available at `/[locale]/tracks`; collections at
`/[locale]/users/[id]/tracks`. The shared header links to exploration and the user
menu links My tracks to the session owner's collection. Uploader links lead to
their collection. Collection routes resolve missing/inactive owners behind a
request-time Suspense/connection boundary; metadata remains generic. The proxy
applies private-page cache, referrer and indexing protections to these routes.

`components/track-explorer.tsx` coordinates metadata requests, selection, geometry
statuses, retry, pagination and stable ten-slot color/number assignment. Query
typing is debounced by 300ms. Other controls flush pending text and compose against
the latest URL, cancelling the old debounce so rapid actions retain all criteria.
Flushing a changed normalized search resets pagination even when a stale page
control triggered the flush; unchanged normalized text still permits pagination.
Search and filter controls accept interaction after hydration attaches their
handlers, including while metadata is loading. Filter controls retain their
subtree across query and metadata updates: unrelated changes preserve focused
numeric drafts. Each numeric field resets only when its own committed URL value
changes; each slider resets for its own values or authorized scope bounds.
Base UI/shadcn sliders commit on release and numeric inputs commit on blur or
Enter. Distance controls use 0.1 km steps and elevation
uses metres. Result lengths always use localized kilometres, retaining significant
digits for short nonzero tracks; detail formatting is unchanged. Matching counts
use localized plurals. Search, filter choices and page are canonical URL state
with browser Back/refresh support; locale switches preserve that query. Result changes clear
selection and reset list scroll. Sliders use authorized scope bounds, independent
of the current filters, with the uppermost position meaning unlimited.

Automatic map fitting depends on numeric geometry bounds rather than array
identity. Equivalent track snapshots and camera-state updates therefore do not
refit the map repeatedly. The isolated map browser suite covers equivalent
snapshot feedback, and the footer browser suite exercises loaded geometry with
the modal open. Browser checks reject React maximum-update-depth console errors.

The explorer uses a single compact toolbar below the shared full-width header,
with a fixed-width search field and search icon, a multiple-selection activity
select with the same activity icons/badges as the upload form, difficulty toggles,
and separate distance/elevation popovers containing
sliders and numeric limits. Filters are directly accessible without an overall
collapsible panel. Below the large breakpoint, the toolbar shows only the search field and a
Filters button. It opens a modal Base UI bottom drawer with vertically arranged
controls and inline range sliders/inputs. The drawer traps focus, supports swipe,
Escape and close-button dismissal, returns focus to its trigger, and closes on
resize to desktop. Filter changes continue to update URL state immediately.
Desktop controls scroll horizontally when needed instead of wrapping. Page titles
remain available to assistive technology without a visible heading row. Collection identity appears in the sidebar. The desktop explorer
fills the remaining viewport with a scrollable sidebar and map. Mobile starts
with the list and offers a floating button centered near the bottom of the viewport
to switch to the other view. The button includes its destination icon and label,
respects the device safe area, and overlays results or pagination without reserving
vertical space. Pagination uses the shared shadcn component with locale-aware
page links only when results span more than one page; the current link identifies
the page without a separate status
line. Matching count, results, and pagination share one scroll container
on desktop and mobile. Mobile adds space at the end of that scroll so pagination
can move above the floating switch. Expanded map help appears above the switch. Track titles open details; selecting an
entry highlights it. Compact entries place the uploader avatar at the top right,
replace activity text with the shared activity icon, and keep difficulty/length
on one metadata row. Avatar/activity names open on hover or keyboard focus and
on tap, with Escape/outside dismissal; the uploader popup links to the collection.
Hover/focus temporarily highlights its path, while a map
selection reveals/focuses the corresponding entry, switching mobile to the list.
Counts and numbered pagination remain usable when geometry or basemap requests
fail. Individual paths expose loading, failure and retry states. Empty collections
and lists are distinguished from filtered results with no matches. Own-collection
and private-list views show All/Public/Private controls; private tracks have badges.

Superseded metadata requests are aborted and ignored. Client snapshots are cleared
when Next Activity hides the page; returning reauthorizes before showing results.
Session-keyed remounts discard private state after login/logout refresh. No private
metadata or geometry is included in the public prerendered shell.

`components/explore-map.tsx` loads a separate multi-track renderer through a client
error boundary. Geometry requests have independent deadlines, abort/retry, and
generation checks. Current paths are aligned to a stable common longitude world
copy as they arrive; Mercator clipping is disclosed for polar tracks. Result
changes fit the page until the user manually moves the camera; hover/selection
never refits. Either active spatial criterion freezes automatic result fitting,
including delayed geometry, retries, and temporary empty results. Basemap choice persists across result changes. The renderer reuses
the existing basemap styles, linked attribution and no-referrer provider requests.
Its basemap picker uses the shared Select component from the filter toolbar,
including the same trigger styling, option popup, and keyboard navigation.
Numbered keyboard markers and an overlap chooser select tracks; selected paths
gain an outline and width, while list entries share ten semantic color tokens.
WebGL failures leave result browsing available. The original-point details map
is unchanged.

Explorer verification includes parser/map helper tests, authorized database/HTTP
tests, real database-backed browser access and logout/return checks, localized
filter/pagination/list interactions, and an isolated map-component browser fixture
with real WebGL/workers and deterministic provider/geometry responses. The maximum
geometry case exercises ten tracks of 100,000 recorded points without changing
the persisted full paths or their samples.

### Spatial controls and map lifecycle

Spatial controls share the floating basemap panel inside the map, including in
mobile Map view. Arrow and Line use labeled icon buttons, with a question-icon search tooltip
on the right of the same row. On mobile, map help uses a compact Help disclosure
in the bottom-right corner above attribution, beside the floating view switch. A map failure keeps the controls available in its fallback panel.
The Map search checkbox commits current geographic
bounds; intentional completed map moves debounce for 300ms and replace the current
history entry against the latest URL. These updates flush pending search text,
retain all other criteria, and reset pagination. Programmatic restoration, resize,
and automatic fitting do not commit viewport changes. Disabling the criterion,
Back/forward, or Activity cleanup cancels pending camera updates. Bounds normalize
world copies, preserve wrapped date-line boxes, and represent a full world as
west -180 / east 180, using six decimal places for movement deduplication.

Arrow and Line use one finite start/end drawing. Selecting either tool starts a
new drawing; click/tap the start and end to apply it immediately and leave drawing
mode. Pointer movement after the first click previews the geographic line/arrow
and current search corridor without applying criteria or searching. Transient
previews use at most 256 geographic segments; completed drawings and search retain
the shared sampling of at most 1 km per segment. Touch retains
only the start marker until the second tap. Map panning/zooming remain available;
drags and multi-touch gestures do not place endpoints. Decorative draft/endpoint
markers do not intercept map clicks. Keyboard use reveals the centre crosshair and
Set start/Set end controls, with instructions for keyboard panning; pointer use
hides these controls. Keyboard completion/cancellation returns focus to the map.
Drawing instructions use a content-sized info alert at the map's bottom-left,
floating above map help with shared light/dark information colors.
Drawing consumes path clicks and disables numbered selection and double-click
zoom. Switching tools during placement retains the start; selecting the same tool
again resets it. A replacement keeps the committed criterion and corridor until
valid completion. Escape/Cancel discards only the unfinished draft, while Clear
also cancels replacement. Coincident and antipodal endpoints are rejected through
the shared URL validator; invalid end placement retains the start for another try.
Corridor inputs commit on blur/Enter with inclusive 0.1–50 km limits, defaulting to
1 km for a new drawing. Invalid numeric drafts preserve the committed filter.

`tracks/explore-path.ts` shares the finite shortest WGS84 drawing between
browser and server: equal-distance samples at most 1 km apart, at most 20,005
vertices, with exact input endpoints. `tracks/explore-spatial-geometry.ts`
uses those samples for the centerline and metre offsets. Endpoint cap chords
have at most 0.25 m sagitta. Below Mercator's horizon, the centerline's projected
chords introduce less than 1 m of surface error (the real-map near-antipodal
regression independently checks every chord midpoint); the polygon remains a
visual approximation rather than a pixel-exact search boundary. PostGIS joins
the same samples with its native geography arcs, whose deviation from the WGS84
curve over a 1 km piece is below 1 mm. Neither approximation expands the accepted
distance or angle tolerance. Longitudes unwrap continuously across the date line;
polar polygons clip and centerlines clamp at Mercator's horizon, with the existing
polar limitation notice. The clipped/clamped portions cannot depict the actual
polar corridor. Arrow's endpoint indicator follows
the final geographic bearing; Line has no directional arrowhead. Static endpoint
markers expose localized passive image names; unfinished draft markers are
hidden from assistive technology. Corridor errors remain associated with the
numeric field through a stable `aria-describedby` target after focus returns.

Initial URL restoration and Back/forward frame saved viewport bounds without
padding, or the corridor with padding if no viewport exists. Map aspect ratio
may expand the displayed area; restoration retains the original saved filter.
Result changes preserve that camera while either spatial criterion is active.
Refresh/sharing and locale navigation retain spatial and existing filter state,
including private-list URLs. Request failure never substitutes old matches or
clears criteria. Search retry and map reload remain available, and active spatial
criteria remain independently clearable even after WebGL failure.

### Server queries and display data

`tracks/explore-types.ts` defines browser-safe explorer payloads.
`tracks/explore-query.ts` parses and canonically serializes text, repeated activity
and difficulty choices, kilometre distance limits, metre elevation-range limits,
owner visibility, page, and optional viewport/drawing criteria. Spatial fields are
optional on `ExploreFilters` for older callers; parsing normalizes absent fields
to null. Invalid, duplicate scalar, or unknown parameters are
rejected. `ownerId` and `listId` are mutually exclusive API-only scopes, not
shared filters.

`GET /api/tracks/explore` searches public tracks; `ownerId` selects an active
account's uploaded collection. Only that account's current session expands its
collection to private tracks. Other viewers ignore the visibility selector.
Missing or inactive collection accounts return 404. Collection and uploader
identities contain only the user ID, displayed identity (display name or first
name plus surname initial), and a derived-avatar URL when available.

The server uses one parameterized PostgreSQL statement for authorization,
collection identity, scope bounds/counts, matching counts, and the current page.
Ready GPX originals and active accounts are required. Search words must each
occur as literal, case- and accent-insensitive substrings in the title or a tag;
descriptions are excluded. The `unaccent` extension is required by migration
`0014_explorer-search`; stored tag identity is unchanged. Choices within one
category are alternatives, while categories intersect. Numeric comparisons use
unrounded stored values and inclusive limits. An elevation-range maximum
requires complete elevation coverage. Bounds are computed before every filter,
including visibility, from authorized tracks only; empty bounds are zero.
Pages contain at most ten tracks ordered globally by popularity descending
before pagination. Public and collection scopes break ties by upload time
descending, then track UUID descending; private-list scope uses membership
creation time descending, then track UUID descending. Each fetch reads current
rankings; votes can move results between pages across requests. No live reorder
or frozen cross-page snapshot is introduced. Requested pages clamp to the last
valid page (one for no matches).

Spatial URL contracts are browser-safe and shared with the API:
`viewport=west,south,east,north` uses geographic degrees, allows wrapped boxes
(`west > east`), and includes boundaries. Latitude must increase within [-90,90];
longitude is within [-180,180]. Zero-width/height boxes are rejected;
`-180,-90,180,90` represents the whole world. Drawings use `drawMode=arrow|line`,
`drawStart=longitude,latitude`, `drawEnd=longitude,latitude`, and optional
`corridorKm` (default 1, inclusive 0.1–50). All drawing fields except the corridor
are required together. Serialization explicitly includes the corridor. Longitude
180 in drawing endpoints normalizes to -180. Coincident positions (including
pole/date-line aliases) and exactly antipodal endpoints are rejected. Drawings
follow the shortest geographic path. `withExploreSpatialFilters` commits changes
or clears criteria with page reset to one while retaining other filters.

`tracks/explore-spatial.ts` intersects independent predicates on the existing
`intermediate_count=5` representation. Viewports first use the geometry GiST
bounding-box index (splitting wrapped boxes), then require a sampled vertex in
one of the boxes. Crossing edges without included vertices deliberately fail.
Drawings are passed as one bounded GeoJSON parameter and parsed once in a
materialized CTE; candidate scans, finite nearest locations and final distance
all use that shared sampled path. The persisted seven-vertex representation
retains its six native PostGIS geography arcs (great-circle interpolation with
spheroidal metre measurements), including long edges; it is not replaced by the
original recording or by an ellipsoidal re-sampling of representation edges.
That preserves the partial expression geography GiST index and its candidate
superset: the candidate and final tests interpret representation edges alike.
After candidate selection, each of the same six edges is subdivided with
geography `ST_Segmentize` into native great-circle pieces no longer than 100 km
for nearest-point and final distance evaluation. This changes no edge path or
match unit; it prevents PostGIS's two-point near-antipodal intersection calculation
from returning the opposite supporting-circle intersection outside the finite
arc. Directions still belong to the original representation edge.
The index was added in migration `0017_explorer-spatial-geography.sql`.
`ST_DWithin` uses only the existing 1-micrometre candidate padding to avoid
boundary shortcut roundoff. The same edge's final spheroidal `ST_Distance` is
compared inclusively with the unpadded corridor. Geography `ST_ShortestLine`
locates nearby finite edge/drawing points. `ST_LineLocatePoint`'s geographic
length fraction identifies the local equal-distance drawing piece, including
across the date line, without a planar longitude calculation or a per-piece
cross product. Directions use `ST_Azimuth` toward the farther endpoint (reversed
when pointing back toward the start), using the representation edge's endpoints
and the drawing's **local piece** endpoints. This retains the existing
representation direction convention while avoiding bearings from a faraway
drawing origin, including near-antipodal drawings. The
drawing tangent is transported along the geographic connector into the edge's
local north/east frame: subtract the connector's forward azimuth at its drawing
end from its forward azimuth at its edge end. For a zero-length connector the
frames already coincide; pole aliases use longitude zero in both frames. This
compares directions where the paths are nearby, including long high-latitude
paths whose initial bearings differ greatly from their final tangents. Arrow
accepts angular differences up to 30 degrees; Line additionally accepts
differences at least 150 degrees. Line endpoints are internally ordered
canonically before nearest-point evaluation, so ties cannot change matches when
the same drawing is reversed; URL endpoints and Arrow travel order are retained.
Nearest-point/tangent evaluation never substitutes an infinite geodesic extension
for the separate finite-edge distance test. Angular differences normalize to [0,180] and round to a
nanodegree to stabilize inverse-geodesic roundoff at inclusive limits. Geographically coincident endpoints (including pole/date-line aliases) and edges
without a geographic azimuth cannot qualify; checking rounded distance for zero
would incorrectly discard microscopic edges with a usable bearing.

Candidate sets are materialized once inside the existing authorized statement;
only their intersection with authorized tracks affects results. Viewport and
drawing can match different portions, but drawing proximity and bearing must
match the same edge. Counts, scope bounds, ordering and pagination retain their
existing semantics. No ranking is added and no recorded/display geometry changes.
Development database tests inspect the actual service query with
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against distributed fixtures: viewport
and wrapped-viewport plans use geometry GiST, and drawing uses geography GiST,
with a single candidate index scan per statement. These small-fixture observations
are not a production-scale performance guarantee. Parser and database/HTTP tests
cover restoration/reset, validation, sampled boundaries/crossing false negatives,
same-edge matching, reverse travel, loops, directionless edges, inclusive angle
and endpoint distances, high latitudes/date line, combined criteria, and scope
security/count/order/pagination preservation. Browser tests additionally cover
spatial URL composition, replacement/cancellation, camera restoration/freeze,
geographic corridor rendering, mobile clear/recovery, and both locales/themes.

`GET /api/tracks/[id]/explore-geometry` authorizes geometry within the same SQL
read. It returns only a LineString, with Douglas–Peucker display simplification
starting at 0.00001 coordinate degrees (roughly one metre latitude). Tolerance
doubles on successive simplified paths until at most 2,048 vertices remain.
Longitude sequences are unwrapped before simplification, then long simplified
edges are subdivided before wrapping back to canonical longitudes, preserving
world traversal and dateline bends. Endpoints and collapsed lines are retained. This bounds a ten-track page's
transfer without altering recorded details, samples, directional search
representations, or GPX originals. The tolerance is for display, not distance
measurement or geographic search.

`GET /api/users/[id]/avatar` serves an active collection owner's current 128px
WebP derivative even when the collection has no public tracks. It never accepts
a file identifier or serves the original. Owned ready-file association, storage
location, byte length and checksum are verified, and the association is checked
again after storage reads. Metadata and geometry do not require configured
object storage. All explorer API success and error responses use private/no-store
and nosniff headers. No request-specific explorer data enters shared caches.

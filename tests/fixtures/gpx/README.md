# Multi-track GPX acceptance fixtures

These synthetic GPX 1.0/1.1 documents contain no personal recording. They carry
identical recorded data in their respective version namespaces: two Tracks with
two ordered segments each, repeated/shared endpoints, local backward/overlapping
timestamps, complete and partial elevation coverage, local namespace shadows,
QName values split across CDATA, and document-wide metadata/waypoints/extensions.

Parser/worker and real HTTP/database download acceptance share these fixtures.
Expected geometry, elevations and measurements are literal known answers in the
parser tests; download tests also check verbatim selected subtrees and singleton
byte preservation. Invalid-later, route, Unicode and generated cap/over-cap cases
remain in the adjacent parser/worker/service/browser suites to avoid large static
fixtures or duplicating existing acceptance.

`poi-categories.gpx` is a wholly synthetic singleton with GPX type/symbol and
Garmin GpxExtensions v3 category metadata. It includes all 35 supported POI
categories, homogeneous/mixed coincident groups, segment endpoint overlap, and
inert URL/markup input for generic fallback. Coordinates describe no real survey.

`poi-symbols.json` pins the expanded source-symbol/category contract independently
of the production allowlist. `poi-categories.gpx` exercises every rendered category,
including distinct water-source/drinking-water and campsite/shelter meanings.

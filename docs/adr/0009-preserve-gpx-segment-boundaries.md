# Preserve GPX segment boundaries within one Track

The multiple-track exclusion in this original delivery scope is superseded by
[ADR 0010](0010-import-multiple-gpx-tracks-independently.md). Its ordered-segment
and measurement rationale remains accepted and implemented.

One Track represents one GPX track (`<trk>`), retaining its segments (`<trkseg>`)
in document order. Segment boundaries remain breaks even when adjacent segments
share an endpoint. Joining segments would invent travel absent from the recording:
maps must not draw connectors, and distance, ascent, descent, and interval-average
speed must not include cross-boundary intervals. Spatial search must not match an
invented connector either.

The change accepts multiple segments within one GPX track, while continuing to
reject multiple GPX tracks in one file. Support extends the existing upload flow
through maps, measurements, charts, search, and unchanged-original downloads.
Track editing remains metadata-only; splitting, merging, reordering, and replacing
segments are outside this change.

Recorded duration sums each segment's elapsed time, retaining stops within a
segment and excluding gaps between segments. It is unavailable unless every
segment has complete, strictly increasing timestamps. Each segment must have at
least two recorded points and positive length; an invalid segment rejects the
whole upload, with an error identifying that segment, rather than silently
discarding recorded content.

Timestamp validity is local to each segment. Earlier or overlapping timestamps in
a later segment neither invalidate duration nor change document order; overlapping
segment durations are still summed. Elevation completeness remains a whole-Track
property: missing elevation anywhere makes total ascent and descent unavailable,
while known elevations and qualified extrema/range remain usable.

Uploads accept at most 100 segments alongside the existing 100,000-point and
10 MiB limits. Exceeding the segment limit rejects the upload with a clear error;
segments are never truncated or merged to fit. Processing and spatial search must
be checked at the segment limit during implementation.

Each segment receives its own six-edge approximation for spatial search. A Track
matches a spatial criterion when any segment qualifies; viewport and drawing
criteria may match different portions, as before. No approximation edge crosses
a segment boundary. This spends more samples on tracks with more segments in
exchange for retaining every segment as an independently searchable path.

Charts share one cumulative-distance axis across all segments. Every boundary is
visibly marked, with no connecting line or artificial distance; the next segment
starts at the previous segment's final cumulative distance. Interval-average
speed starts afresh within each segment.

Segments share one track color. Track details show a segment count, and every
segment's start and end are identifiable by its one-based position in document
order. Endpoint labels are available through interaction and accessible text,
without permanently crowding the map. Segment-selection controls are outside
this change.

Explorer display geometry retains one 2,048-vertex budget per Track, shared across
all segments, including any subdivision needed to preserve world traversal.
Simplification treats segments independently and retains every segment, its
endpoints, and its boundaries. If safe simplification cannot fit the budget, the
existing explorer geometry-unavailable fallback applies; the full details map
and original download remain available. A per-segment budget was rejected because
it could multiply a ten-track page's display payload by the segment limit.

Measurements and filters remain Track-wide. Per-segment statistics,
segment-specific search filters, and segment selection are outside this change;
segment counts, numbered endpoints, and chart boundaries explain the structure.

The design decisions above are accepted and implemented through #42–#45.
Implementation includes version-2 derivation, migration/backfill of existing
singleton Tracks, segment-aware spatial/display geometry, maps/charts, localized
errors and acceptance coverage. The segment-editing and per-segment exclusions above remain outside
scope; the multiple-track exclusion is superseded as noted above. Current implemented behavior is documented in
[Tracks, maps, and external editing](../architecture/tracks.md).

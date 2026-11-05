# Import multiple GPX tracks as independent Tracks

Status: accepted. Not implemented.

Delivery specification: [#46](https://github.com/ablanco/track-atlas/issues/46).
Implementation tickets cover [GPX processing (#47)](https://github.com/ablanco/track-atlas/issues/47),
[persistence and retries (#48)](https://github.com/ablanco/track-atlas/issues/48),
[upload UI (#49)](https://github.com/ablanco/track-atlas/issues/49), and
[integrated acceptance and documentation (#50)](https://github.com/ablanco/track-atlas/issues/50).

A GPX document containing multiple `<trk>` elements creates one independent
Track per element in document order. Each retains its own ordered segments and
measurements, following [ADR 0009](0009-preserve-gpx-segment-boundaries.md).
Creation is all-or-nothing: an invalid track or segment rejects the entire
submission and identifies the offending track and segment.

All outputs copy the submitted description, activity, difficulty, tags, and
visibility. For multiple outputs, every title receives its one-based document
number: “Mountain trip 1”, “Mountain trip 2”, and so on. A singleton keeps its
submitted title. Photos attach only to the first Track. Later edits, visibility
changes, and deletion affect each Track independently.

Each output of a multi-track upload downloads a standalone GPX containing only
its own track and segments, excluding sibling tracks and document-wide waypoints.
Sharing the unchanged original through each Track would disclose sibling paths
after their visibility changes or deletion. This isolation justifies departing
from unchanged-original downloads for multi-track inputs. Single-track uploads
retain their unchanged-original behavior.

Standalone GPX documents preserve the selected track's recorded points, segment
order, names, and track-local extensions. They omit document-wide metadata,
waypoints, and extensions that could describe sibling paths. The multi-track
source is not retained after successful creation. Each output GPX counts
separately toward the owner's file and byte quotas; insufficient quota rejects
the entire upload. Storage cleanup follows each Track's independent deletion.

One upload accepts at most 100 tracks, 100 segments total, 100,000 recorded points
total, and 10 MiB of input. Existing XML and shared worker time/resource bounds
remain upload-wide. Limits reject rather than truncate inputs. Numbered titles
shorten only the base as necessary to remain within the existing 200-Unicode-code-
point limit, without splitting Unicode characters. The resulting titles are
shown before submission.

After file selection, the upload form previews the output count, generated
titles, and first-Track photo destination before enabling submission. Changing
the file or title refreshes the preview. Metadata remains shared during creation;
individual adjustments are available through subsequent Track edits. The server
independently validates the complete upload rather than trusting preview data.

GPX routes (`<rte>`) remain unsupported, including documents that also contain
valid tracks. Waypoints alone create no Tracks. Empty or invalid `<trk>` elements
reject the entire upload rather than being skipped or changing output numbering.
Errors identify one-based track positions in file order and, when applicable,
one-based segment positions within that track.

Multi-track success opens the owner's collection with a localized created count
and links to the created Tracks. Single-track success keeps the details redirect.
Successful retries return the same ordered set of outputs. Once any output has
been deleted, retries of that attempt reject without creating anything, extending
[ADR 0001](0001-retain-deleted-upload-identities.md). A deliberate new upload
requires a new attempt identity.

On validation, quota, or creation failure, no Tracks are published. The form
retains the selected file, shared metadata, and staged photos for correction or
retry. Temporary GPX outputs are cleaned up. Existing staged-photo expiry and
cleanup rules remain in force; expired photos must be selected again. An
uncertain acknowledgement must be resolved through the same upload attempt so
that cleanup cannot remove successfully published outputs.

When implemented, this decision supersedes ADR 0009's rejection of multiple GPX
tracks in one upload; its segment-preservation rationale remains in force.

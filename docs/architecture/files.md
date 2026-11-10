# File storage, avatars, and track photos

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## File uploads

`POST /api/files?purpose=avatar|gpx|photo` accepts a raw request body from an active
session. POST and DELETE require an exact trusted `APP_ORIGIN`; cross-site Fetch
Metadata is rejected and no cross-origin access is enabled. Owner identity comes
only from the session. Foreign and missing file IDs both return 404. Responses
exclude storage paths, bucket names, credentials, and object keys other than the
opaque file ID. This API has no localized UI or human-readable error messages.

`storage/validation.ts` owns purpose policies. Avatar input accepts raster images
recognized by `file-type` and fully decodable by the installed Sharp build.
Canonical MIME types come from file bytes, not request headers. The picker has no
client-side format allowlist. GIF, AVIF, and TIFF are verified alongside JPEG,
PNG, and WebP; additional decoder-supported raster formats use the same boundary.
Browser preview support can differ from server decoding support.
Inputs remain limited to 5 MiB, 16,777,216 decoded pixels, and one frame, with a
ten-second Sharp processing timeout. The exact original bytes, format, orientation, and metadata are retained.
`storage/avatar-versions.ts` then uses Sharp synchronously to generate 128×128 and
24×24 WebP versions at quality 80. Both correct EXIF orientation before a center
square crop, enlarge small inputs to the exact output size, preserve transparency,
and strip embedded metadata. Each encoding retains the input-pixel and ten-second
timeout bounds and is capped at 64 KiB. Originals can contain sensitive embedded
metadata such as GPS coordinates. SVG and animation are rejected.
GPX accepts UTF-8 XML up to 10 MiB, with a GPX root and matching 1.0 or 1.1
namespace/version. SAX parsing rejects malformed XML, DTDs, entity declarations,
processing instructions, non-UTF-8 declarations, depth over 64, and more than
500,000 elements. This is envelope validation, not full GPX schema validation or
track extraction. Uploaded GPX bytes, including any location metadata, remain
unchanged and private.

The request reader checks declared and actual sizes, cancels oversized streams,
and has a 30-second body deadline. The server buffers only bounded bodies.
Downloads also enforce stored byte count and SHA-256 integrity before returning
an attachment with `private, no-store`, `nosniff`, and sandbox headers.
`GET /api/avatars/:id` applies the same ownership and integrity checks but serves
only derived WebP bytes inline: 128px by default or explicit `?size=128`, and
24px for `?size=24`. Unknown parameters, duplicate sizes, and unsupported sizes
are rejected. GPX and legacy avatars without versions cannot be served through
that route; there is never an original-image fallback. Settings uses 128px and
the top-bar menu uses 24px through shadcn AvatarImage. Settings uses unoptimized
`next/image` inside AvatarImage; both send owner cookies directly to the private
endpoint rather than delegating to a shared image optimizer. Profile/session
reads omit legacy images from display while preserving the Settings removal
reference. Existing avatars require reupload; no backfill or on-read processing
exists. The generic attachment endpoint still downloads original bytes.
Generic avatar/file APIs remain owner-only. Track-authorized derived avatar delivery is described in the
[track reference](tracks.md). No presigned links, range responses, or browser-to-bucket transfers exist.

The lifecycle is `pending` → `ready` → `deleting`. Reserving a pending row locks
the active user before the session, rechecks authorization, and atomically applies
limits of 100 original file records, 1 GiB, and two pending uploads per account.
Track document creation reserves every generated GPX and its measured stored
bytes together; its output rows share an `upload_group_id` and count as one
pending attempt. Generic uploads count individually. Both entry points use
this grouped pending count under the same owner lock, including concurrent
reservations/retries. Each GPX still counts separately toward file/byte limits,
and deleting one never cascades to its siblings. Download integrity checks apply separately to every isolated output; standalone
GPX keeps verbatim recorded values and local extensions with required namespaces.
The successful multi-track
source is not stored; see [Track creation](tracks.md). Pending
rows reserve their purpose's maximum size plus two 64 KiB version allowances for
avatars; ready avatar rows count the measured original and both version sizes.
Deletion records continue counting until cleanup removes them. Object writes run
outside database transactions. Finalization locks and rechecks authorization and
reservation expiry before marking ready. A failure only abandons pending rows,
so an uncertain commit cannot trigger deletion of an already-ready object.
Avatar publication waits for the original and both versions to be stored.
Finalization records each version's byte size and SHA-256 in nullable columns
on the existing file row, atomically with the original metadata; a constraint
requires either all four version fields or none, with bounded sizes and valid
hashes for avatar-purpose rows. Legacy rows retain null version fields.
Avatar finalization also sets the authenticated user's nullable `avatar_file_id`
and marks the previous avatar for cleanup in that same transaction. Failed uploads
leave the previous avatar unchanged. Generic file deletion clears a matching
current-avatar reference transactionally. The FK uses `ON DELETE SET NULL`; the
unused legacy `avatar_url` field is not an avatar source or mutation input.

Database time gives pending rows 15 minutes. Cleanup marks expired reservations
for deletion and repeatedly removes their objects. Avatar deletion always attempts
the original and both deterministic version keys, including for pending records
whose version metadata was never committed. Failures in one removal do not prevent
attempts on the others; the record remains retryable until all succeed. Deletion records last at
least 24 hours to catch late writes and uncertain storage outcomes. The cleanup
command processes fixed-size pages, isolates per-object failures, and reports
counts without sensitive details. Users cannot be hard-deleted while file
records still identify stored bytes. No automatic scheduler is installed.

Local storage uses a private `0700` root, `0600` files, exclusive temporary writes,
and atomic no-overwrite publication. File and directory synchronization precedes
successful publication; canonical directory paths preserve storage identity across
ancestor symlink changes. Local storage requires filesystem support for hard
links and directory synchronization. Temporary filenames derive from file IDs,
so cleanup also removes interrupted local writes. Only canonical server-generated
UUID keys and exactly `avatars/{original,128,24}/<UUID>` keys are accepted. Nested avatar
directories also require `0700` permissions and cannot be symlinks. Root/object symlinks and public/build storage locations
are rejected. The application user must control the directory and its ancestors;
hostile writers with local filesystem access are outside this boundary.

B2 uses the AWS S3 SDK with a validated regional HTTPS endpoint, private bucket,
server-only credentials, bounded reads, two maximum attempts, and 30-second
operation deadlines. UUID keys are never reused. Removal lists and permanently
deletes exact-key object versions and delete markers, including paginated results.
Object Lock or insufficient key permissions cause retryable cleanup failures.
The operator must keep the bucket private; the application does not provision it.

Each row stores its explicit object key and a SHA-256 fingerprint of its backend
and target directory or bucket. New avatar keys are `avatars/original/<file-id>`, `avatars/128/<file-id>`,
and `avatars/24/<file-id>` on both local storage and B2; GPX keys remain flat file IDs. Migration backfills
existing object keys to their flat IDs without moving bytes. Older normalized
WebP files remain readable, but their pre-normalization originals cannot be recovered. Credential rotation preserves this identity. Changing storage targets
fails closed for existing files and requires a separate migration. Simultaneous
reads from multiple configured backends are not implemented.

Account quotas are not distributed request-rate or global resource limits.
Operators must bound request rate, concurrent connections, aggregate body sizes,
and image-processing load at the deployment boundary. Validation does not provide
malware scanning. Tests use real local files, a migrated development database,
and a loopback S3 protocol server; live B2 compatibility still needs an authorized
bucket smoke test before production use.

## Track photos

Track owners stage optional photos through `POST /api/files?purpose=photo`.
JPEG, PNG, WebP and AVIF inputs are limited to 20 MiB, 16,777,216 decoded pixels,
one frame and a ten-second decoder timeout. Originals remain byte-exact and private.
Six metadata-free, auto-oriented display versions use inside bounds without enlargement:
1920×1080 large and 480×480 thumbnails, each JPEG (82), WebP (80), AVIF (50).
Transparency is flattened onto white. Each version is capped at 4 MiB.
`track_photos` and `track_photo_versions` have database audit defaults and update triggers.

Reservations include the original maximum plus all six version allowances. Ready
files count measured originals and versions; derivatives do not consume original-file
slots. Deleting files and reservations continue to count. Account limits are 1 GiB,
100 originals and two pending uploads. The browser queues additional selections.
The object read ceiling is 20 MiB for photo originals; GPX and avatar policies retain
their existing smaller limits. Nested display keys remain private on local/B2 storage.

Track creation and owner metadata saves publish the intended gallery (maximum 20,
plain-text captions up to 500 characters) in the same transaction. Only ready owned
unattached unexpired photos or that track's existing photos can be attached. Cancel
does not mutate saved records. Unattached ready photos expire after 15 minutes;
the picker conservatively marks local staged uploads retryable after 14 minutes,
retaining Files, captions and order for per-photo re-upload under normal quota and
session checks. No staging renewal endpoint extends abandoned or foreign records.
`tracks/photo-drafts.ts` owns mutable photo drafts for both upload and Track edit.
Its interface exposes stable-key display rows, readiness/dirty state, caption/order/
remove/retry actions, reset and a detached submission value. Server file IDs remain
inside the module until submission; completing or retrying an upload never changes
its display key. Selection is capped at 20 and queued photos start in gallery order
with two active requests. Malformed HTTP 201 bodies fail closed and retain the File
for retry. Request identity fences progress and completions after removal, reset,
retry and Activity cleanup, including callbacks from an aborted request.

`components/use-photo-drafts.ts` binds this module to React and the production XHR
adapter (two-minute request timeout), browser object URLs and the lease timer.
The module checks expiry again when taking a submission value, so a delayed timer
cannot admit an expired photo. Existing attached photos have no staging lease.
Activity hide aborts requests, frees slots and revokes previews; restore recreates
object URLs, checks leases and offers retry for interrupted uploads. Removal,
reset, cancel and confirmed save release resources immediately. The picker only
renders rows and forwards user actions; callers no longer reconcile temporary and
server IDs or receive readiness callbacks. Save disables picker controls and drops. On the upload form and in the details editor, the disabled submit/save
button has a keyboard-accessible tooltip explaining that photos must finish
uploading, with retry/removal guidance for failed photos.
Cleanup locks the account to serialize expiry with gallery saves, withdraws them and retains deletion rows for 24 hours against late writes.
Removal and track deletion withdraw photo access before retryable cleanup of all
seven keys. Deleted track-upload identities remain retained.

Display APIs under `/api/tracks/:id/photos` independently authorize ordinary track
access and never return original storage locators. Originals remain owner-only through
`/api/files/:id`; administrators use `/api/admin/photos/:id/original`. Administrative
photo records support caption editing and removal; derivative records are read-only.
Upload and ordering remain owner operations. In owner edit mode, the below-map
gallery is replaced by photo controls for adding, removing, captioning and reordering;
cancel restores the saved gallery. Photo reorder buttons use concise localized
Earlier/Later labels and decorative Phosphor fat arrows: up/down in the
single-column mobile layout, left/right from the two-column 640px breakpoint.
Photo action buttons share a wrapping flex row with consistent gaps and vertical
alignment.
The details grid opens a shadcn/Embla
carousel in the shared focus-managed dialog, without original-download links.
Photos fit within the available viewport width and height without cropping,
preserving their aspect ratio and leaving side spacing when needed. The fullscreen
dialog reserves a top row for the close button and space below the photo for its
caption, number, and mobile swipe hint. Long captions scroll within a bounded
area while the number remains visible; the dialog itself does not scroll. Desktop
navigation arrows overlay the slides. Below 640px, navigation arrows are hidden, and
multi-photo galleries show a localized swipe hint with a decorative Phosphor
hand-swipe-left icon. Keyboard navigation
remains available at every size.
Administrators see a thumbnail preview on photo detail pages through the independently
authorized, private/no-store `/api/admin/photos/:id/preview` endpoint, including
ready staged photos and photos on private tracks. Missing or withdrawn images
show a localized unavailable message. Administrators download originals from the admin panel. Large versions are requested on opening
rather than on the details page's initial render.

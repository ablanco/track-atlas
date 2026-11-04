# Private track lists

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Private track lists

Track lists are private groupings of references to existing tracks, distinct from
the uploader's collection. Lists and their memberships belong to the list owner;
they neither copy tracks nor transfer ownership or grant track access. Active
accounts can use lists without confirming their email. Names are trimmed and
NFC-normalized, contain 1–100 Unicode characters, and compare case-insensitively
within an account. Each user may own 100 lists, each with 1,000 memberships,
including temporarily inaccessible tracks. The list overview uses twenty-list
pages ordered by list creation time descending, then UUID descending.

`tracks/list-types.ts` contains browser-safe contracts; `tracks/list-validation.ts`
validates names and carries safe errors. `tracks/lists.ts` owns persistence and
authorization. `track_lists` stores the user-owned name and normalized identity;
`track_list_memberships` references a list and track with one membership per pair.
Both tables have database-backed audit columns and update triggers from migration
`0016_private-track-lists`. List deletion cascades memberships while preserving
tracks. Permanent track deletion cascades its memberships. Removing and re-adding
a track gives it a new membership timestamp; retrying an existing add preserves
the original timestamp.

The user menu links to `/[locale]/lists`. Its request-time content shows a sign-in
prompt for guests and the owner's overview for active sessions. Opening
`/[locale]/lists/[id]` validates ownership below Suspense/connection, uses generic
metadata, and returns a localized not-found view for foreign or missing lists.
The shared explorer shows the list name, back navigation, Rename and Delete in
its sidebar. Rename preserves filters; confirmed deletion returns to My lists.
Removing a current-list membership invalidates and refetches the authorized
results, counts and bounds, including page clamping. Proxy protections cover both
list routes with private/no-store, no-referrer and noindex/nofollow headers.

`components/bookmark-picker.tsx` supplies the shared bookmark action in public,
collection and list exploration and in the details header. Its bounded Base UI
popover supports local name search, scrollable checkboxes, individual saves and
atomic create-and-add. Filled icons indicate membership in at least one list;
details load current membership separately. Failed creates retain the name and
show localized inline errors. Pending create/membership writes serialize picker
controls. Dismissal, hidden-page cleanup and unmount abort requests and release
pending ownership; operation generations prevent stale completions from affecting
a reopened picker. Closed pickers reauthorize discarded membership on resumption,
including development Strict Mode effect replay, rather than replaying old props.
Explorer refreshes replace bookmark state with the current authorized results.
Guests use the existing login modal on the current pathname/query;
successful login never automatically saves a track. The same popover supports
mobile, keyboard, Escape and outside dismissal in both themes and languages.

Overview, picker, action-dialog and explorer private state are discarded on
session refresh or hidden-page restoration rather than persisted to browser
storage. Requests are private/no-store, bounded by timeouts, and guarded against
stale responses. Unauthorized list mutations clear the list snapshot and replace
it with an in-place session prompt. Request-time component keys remount state
when authentication refreshes the route. Supporting client modules keep list
forms, actions, request errors and session prompts shared across both list views.

Reads bind active account, current session, list ownership, and current track
access in the database query. Other users' private tracks and tracks of inactive
uploaders are omitted before metadata, counts, bounds, pagination, or geometry
are returned. Membership remains when a track becomes inaccessible and makes the
track visible again if access returns. No unavailable-track placeholder or saved
metadata is exposed. A valid session sees a foreign list exactly as a missing
list; signed-out requests are unauthorized. Shared geometry, detail, and download
boundaries continue to enforce track access independently of list membership.

Writes lock the list owner's account, then the request session, then the owned
list. This serializes capacity checks and mutations with each other and with
account revocation/deactivation. Session expiry is checked using the database
clock after acquiring the session lock and again before commit, so expiry during
later lock waits rolls back the mutation. Adding requires current track access;
removing a membership still works when that track is inaccessible. Existing adds
are idempotent even at capacity. Creating a list with a track is one transaction.

`tracks/lists-http.ts` adapts `/api/lists`, `/api/lists/[id]`, and
`/api/lists/[id]/tracks/[trackId]`. Reads return the paged overview, one list, or
the owner's at-most-100-list picker with membership state and accessible counts.
Mutations allowlist input and validate trusted origin, Fetch Metadata, bounded
JSON, encoding, and query/body shape. Bodyless PUT/DELETE accept ended empty
streams from the HTTP adapter: a zero-byte budget rejects actual bytes even if
Content-Length claims zero, while the shared reader bounds duration, handles abort,
retains no empty chunks, caps empty chunks at 1,024 to prevent deadline starvation,
and does not await producer cancellation. Already-aborted streams and invalid or
nonzero declared lengths are rejected.
The browser never supplies the acting user.
Safe failures and successful responses use private/no-store and nosniff headers.
`GET /api/tracks/explore?listId=...` applies list ownership and independent track
access in the same snapshot as results/counts/bounds. List scope supports all
existing search and filters, including All/Public/Private for mixed uploaders.
Public and collection results also include the viewer's bookmark state.

Service/database/HTTP verification includes normalized names, owner isolation,
active unconfirmed accounts, limits and concurrent final-slot writes, atomic
create-and-add rollback, idempotent memberships, access loss/restoration, deletion
cascades, sorting, clamping, HTTP validation, and revocation/expiry/deactivation
during lock waits. These cases run in `pnpm test:tracks:db` against the migrated
development database.

Browser acceptance exercises real list APIs and persisted memberships across
public exploration, collections, details and list browsing. It covers management,
access loss/restoration, independent track authorization, ordering/filtering,
pagination/clamping, guest login without automatic saving, and private-state
clearing after logout or revoked sessions. Complementary UI regressions cover
inline failures, delayed create cancellation and reopening, keyboard/mobile
interaction, both languages/themes, and hydration. Membership and list deletion
also run through actual Next HTTP requests so empty-stream behavior is verified
beyond injected request adapters.

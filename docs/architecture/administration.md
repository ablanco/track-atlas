# Administration

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Administrative read foundation

`admin/models.ts` and `admin/types.ts` define browser-safe model capabilities,
record identities, relationships, and response contracts for managed models.
CAPTCHA uses, upload attempts, deleted-upload receipts, and email send limits are
internal bookkeeping and are excluded from admin navigation and read APIs.
`admin/auth.ts` checks the current database session and active administrator on
every service call; ordinary owner-only services remain unchanged. Safe session
identity includes the current admin flag for account-menu integration.

`admin/queries.ts` exposes lists, details and current overview counts. SQL fields,
sorting and filters use explicit allowlists; credentials and storage locator fields
are excluded. Composite identities are JSON arrays in primary-key order. Track
samples/points have bounded detail pages. Authorized list/detail reads also resolve
friendly User, Track and Track list relationship labels with minimal allowlisted
projections. Each response deduplicates target IDs and issues at most one batch
per named target model (at most three label queries, bounded by the 100-row page).
Labels preserve display-name, name, full-name, email, then encoded-ID precedence;
missing targets and identifier-only relationships retain the original field-value
fallback and navigation. Related records are not recursively loaded. Read-only
models never advertise selection. Overview cards include model/filter contracts,
with stored bytes including pending reservations and avatar versions.

GET `/api/admin/overview`, `/api/admin/[model]`, and
`/api/admin/[model]/[id]` use `admin/http.ts` with private/no-store responses,
validation and safe error codes. Model names follow SQL table names. The mutation
endpoint and localized UI are described below. Administration is the explicit
ADR-0002 exception permitting inspection of other owners and inactive accounts.

Administrative writes use `admin/mutations.ts` through POST
`/api/admin/mutations`. The endpoint validates trusted Origin, Fetch Metadata,
encoding, bounded JSON, and an explicit per-model operation/field allowlist.
The UI sends its locale in `X-Admin-Locale`; the endpoint allowlists English and
Spanish and passes it to account-email delivery, defaulting to English when absent.
Updates accept one opaque record ID; delete/revoke batches accept 1–100 unique
IDs and commit atomically. User profile and privilege updates, track metadata and
tags, list names, membership removal, session/account-link revocation, and eligible
file deletion are supported. Derived/security bookkeeping models remain read-only.

A transaction advisory lock serializes administrative writes and last-admin
checks. Affected accounts (including the actual actor) lock in UUID order before
the acting session and target records. Active/admin status is re-read under lock;
session expiry is checked after lock waits and before commit. Self deactivation,
self privilege removal, and current-session revocation are forbidden. Email
changes intentionally revoke all target sessions, including the acting session
when changing one's own email. Deactivation also invalidates outstanding links
and sessions; reactivation does not restore them.

Email changes save the new unconfirmed address, invalidate outstanding links,
and issue confirmation using database-backed address allowances. Delivery occurs
after commit via the existing trusted-origin email service and shared daily budget.
Failure returns `{ok:true,warning:'confirmationDeliveryFailed'}` and retains the
saved address and revocations. Other successes return `{ok:true}`; errors expose
only safe codes. Track deletion preserves deleted-upload receipts and cascades
derived data/memberships, while originals enter the existing cleanup queue.
Eligible file deletion clears the current avatar and queues all physical versions
for the same retryable cleanup; attached originals and pending files are rejected.

The localized `/en/admin` and `/es/admin` routes now render a request-authorized
workspace inside a stable shell around the streamed authorization boundary, so
overlay outside-element markers do not mutate newly streamed content before hydration.
The workspace opens on six overview statistics: total users, active users, total
tracks, public tracks, stored file count, and storage size in locale-formatted
readable units (B, kB, MB, GB and larger). Cards link to the corresponding model
list, with filters for active users and public tracks. Two shadcn line charts
show cumulative creation totals for currently active users and currently public tracks
across the last 365 UTC calendar days, including today. The authorized overview
API aggregates `created_at` on the server, includes records created before the
window in the initial totals, and carries totals forward on days without creations;
these charts reflect current status, rather than historical status transitions. The account dropdown shows Admin panel / Panel de administración only
when the current server-read identity has administrator privileges. Every admin
route checks the current database session below Suspense; API reads independently
reauthorize. Admin pages carry private/no-store, no-referrer and noindex headers.

The admin workspace uses the full available screen width, without a maximum-width cap.
The shadcn Base UI sidebar exposes the overview and managed models, with
a desktop collapse control and a dismissible mobile drawer. The sidebar toggle
sits immediately to the left of the Admin panel label on the same line. Users, tracks, and
track lists group their model and related records in nested submenus; overview
and stored files remain top-level links. Navigation highlights
the current model, closes the mobile drawer after selection, and keeps sidebar
state in memory across list and detail navigation. Lists support
server search, allowlisted filters and sorting, and 25/50/100-row pages. The
user boolean filters (active, admin, and email confirmed) use three-option selects:
blank (no filter), yes, and no. The account-link purpose filter offers a blank
option, email confirmation, and password reset. Track activity, difficulty (1–5),
and visibility (public/private) filters also use selects with blank no-filter options. Shared
shadcn pagination provides numbered links, gap ellipses, and localized Previous/Next
controls with disabled boundaries while retaining the current query. The rows-per-page
selector and total record count share a line alongside these controls below the table,
without a separate current-page summary; changes apply immediately,
retain filters and sorting, and reset to page one. Sample-data
pages use the same controls with a next-page link when a full batch is returned. Details
preserve the originating list query, link safe relationships, and page through
large sample/geometry data. Friendly relationship labels arrive in the same
authorized list/detail response; the browser renders them without fetching related
detail records or maintaining a separate label cache. List membership counts
include retained memberships. Users have individual profile/access edits;
tracks have metadata/tag edits; lists have rename forms. Read-only models and
users have no bulk checkboxes. Supported deletion/revocation selection stays on
the current page and clears when requests change. Confirmation displays affected
records and lifecycle consequences, including account-email invalidation.

The UI submits the agreed POST `/api/admin/mutations` contract, re-fetches after
success, and localizes confirmation-delivery warnings and safe request errors.
Successful deletions show a localized shadcn success toast. Deleting from a detail
page replaces that URL with the model list, preserving the originating list query
instead of re-fetching the deleted record; bulk deletion refreshes the current list.
The endpoint reauthorizes each operation in a database transaction. Track tags
come from the authorized parent detail response and are saved only with a parent
track edit. The server and UI share browser-safe editable-field definitions while
the server independently enforces every operation. No admin state is persisted in browser storage; hidden-page cleanup
aborts reads and discards records/forms/selection, with fresh authorization on
restore. Route refresh after logout or privilege changes replaces private UI.

Admin browser acceptance lives in `tests/e2e/admin-ui.spec.ts`; run it with
`pnpm exec playwright test tests/e2e/admin-ui.spec.ts --workers=1` against a
migrated development database and the existing capture-email harness. It covers
guest route protection, localized current-admin menu visibility, all models,
read-only selection restrictions, query-preserving details, mobile navigation,
themes/hydration, selection reset, edit/delete confirmation contracts, and removal
of access on the next request. Mutation browser flows exercise the real endpoint and persisted list changes.
`tests/db/admin.test.ts` additionally verifies safe related labels, a full 100-row
page sharing one owner within four database reads including authorization,
deduplicated lookup parameters, missing-target races, and revoked access.
`tests/e2e/admin-labels.spec.ts` checks list/detail labels, relation links and
query-preserving navigation in English/Spanish and both themes, with hydration
diagnostics and no related-detail HTTP request fanout.

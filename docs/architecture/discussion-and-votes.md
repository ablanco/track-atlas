# Discussion, notifications, and votes

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Track votes and popularity

`track_votes` stores one current thumbs-up (`direction=1`) or thumbs-down
(`direction=-1`) per `(track_id,voter_id)`, with foreign keys to tracks and users,
fresh database-default audit columns and the `public.set_updated_at()` update
trigger. No row represents a withdrawn vote. The first-release baseline includes
non-null integer `tracks.popularity`, defaulting to zero. Its vote
insert/update/delete trigger applies atomic score deltas
to the track, including cascaded vote removal, in the same transaction. Negative
scores are valid. Separate up/down counts are read from the current votes;
counts, stored popularity, selected vote and access share one statement snapshot.

`tracks/votes.ts` derives the voter exclusively from the session. Only active,
authenticated, email-confirmed users may vote on public tracks owned by someone
else. Ready GPX storage and an active uploader are required, just as for ordinary
details access. Mutations lock voter/uploader accounts in UUID order, then the
session and track, and recheck access, visibility, confirmation, active status
and database-clock session expiry after lock waits. A final expiry check before
return rolls back changes if the session expired during later work. These locks
serialize vote writes with account, visibility and deletion changes; the track
lock also serializes concurrent voters and makes retries exact.

`PUT /api/tracks/[id]/vote` accepts exactly `{ "vote": "up" | "down" | null }`,
a desired state rather than a toggle. Repeating it preserves the same result;
replacing down with up adds two to popularity, replacing up with down subtracts
two, and null withdraws the vote. The HTTP adapter validates trusted Origin,
Fetch Metadata, query shape, JSON/encoding and a bounded 1 KiB request body.
Success returns current totals, popularity, selected vote and eligibility.
Failures use safe errors and all responses are private/no-store with nosniff.
Missing/inaccessible tracks return the same not-found failure without private
metadata. Client-supplied voter identities and unknown fields are rejected.

The details page reads personalized state at request time under its existing
connection/Suspense boundary, outside shared caches. `TrackVotingProvider` shares
current vote state between outlined Like/Dislike thumb buttons with counters and
`TrackPopularity`, the first of six main statistics. Popularity has a text label
and no icon. A track toolbox sits to the right of the map in a 4:1 desktop grid
with its top aligned to the map surface below the shared heading/help row,
and follows the map on mobile. It groups owner editing controls, GPX download
(or the guest login prompt), voting, and a labeled save-to-lists button. All
supported languages and both themes use localized accessible button labels. Eligible users
receive accessible pressed-state Phosphor buttons; choosing the selected button
requests withdrawal. Controls serialize requests and adopt returned totals only
after success; failures retain the prior state and show a localized alert. Guests
and owners receive totals only; unconfirmed users on another user's public track
receive a localized confirmation prompt and settings link. Request-time keys
remount personalized state when authentication refreshes the details page.
Explorer entries contain neither controls nor vote totals.

Visibility changes retain votes, including on private owner details, and retained
votes count when tracks become public again. Voter deactivation does not remove
votes or change scores; uploader deactivation continues to hide tracks. Track
deletion cascades its votes. These retention rules implement ADR-0004.
Administration discovers `track_votes` as a read-only composite-key model with
track/voter relations and filters; track popularity is inspectable and excluded
from editable fields. Vote update/delete/revoke and direct popularity overrides
are rejected by the administration mutation boundary.

`pnpm test:tracks:db` includes vote service/HTTP cases for explicit states,
retries, both switches, withdrawal, negative scores, concurrent same/independent
voters, exact totals, authorization failures, retained totals, deletion cascades,
read-only administration and account/session/visibility changes during lock
waits. Explorer database coverage verifies popularity before pagination in all
three scopes with existing time/UUID ties, filters, clamping and fresh rankings.
Focused browser cases (`details votes refresh` in `tests/e2e/tracks.spec.ts`)
exercise real votes, selected states, refreshed totals, failure retention,
guest/unconfirmed/owner/private-owner presentation and details-only placement
in English/Spanish and light/dark themes, with shared hydration assertions.

## Track discussion backend

`tracks/comments.ts` provides request-specific, server-only comment/reply services.
`tracks/comment-types.ts` contains browser-safe result contracts; account IDs,
email addresses, full surnames, stored-file identifiers and modification timestamps
are excluded. Active authors use their current display name or first name and
surname initial. Inactive authors retain text but expose a null name/avatar and a
deactivated flag for localized presentation.

`GET /api/tracks/:id/comments?page=N` reads ten top-level comments, oldest first,
with UUID tie-breaking; each includes its one existing owner reply. The alternative
`?comment=UUID` resolves the page containing that parent comment, for direct links.
A missing/deleted comment or inaccessible track returns 404. Empty lists have one
page; an explicit page beyond the end returns an empty list with the requested
page and current total/pages. Reads authorize access, resolve current identity,
and select all page data in one SQL snapshot. Active owners can read private
tracks; other readers require public visibility. Every read also requires an
active track owner and the track's owned ready GPX original.

`POST /api/tracks/:id/comments` creates a top-level comment.
`POST /api/tracks/:id/comments/:commentId/reply` creates the track owner's reply.
Both accept exactly `{text: string}`, trim text and allow 1–2000 Unicode code
points, rejecting NUL/unpaired surrogates. Responses contain
`{id, commentId, page}`; reply results identify the parent in `commentId`.
Only active, confirmed session accounts can post; owners may comment on their own
tracks, and admin status grants no additional ordinary-site rights. Replies cannot
have replies. There are no public edit/delete operations.

Writes lock actor/owner accounts in UUID order, then the current session, track,
and reply parent where applicable. They recheck session expiry after waits and
before commit. A PostgreSQL ledger admits at most one combined comment/reply per
account per 30 seconds and twenty per rolling hour. Account locks serialize
concurrent requests across tracks and both post kinds. Ledger inserts and posts
commit together; deletion of a post or track cannot reset posting limits.
`discussion_post_events` records no text or track identity. Operators may prune
events older than one hour; automatic pruning is not implemented.

Comment/reply avatar endpoints beneath the parent URL serve only the current
author's 24px WebP derivative. They enforce the same track access, active author,
owned ready avatar, storage location, byte length and SHA-256 checks, then recheck
access and the current avatar after storage reads. They never serve originals or
caller-selected file identifiers. All discussion data/media responses are private
and no-store. POST validates trusted Origin, cross-site metadata, JSON content
type/identity encoding, strict query shape, fatal UTF-8 and a streamed 16KiB body
limit before parsing. Errors are stable codes without exception details.

The first-release baseline includes
`track_comments`, `track_comment_replies`, and `discussion_post_events`,
with fresh audit columns/triggers on all three tables. Track deletion cascades
parents and replies; parent deletion cascades replies, while deleting a reply
permits a replacement. Author foreign keys restrict hard deletion, preserving
discussion through normal reversible account deactivation. The baseline also
includes `users.discussionEmailsEnabled` (non-null, default true) and
`users.discussionEmailLocale` (nullable, constrained to all six supported locales).
Core services do not send email; post-commit notifications, administration, and localized
discussion/settings controls are described below. Administration has its own
authorization boundary.

The comments DB/HTTP suite is included in `pnpm test:tracks:db`. It exercises
permissions, private-owner self-posting, safe current/deactivated identity,
derived-avatar access/races, Unicode validation, pagination/direct links,
concurrent posting/replies, both throttle windows, retention/cascades, audit
triggers, preference defaults/constraints, HTTP rejection paths and authorization
changes/session expiry during lock waits.

### Discussion administration

Administration lists and details `track_comments` and `track_comment_replies`,
including private tracks and retained posts by deactivated accounts. Safe
projections include text, immutable author/parent identifiers, and audit dates;
links lead to authorized admin author, track, and parent-comment details. Lists
support literal text search, allowlisted sorting, author and parent filters, and
25/50/100-row pages. The internal `discussion_post_events` ledger remains excluded.

Both models support text-only updates and atomic 1–100-record deletion batches
through the existing admin mutation endpoint. Text uses the ordinary discussion
validator (trimmed 1–2000 Unicode code points); author, associations, and original
posting time cannot change. Moderation creates no notifications or public edit
marker. Deleting a comment cascades its reply; deleting only a reply permits a
new owner reply subject to the existing account-wide posting allowance. Neither
operation clears the ledger. Admin privilege grants no ordinary reply rights.

Moderation locks affected author/owner accounts together with the administrator
in UUID order, then the acting session, sorted tracks, sorted parent comments,
and target replies. It rechecks active/admin privileges and database-clock session
expiry after lock waits and before commit. A missing target aborts the entire
batch, including earlier deletions and cascades. User administrative editable
fields continue to exclude discussion-email preferences; only the authorized
account-settings path may update those preferences.

`tests/db/admin-comments.test.ts` covers retained-data reads/links, filters,
search/sort/pagination, immutable fields, Unicode text, HTTP authorization and
validation, reply recreation, cascade/ledger retention, atomic rollback after a
concurrent target deletion, and posting/moderation and authorization lock waits.
`tests/e2e/admin-comments.spec.ts` covers localized panel navigation, multiline
plain-text edits, immutable-field presentation, safe parent links, deletion
consequences, real mutations, and both themes with hydration assertions.

### Discussion notifications and account preferences

`tracks/discussion-notifications.ts` makes one best-effort delivery attempt after
comment/reply HTTP creation commits. It reselects the current post and recipient,
suppresses self-notifications, and enforces active/confirmed/enabled recipients
and ordinary track access, including the active owner and ready owned GPX.
Eligibility is read again after budget reservation so a lock wait cannot preserve
stale preferences, email or visibility. No edit/delete notification or outbox/retry
exists. Delivery failure leaves the saved POST response at 201; operational logs
contain a fixed failure message and kind, without provider errors or user data.

`email/discussion-budget.ts` reserves a separate PostgreSQL UTC-day bucket under
its own transaction advisory lock, choosing the day after waiting. The configured
`DISCUSSION_EMAIL_DAILY_LIMIT` defaults to 250, allows zero, and counts failed
attempts. Account-email allowance remains independent. If eligibility disappears
between reservation and its final read, the reserved slot stays charged. A change
after the final snapshot cannot recall an in-flight message. Templates in
`email/discussion-templates.ts` supply localized HTML/text for all supported languages
with safe current sender and track names, trusted-configuration direct-parent URLs, and no discussion text.

`tracks/discussion-preferences.ts` and its HTTP adapter expose the session-owned
GET/PUT contract at `/api/discussion-preferences`. Active unconfirmed accounts
may manage the toggle and language. Reads return `{enabled,locale}` with null
initial locale; updates require exactly boolean enabled plus a supported locale and
lock user before session, rechecking active status and expiry after waits and
before commit. Requests enforce trusted Origin, strict JSON, no queries and a
1KiB streamed limit; responses are private/no-store. UI initializes null language
from the current site locale when saving; delivery defaults null to English.

The notification/preferences DB suite uses mocked transports, concurrent database
reservations and an isolated test-only clock to cover UTC rollover, the default
250 allowance, failures charged, account-budget independence, access/preferences
changes, safe logs, successful comment/reply HTTP integration, and rejected or
revoked/expired settings sessions. It is included in `pnpm test:tracks:db`.

### Localized discussion interface

Track details end with `components/track-comments.tsx`, below metadata. It reads
personalized discussion state through the private/no-store comments API, outside
shared caches. Ten parents appear per page with their owner replies, using shared
shadcn pagination. Localized `?comment=UUID` links resolve the parent's current
page through the API and focus that comment; ordinary pagination uses `?page=N`.
Language changes retain the discussion query. Successful posts replace the URL
with a direct parent link and re-read its page. Deleted or inaccessible direct
links show a localized unavailable-comment error; pages beyond the end normalize
to the last current page.

Author presentation uses the current safe display label and protected 24px
avatar directly, with initials or a generic deactivated-user fallback. Escaped
plain text preserves newlines without Markdown, HTML or automatic links. Dates
render after the browser's authorized read, in the reader's timezone with
localized absolute date, time and timezone label. Each parent comment has an
accessible link icon beside its timestamp for its permalink; no server-local date is
hydrated into a different browser timezone. A stable shell around streamed charts
keeps login-modal isolation markers off their deferred hydration roots.

Leave comment follows the list, including an empty list and guest reads. Guests
open the existing login/recovery dialog; unconfirmed accounts receive an account
settings link. Eligible accounts get an inline textarea; only eligible owners
see Reply on unanswered parents. Both entry controls use labeled ChatCircleText
icons. Submit and Cancel disable during creation, validation counts trimmed
Unicode code points, and server errors remain authoritative. Recoverable errors
retain drafts; uncertain transport failures advise checking the discussion
before resubmitting and never automatically retry creation.

Discussion reads and writes abort on tab hiding or route effect teardown.
Records, dialogs and drafts are discarded, including when React Activity retains
an offscreen page. Focus, visibility restoration, browser restoration and cached
route return reauthorize against the current session and track access. Logout
and confirmation changes therefore remove stale forms on the next fresh read;
authentication never enters a shared cache or browser storage.

Settings includes an independent discussion-email form using the fixed
`/api/discussion-preferences` GET/PUT contract. Its enabled toggle and supported-language
controls load only for an authorized account, initialize a null saved
language from the current site locale, display native language names, and persist
both values on Save. Notification subjects, text and destination links follow the
saved language. Active unconfirmed accounts may save preferences. Pending, saved and safe failure states
are localized; hidden-page cleanup discards drafts and re-reads saved values on
return without disturbing the other settings forms.

`tests/e2e/comments.spec.ts` exercises real development PostgreSQL, private local
storage and the capture-only email harness. It covers EN/ES light/dark posting,
owner replies, Unicode bounds, rate-limit failures, direct links/pagination,
guest/unconfirmed gates, reader timezone dates, preferences persistence,
current/deactivated identity and protected avatars, real login-widget verification,
revoked sessions, cached navigation and shared hydration diagnostics.

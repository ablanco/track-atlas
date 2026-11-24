# Following and digest persistence

GitHub #72 includes the #73 foundation, #74 localized following controls and
#75 scheduled digest delivery. Uploads never invoke email.

## Private following interfaces

`following/types.ts` exports browser-safe `FollowState`, `FollowingItem`,
`FollowingPage`, `DigestPreferences`, and `FollowingErrorCode`. Server services in
`following/service.ts` derive the follower exclusively from a current, active,
legally accepted session. Email confirmation is not required. Mutations lock all
affected users in UUID order, then the session, and recheck authorization after
lock waits and before commit. No relationship grants Track access.

- `GET/PUT /api/users/:id/follow`: GET returns `{following, eligible}`; PUT accepts
  exactly `{following: boolean}`. Following requires an active uploader with an
  ordinarily accessible public Track and ready owned original GPX. Removing an
  edge remains possible after deactivation or loss of public Tracks. Repeated
  desired state requests are safe; repeated true preserves the original boundary.
  Self-follow is rejected. Inaccessible and missing new targets both return 404.
- `GET /api/following?page=N`: session-owned list, 25 entries per page ordered by
  followed time descending and uploader UUID ascending. Returns `items`, `total`,
  `page`, `pages`, clamping out-of-range pages (including after final-row removal).
  Each item contains `id`, `displayName`, `active`, `avatarUrl`, `collectionUrl`,
  `followedAt`. Inactive identities have null display name, avatar and collection
  URL; clients supply a localized generic name. Active names use the existing
  public display-name fallback. Collection URLs are locale-free navigation paths
  `/users/:id/tracks` for use with locale-aware navigation.
- `GET /api/following/:uploaderId/avatar`: authorizes an existing edge and an
  active uploader's current ready owned 24px avatar version. It checks storage
  location, byte length and SHA-256 and rereads identity/edge/version after I/O.
  The DTO never exposes another account's stored file ID.
- `GET/PUT /api/digest-preferences`: independent `{enabled,locale}` preferences;
  PUT requires exactly a boolean and a supported locale (`en/es/fr/pt/de/it`).
  Unsaved language is null, enabling an English delivery fallback. Turning the
  setting off or back on sets `digest_resume_after` from the database clock;
  only a false-to-true change revokes existing digest opt-out tokens. Following
  and refollowing never change preferences.

Every response is private/no-store with nosniff. PUT requires the trusted origin,
rejects cross-site metadata, accepts only identity-encoded UTF-8 JSON up to 1 KiB,
and rejects unknown fields and query parameters. Following accepts only one
positive integer `page` query. Services expose safe fixed error codes; adapters
return 400/401/403/404/413/503 or 405 with Allow.

## Publication and durable delivery authority

`uploader_follows` has a unique non-self pair and a database-selected `followed_at`.
Unfollow removes the generation; refollow inserts a new generation. Public Track
creation selects `clock_timestamp()` once after locking the uploader and inserts
that exact microsecond timestamp in every output's nullable `digest_published_at`.
Private creations and historical Tracks retain NULL. Visibility edits cannot
change this evidence; a database trigger forbids updating it. The partial
publication index supports bounded delivery scans. This shares the uploader lock
with following, serializing the publication/follow boundary.

Users hold independent digest enablement/language, resume boundary and durable
closed-window cursor. Operational tables contain no email addresses, bodies,
titles or raw tokens:

- `digest_deliveries`: UUID identity, recipient/day uniqueness, half-open window,
  pending/sending/retryable/sent/empty/suppressed/uncertain/failed/superseded state,
  attempts 0–3, attempt UUID, sending/accepted/retry timestamps and allowlisted
  outcome code. Window end must be UTC midnight on delivery day. Sending and
  attempted outcomes require attempt authority; only sent has accepted_at and
  only retryable has next_attempt_at.
- `digest_dispatch_days`: recipient/actual UTC dispatch-day primary key and
  nullable delivery reference. It is a durable dispatch fence independent of
  history pruning; rejected retries may reuse the same delivery's fence.
- `digest_scheduler_progress`: singleton id=1 with nullable UUID scan cursor,
  initialized by migration. The scan cursor deliberately has no FK so account
  deletion cannot block scanning; erasure clears it if it names that account.
- `digest_opt_out_tokens`: UUID identity, recipient, unique SHA-256 hash, expiry,
  consumed time. Dedicated digest authority, independent of account-link tokens.
  Issuance, consumption and bounded pruning belong to delivery implementation.

The approved delivery policy is one consolidated message per actual UTC day,
seven-day catch-up, three attempts with confirmed rejection retry delays of 15
and 60 minutes, no retry for unknown outcomes, ten-minute stale sending cutoff,
50 entries and ten overflow uploader links, 128 KiB rendered bound, a separate
250-attempt default daily allowance (zero pauses), and 90-day terminal/token
retention. The processor implements claims, final eligibility reads, cursor
advancement and protected pruning; operators install the timer explicitly.

## Erasure and administration

The first erasure withdrawal transaction removes edges on both sides and all
recipient deliveries, dispatch fences and opt-out tokens, even while storage
cleanup is pending. Dry-run scope reports each category. Resume repeats cleanup
without replacing the original withdrawal timestamp. Deactivation immediately
prevents follow creation, private API use and avatar access; delivery must also
filter inactive recipients/uploaders before dispatch.

The administrator model registry is an explicit allowlist: operational tables,
follow relationships, token hashes, publication evidence and digest user fields
are excluded from browsing/editing. Each new table uses database audit defaults
and a `public.set_updated_at()` row trigger. Migration `0001` includes generated
SQL/metadata, custom audit/immutability triggers and singleton initialization.

## Processor and transport

`processDigests` in `digests/processor.ts` is the scheduled-delivery entry point.
It reserves the first half of each run's remaining time for a persistent UUID
keyset scan, then independently discovers up to 100 oldest due recipients.
Unconfirmed accounts, future retries and fresh sending intent are excluded from
that independent pass; stale sending intent remains discoverable. Enumeration
allocates one account per short scheduler-progress transaction, advancing the
cursor immediately before processing that account. This replaces bulk pages of
100: advancing a whole page before processing can repeatedly skip its tail when
runs expire. A crash can skip one allocated account until wraparound; concurrent
workers allocate distinct next accounts and delivery claims still deduplicate.
Stable deferred cohorts therefore cannot consume every run before persisted
progress. Work stops starting after 50 seconds; transport is serial. Short claim transactions lock recipient then job,
read PostgreSQL time after waits, supersede old pending/retryable jobs, clamp
catch-up to seven days and commit send intent before transport. Deferred
unconfirmed recipients retain their open history; inactive/disabled recipients
close as suppressed. The same content predicates preflight eligible Tracks before
quota or send intent. Empty windows close without quota or opt-out-token work,
including at limit zero. A final snapshot after reservation still rechecks all
eligibility; withdrawal after preflight can close empty with a charged slot.

Quota uses its own advisory lock and `digest:daily:YYYY-MM-DD` bucket, coordinated
with the shared pruner's table lock. `DIGEST_EMAIL_DAILY_LIMIT` defaults to 250;
zero defers nonempty work without advancing its closed-window cursor. Every reservation stays charged,
including failed or midnight-aborted attempts. A unique recipient/dispatch-day
fence allows only the same job's confirmed-rejection retries. Crossing midnight
before transport returns the claim to pending for later supersession; crossing
inside transport also fences the observed completion day before finalization.
A stale sending row older than ten minutes becomes uncertain and fences the
observed day. Terminal cursor advancement and attempt-UUID-checked finalization
are transactional. A database failure after dispatch leaves sending intent for
that conservative stale closure; it does not reopen delivery.

Current recipient consent/confirmation/activity, current follow generation and
resume boundary, active uploader, public visibility and ready owned original GPX
are reselected together immediately before rendering. Publication evidence is
compared in PostgreSQL, preserving microsecond boundaries. A mutation committed
after that final snapshot may still appear in the in-flight email. No locks are
held across transport and no instantaneous recall guarantee is made.

`digests/render.ts` uses the six catalogs' `DigestEmail` namespace and localized
activity names. It fetches aggregate totals separately from the bounded detail
projection, groups deterministic uploader/publication/Track order, truncates
user text to 160 Unicode code points, strips controls/template braces and escapes
HTML. Content has at most 50 details, ten current public uploader collection links
and Following/explorer links for overflow; HTML plus text stays within 128 KiB.
Overflow is summarized and closes with the window. Descriptions, coordinates,
photos and private profile details never enter the message.

Transport distinguishes rejection, unknown and pre-dispatch not-attempted failure.
Only confirmed transient rejection retries, at +15 then +60 minutes, up to three
charged attempts. Unknown results and stale sending are terminal uncertainty.
[ADR-0012](../adr/0012-durable-digests-with-conservative-uncertainty.md) records the
trade-off and provider documentation. Account/discussion behavior remains intact.

## Opt-out boundary

Each claim issues a random 32-byte bearer token, storing only SHA-256 and a
90-day expiry under the recipient lock. Issuance never revokes older emails;
explicit reenable revokes all old tokens. `consumeDigestOptOut` locks account then
token, checks expiry after waits, consumes atomically and disables digest only.

Localized `/digest-opt-out` is a standalone route-handler confirmation document,
with `DigestOptOut` copy in all six languages, keyboard-native form controls and
light/dark system colors. GET never consumes authority. POST accepts only one
UTF-8 form token, at most 1 KiB, identity encoding, trusted Origin and same-site
metadata. Native no-referrer forms with opaque Origin additionally require
same-origin navigation metadata and a Host matching trusted configuration.
Invalid/expired/replayed authority has one safe outcome with a Settings
link. No session or supplied user ID is accepted. The document has no scripts or
external assets, private/no-store, no-referrer, noindex, nosniff and restrictive
CSP. Next incoming-request logging excludes this path; it is absent from SEO and
browser traces. Operators must also redact/exclude it in ingress access logs and
external tracing collectors. This is an explicit confirmation flow, not RFC
one-click unsubscribe.

`pnpm db:prune` removes one bounded, skip-locked batch of expired/consumed digest
tokens and terminal delivery rows older than 90 days. It preserves unresolved
jobs, current delivery-day uniqueness, durable user cursors and dispatch fences
for at least 90 days. Fences are pruned only after their dispatch day is older
than 90 days. Erasure removes live authority during first-stage withdrawal.

## Following and preference presentation

Track details show Follow in the same wrapping row as the uploader's display name,
with explanatory copy below; the control is hidden for the owner.
The control uses desired-state PUTs and adopts only server-confirmed state;
a failed change retains the prior state. Guests use the shared login dialog in
place. Copy explains daily email, deferred delivery until email confirmation,
and independent digest Settings. Following does not enable a disabled digest.
The deferred-confirmation notice appears only for signed-in, unconfirmed viewers.
Follow state and Following-list responses include the current session account's
confirmation flag, so private-state refreshes update the notice without exposing
another account's confirmation status.

The signed-in menu links to localized `/following`. Request-time authentication
runs below Suspense and redirects guests home; the page is noindex and private,
with no-referrer response headers. Its private API supplies complete 25-item
pagination, safe inactive identities, authorized avatar URLs and public collection
links. Navigation uses the shared shadcn pagination components with locale-aware
numbered links, ellipses and disabled boundary controls. Failed unfollow retains
the row; success reloads the clamped server page.
No request-specific follow state enters shared server caches.
Public collection headers show only an aggregate active-follower count under the
existing collection identity boundary; they expose no follower list or private
account fields. Counts are independent of digest delivery preferences.

Follow controls and the Following list discard browser state on page hiding,
focus restoration and Activity navigation, abort stale requests, and reauthorize
on return. Unauthorized responses clear private list data. Writes are serialized,
with disabled controls and accessible pending/error feedback.

Settings has a separate daily-digest switch and language form, independent of
DiscussionPreferences. A null saved language initializes from the current site
locale in the editor; saving persists an explicit supported language. Failed saves
retain edits for retry; session loss clears them. Page hiding/navigation discards
private preferences and return reauthorizes them. All labels and errors live in
`Following` and `DigestPreferences` across the six locale catalogs.

## Integrated acceptance

The [verification guide](../testing.md#durable-digest-delivery-and-opt-out) covers
actual multi-track publication from multiple followed uploaders through one
consolidated message, bounded-run continuation, and combined private Following
and opt-out browser coverage. The worker deadline stops starting new recipient
work; an already-started claim/transport/finalization may finish after it.

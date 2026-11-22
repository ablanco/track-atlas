# Following and digest persistence

The foundation for GitHub #72 is implemented by #73. The localized controls and
scheduled delivery are separate integration tasks; uploads never invoke email.

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
retention. The processor must implement claims, final eligibility reads, cursor
advancement and protected pruning; table presence alone does not send messages.

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

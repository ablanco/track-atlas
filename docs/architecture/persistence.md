# Persistence and migrations

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Persistence and migrations

[`db/schema.ts`](../../db/schema.ts) maps camelCase application fields to
snake_case SQL columns. The foundational account/storage tables are:

| Table                   | Data and constraints                                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                 | Database-generated UUID; required first/last name, email, password hash, date of birth; nullable display name, legacy avatar URL and managed avatar-file FK; `active` defaults true; non-null `admin` and `emailConfirmed` default false |
| `sessions`              | UUID, user FK with delete cascade, unique token digest, timezone-aware expiry; user-ID index                                                                                                                                             |
| `captcha_uses`          | Challenge-signature digest primary key, timezone-aware expiry and expiry index                                                                                                                                                           |
| `account_action_tokens` | UUID/user FK, restricted purpose, unique secret digest, expiry/consumption/revocation timestamps and user/purpose/expiry indexes                                                                                                         |
| `email_send_limits`     | HMAC-address/purpose or UTC-day bucket key, bounded timestamp array, database-backed sending reservations                                                                                                                                |
| `deleted_track_uploads` | Minimal owner/request/track deletion identities independent of file cleanup, composite primary key, unique deleted track ID, owner cascade and audit trigger                                                                             |
| `stored_files`          | Server-generated UUID, owner FK with restricted deletion, purpose/status checks, explicit object key, storage-location fingerprint, bounded byte size, content type/hash, expiry/deletion timestamps and audit trigger                   |

Email uniqueness is enforced by a unique `lower(email)` index, including inactive
accounts. SQL checks enforce nonblank names/email/password hash and trimmed
email, not full application validation or cryptographic hash validity. Birthdays
use SQL `date` mapped to `YYYY-MM-DD` strings, avoiding timezone conversion.
User/session select and insert types are inferred from the schema. Future public
profile queries must explicitly select safe fields instead of serializing users.

Every table spreads a fresh `auditColumns()` result: non-null timezone-aware
`created_at` and `updated_at`, initialized by database defaults. Each migration
attaches a `BEFORE UPDATE` trigger calling `public.set_updated_at()`, so Drizzle
and direct SQL updates use database modification time, overriding stale supplied
values. Runtime-only ORM hooks are not a substitute.

Additional models are described with their owning features:

- [Tracks](tracks.md): `tracks`, `track_data`, `track_tags`,
  `track_directional_representations`, and `track_upload_attempts`.
- [Lists](lists.md): `track_lists` and `track_list_memberships`.
- [Photos](files.md#track-photos): `track_photos` and `track_photo_versions`.
- [Discussion and votes](discussion-and-votes.md): `track_votes`, `track_comments`,
  `track_comment_replies`, and `discussion_post_events`.
- [Legal evidence](legal-and-erasure.md): `legal_acceptances` and irreversible
  account-erasure state on `users`.

The first release starts from [`0000_initial-schema.sql`](../../drizzle/0000_initial-schema.sql)
and its matching Drizzle snapshot and [journal](../../drizzle/meta/_journal.json).
This baseline replaces the unreleased development migration history and applies
only to an empty database; no upgrade or data backfill from that history is provided.
It enables PostGIS and `unaccent`, creates all current tables, constraints and
indexes from `db/schema.ts`, and includes the custom SQL functions and triggers
that Drizzle Kit cannot infer. The segment validator is created before the table
checks that call it; publication and security functions/triggers follow the tables.

`getDb()` initializes a pool lazily, retaining it across development hot reloads
via `globalThis` and at module scope in production. The pool has a five-second
connection timeout and sanitized idle-connection error logging. Low-level
`createDatabase` supports tools/tests that own and close their connections.

Migrations run explicitly through Drizzle Kit, not at build or request time.
Applied migrations are immutable; commit new SQL and metadata together and
review trigger SQL that Drizzle Kit cannot infer. See the README for commands.

Full geometry uses MultiLineString; each directional representation remains a
LineString keyed by `(track_id, segment_index, intermediate_count)`. Version-1
rows remain valid; new uploads use derivation version 2.

A bounded immutable SQL check enforces 1–100 nonempty geometry parts, at least two
vertices per part, exact cumulative sample offsets and matching total sample and
vertex counts (at most 100,000). Deferred publication checks require the Track's
segment/point counts to match geometry, exactly five variants for every segment,
matching derivation versions, owned ready original and complete upload receipt.
The parser additionally enforces positive length for each segment before storage.

Ordered upload receipts support independent output sets. `tracks.upload_index`
is zero-based (default 0, bounded 0–99); the unique owner/request key is
`(owner_id, request_id, upload_index)`. The unique original-file key ensures every
output has one independent file. `track_upload_attempts.track_ids` stores ordered
complete/deleted identities. Its first-file and first-Track FKs are nullable
`ON DELETE SET NULL`, and account deletion cascades receipts. Pending/failed
receipts have no output IDs; complete/deleted receipts have 1–100. Deletion clears
content-bound receipt fields; ordered IDs are identity bookkeeping, excluded from
administrative projections.
`deleted_track_uploads` uses `(owner_id, request_id, track_id)` as its primary
key so every independently deleted sibling retains its own safe deletion retry.

Deferred checks validate each output's ordered position/owner/request, complete
derived records, ready owned original, and the entire completed set. Missing,
duplicate, null or reordered receipt IDs reject publication. Deleted receipts
permit missing outputs only with their deletion tombstones. A deferred Track
DELETE guard protects later outputs as well as the first, whose FK already
protects its receipt. `stored_files.upload_group_id` is an admission identity,
not an ownership or deletion cascade: all output file rows in one reservation
share its first generated file ID. Standalone generic uploads have a null group ID
and count individually. No source GPX or metadata is added to deletion bookkeeping.

An immutable-identity trigger rejects updates to a Track's ID, owner, upload
request, output index or original-file association while allowing metadata edits.

New complete receipts, including singleton fixtures, must supply the ordered
`track_ids` array explicitly; a default empty array is valid only for unfinished
states. Fixture teardown removes receipts and owned Track/file data in one
transaction with deferred checks enabled.
Production deletion continues through the shared tombstone lifecycle, preserving
identities after independent file cleanup.

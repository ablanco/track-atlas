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

The initial migrations established the account and storage foundation below.
This is a historical subset; the [migration directory](../../drizzle/) and
[journal](../../drizzle/meta/_journal.json) are the complete ordered history.
Later feature references explain their schema changes.

| Migration                           | Change                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `0000_enable-postgis.sql`           | Enable PostGIS                                                                                 |
| `0001_add-users.sql`                | Users and shared modification-time trigger function                                            |
| `0002_add-sessions.sql`             | Sessions and audit trigger                                                                     |
| `0003_add-user-flags.sql`           | Admin/email-confirmation defaults, backfill, non-null constraints                              |
| `0004_add-captcha-uses.sql`         | Single-use proof tracking and audit trigger                                                    |
| `0005_add-account-email-tokens.sql` | Account action tokens and email sending buckets, constraints/indexes and both audit triggers   |
| `0006_add-stored-files.sql`         | Owned private files, lifecycle and metadata constraints, cleanup indexes and audit trigger     |
| `0007_add-original-avatars.sql`     | Optional avatar-file FK, original-image MIME types, explicit object keys and flat-key backfill |
| `0008_broaden-avatar-formats.sql`   | Broader canonical raster-image MIME constraint for avatar originals                            |

`getDb()` initializes a pool lazily, retaining it across development hot reloads
via `globalThis` and at module scope in production. The pool has a five-second
connection timeout and sanitized idle-connection error logging. Low-level
`createDatabase` supports tools/tests that own and close their connections.

Migrations run explicitly through Drizzle Kit, not at build or request time.
Applied migrations are immutable; commit new SQL and metadata together and
review trigger SQL that Drizzle Kit cannot infer. See the README for commands.

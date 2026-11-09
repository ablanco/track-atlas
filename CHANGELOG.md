# Changelog

Notable changes to Track Atlas are recorded here. Versions follow Semantic
Versioning.

## 1.1.0 — Unreleased

### Added

- Automatic VPS deployment after publishing stable release packages, with pinned
  SSH host verification, serialized activation, and application rollback on failed
  health checks. Existing release assets can also be deployed manually.

## 1.0.0 — 2026-11-06

Initial release.

### Added

- Account signup and login, persistent sessions, email confirmation, password
  recovery, profile settings, and private avatars, with ALTCHA protection.
- GPX 1.0/1.1 uploads with private or public visibility, recorded segment
  boundaries, and atomic multi-track imports with independent downloads.
- Interactive Track maps with selectable basemaps, retained waypoints,
  distance and elevation statistics, and elevation and speed charts.
- Public Track search and owner collections with activity, difficulty, distance,
  elevation, viewport, and geographic corridor filters.
- Private lists for organizing accessible Tracks.
- Track photo galleries, metadata editing, visibility controls, and deletion.
- Track votes, popularity ranking, comments, owner replies, and configurable
  discussion email notifications.
- Public Track sharing and temporary, authorized GPX Studio handoff.
- English, Spanish, French, Portuguese, German, and Italian interfaces, with
  responsive layouts and light, dark, and system themes.
- Versioned legal documents, adult signup, recorded legal acceptance, and
  renewal when required documents change.
- Administrative model browsing and controlled mutations, plus a staff-operated
  permanent account erasure workflow.
- Private local or Backblaze B2 file storage, Brevo transactional email,
  upload cleanup tooling, and an initial PostgreSQL/PostGIS schema migration.
- Opt-in search indexing, localized metadata, social previews, structured data,
  and sitemap discovery.
- Bounded online database pruning for expired sessions, unusable account links,
  CAPTCHA replay records, and obsolete email-limit buckets.

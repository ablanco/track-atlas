# Track Atlas architecture

This document describes the implemented system, its security boundaries, test
coverage, and operational responsibilities. For installation, configuration, and
commands, see [README.md](README.md); for contributor rules, see
[AGENTS.md](AGENTS.md).
[Product design](docs/DESIGN.md) describes the intended product, not a list of
completed features. See the [documentation index](docs/README.md) for reference guides, decisions,
and historical designs.

<a id="1-current-scope-and-stack"></a>

## Current scope and stack

Track Atlas is a single Next.js application backed by PostgreSQL. It currently
provides a homepage in English, Spanish, French, Portuguese, German, and Italian, light/dark/system themes, account signup,
modal login, current-session logout, persistent sessions, authenticated account
settings, Brevo API email confirmation/password recovery, and self-hosted ALTCHA
protection for signup and login.

Next.js is pinned to 16.4.2 for the security update from 16.4.0. The
`experimental.agentUpgrade` policy is `security`, enabling advisory-based upgrade
reminders without automatically updating dependencies.

A private file-upload API accepts avatar images, track photos, and GPX documents
through local storage or Backblaze B2. Settings supports optional avatar upload and private
128px Settings and 24px top-bar avatar display. Confirmed accounts can upload
private or deliberately public GPX Tracks with up to 100 tracks and 100 recorded segments per upload, read metric summaries and elevation/speed
charts and an interactive original-point map, and download each Track’s GPX;
full geometry, analytics and directional representations are derived at creation.
Multi-track GPX uploads preview ordered independent Tracks before creating them
atomically, with isolated downloadable files and an authorized collection
confirmation. Single-track uploads retain unchanged originals and details
navigation. Details maps display retained GPX waypoints with grouped accessible
popups; explorer payloads continue to omit them.
Public text/filter search and user collection browsing share a ten-track explorer.
Owners can browse private tracks in their own collections. Owners can edit track metadata in place and permanently delete tracks.
Active signed-in accounts can organize accessible tracks into private named lists,
separate from their uploaded collections, and browse each list in the explorer.
The shared explorer supports viewport and arrow/line spatial filtering with
canonical URLs, geographic corridors, and pointer/keyboard map drawing. Localized homepages and anonymously eligible public Tracks support opt-in search
indexing, social previews, structured data and sitemap discovery. Additional public profile
features are not implemented. The homepage's map is an illustration, not a map
service. PostGIS stores the full Track geometry and five directional representations per segment.

| Layer                     | Implementation                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Application               | Next.js 16.4 App Router, React 19.3, TypeScript                                                  |
| Rendering                 | Server Components, Cache Components, partial prefetching, Suspense                               |
| Interactive UI            | Client Components for form state, locale/theme controls, ALTCHA                                  |
| Localization              | `next-intl` 4.14.9, English, Spanish, French, Portuguese, German, and Italian JSON messages      |
| Styling                   | shadcn/ui Base UI Vega, Tailwind CSS 4, semantic tokens, `next-themes`, Phosphor Icons           |
| Persistence               | Drizzle ORM with the `pg` driver; PostgreSQL 18 / PostGIS 3.6 locally                            |
| Authentication protection | ALTCHA widget 3.3.0 and `altcha-lib` 2.6.0                                                       |
| Tooling                   | pnpm, ESLint, Prettier, Husky/lint-staged, TypeScript, Node test runner/tsx, Playwright Chromium |

The application requires a Node.js server runtime: authentication uses Node
crypto and PostgreSQL connections. There is no separate backend service, worker
queue or external CAPTCHA verification service. File storage uses the application
host's private filesystem or a private Backblaze B2 bucket. Brevo is the
external transactional email delivery boundary; no background email worker exists.

Current account security also includes a shared browser/server password-strength policy for signup, reset and password changes, adult-only signup, immutable legal acceptance
evidence, renewal gates for existing sessions, and staff-operated permanent erasure.
Administrators have a localized model browser and allowlisted mutations. Track
features include photos, votes, discussion, and configurable discussion email.

## Architecture reference

Read the topic relevant to the change. These documents describe implemented
behavior; [product design](docs/DESIGN.md) records broader product intent.
The anchors below preserve links into the former single-file reference.

<a id="2-module-boundaries"></a>

### [Module boundaries](docs/architecture/modules.md)

Server and browser responsibilities, request flows, and module map.

<a id="3-routing-and-rendering"></a>
<a id="4-presentation-and-browser-state"></a>
<a id="homepage-and-upload-entry"></a>

### [Routing, rendering, and presentation](docs/architecture/presentation.md)

Localized routes, Cache Components, shared UI, themes, hydration, and homepage.

<a id="5-signup-flow-and-validation"></a>
<a id="login-and-logout-flows"></a>
<a id="account-settings"></a>
<a id="6-authentication-and-bot-protection"></a>
<a id="account-email-confirmation-and-recovery"></a>
<a id="password-storage"></a>
<a id="sessions"></a>
<a id="altcha"></a>

### [Authentication and account settings](docs/architecture/authentication.md)

Signup, login/logout, settings, passwords, sessions, account email, and ALTCHA.

<a id="7-persistence-and-migrations"></a>

### [Persistence and migrations](docs/architecture/persistence.md)

PostgreSQL/PostGIS, audit timestamps, connection lifecycle, and migration rules.

<a id="8-runtime-configuration-and-operations"></a>
<a id="private-configuration"></a>
<a id="infrastructure-and-delivery"></a>
<a id="sensitive-data-and-maintenance"></a>

### [Runtime configuration and infrastructure](docs/architecture/runtime.md)

Private configuration, infrastructure, delivery, and sensitive-data maintenance.

<a id="10-file-uploads"></a>
<a id="track-photos"></a>

### [File storage, avatars, and track photos](docs/architecture/files.md)

Private object storage, upload lifecycle, quotas, avatars, and track photos.

<a id="11-tracks-and-public-publication"></a>
<a id="interactive-original-point-map"></a>
<a id="gpx-studio-handoff"></a>

### [Tracks, maps, and external editing](docs/architecture/tracks.md)

GPX ingestion, derived geometry and metrics, owner mutations, maps, and GPX Studio.

<a id="12-track-explorer"></a>
<a id="spatial-controls-and-map-lifecycle"></a>
<a id="server-queries-and-display-data"></a>

### [Track explorer](docs/architecture/explorer.md)

Search, collections, spatial controls, ranking, queries, and display geometry.

<a id="13-private-track-lists"></a>

### [Private track lists](docs/architecture/lists.md)

Private lists, memberships, authorization, and explorer integration.

<a id="administrative-read-foundation"></a>

### [Administration](docs/architecture/administration.md)

Staff authorization, safe model projections, mutations, and administrative UI.

<a id="16-track-votes-and-popularity"></a>
<a id="track-discussion-backend"></a>
<a id="discussion-administration"></a>
<a id="discussion-notifications-and-account-preferences"></a>
<a id="localized-discussion-interface"></a>

### [Discussion, notifications, and votes](docs/architecture/discussion-and-votes.md)

Votes/popularity, comments/replies, administration, notifications, and preferences.

<a id="public-legal-documents-and-revision-contract"></a>
<a id="adult-signup-and-account-legal-evidence"></a>
<a id="current-legal-acceptance-for-existing-sessions"></a>
<a id="staff-operated-permanent-account-erasure"></a>

### [Legal documents, acceptance, and erasure](docs/architecture/legal-and-erasure.md)

Immutable document revisions, adult signup evidence, session gates, and phased erasure.

<a id="9-verification-and-remaining-boundaries"></a>

## Verification and remaining boundaries

See [testing](docs/testing.md) for suite selection, safety requirements, and the
browser harness. Topic references describe their feature-specific coverage.

OAuth, a standalone global logout control, and self-service email changes, account
reactivation, and hard-deletion UI are not implemented. Permanent
erasure is a [staff operation](docs/account-erasure.md). Duplicate-email feedback
exposes registration status. Broader abuse protection, distributed admission
limits, automated expiry pruning, and production operational hardening remain
outstanding before a public production rollout.

# Legal documents, acceptance, and erasure

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Public legal documents and revision contract

Public EN/ES Terms and Conditions and Privacy Policy are served at
`/[locale]/legal/terms` and `/[locale]/legal/privacy`, without a session or database
read for document content. Permanent historical routes append an exact revision,
initially `/2026-11-03` for both documents. Unknown document/revision identifiers
call `notFound()` and never substitute current text. With streamed layouts Next
may send a 200 shell followed by its noindex/not-found UI. Document-specific
localized metadata, a linked contents list, permanent links and revision lists
accompany the text. The footer exposes both documents on ordinary pages. The
header does not duplicate the legal links. Explorer views hide the ordinary footer
and expose a fixed 44px bottom-left `DotsThreeCircle` button, including streamed
loading/error and private-list sign-in states. It opens the shared shadcn Base UI
Drawer from the bottom on desktop and mobile. Its localized title/tooltip is
“Information and preferences” / “Información y preferencias”. The modal traps
focus and supports Escape, backdrop, swipe, and an explicit close control, with
focus returning to the trigger. It respects safe areas and reserves bottom space
in results, map drawing instructions/polar warnings, and toast notifications;
the mobile list/map switch remains centered. Next.js development indicators are
disabled so the bottom-left badge cannot intercept the footer trigger in local
previews; compile/runtime error reporting remains enabled.

`FooterControls` shares legal links, GitHub, theme, and language controls between
the ordinary footer and drawer. Theme changes keep the drawer open. Language
changes dismiss it and preserve the existing explorer query, including saved
spatial criteria. Legal links navigate in the same tab; drawer GitHub opens a
new tab with `noopener noreferrer`. Link navigation closes the drawer, and route
or locale changes reset its state so browser Back returns to a closed drawer.
The shared footer navigation context only supplies dismissal to language selection;
it does not change routing or preference storage. Drawer route identity reads
stay inside Suspense, while CSS selects the stable explorer entry shell alongside
the ordinary footer without changing server markup by pathname. Map drawing's
Escape handler ignores the footer modal so dismissal does not cancel a drawing.

All legal copy lives in `messages/en.json` and `messages/es.json`, under
`Legal.documents.{terms|privacy}.r20261103`. Published message trees and revision
registry entries are append-only: never edit or delete an already published
revision, including for spelling or translation fixes. Historical documents have
no account foreign key and survive account erasure. HTTP tests pin the initial
published heading/paragraph text with fixed digests; add new pins for new
revisions while retaining existing ones.

`legal/documents.ts` is the browser-safe shared API for signup and renewal:

- `LegalDocument` is `"terms" | "privacy"`.
- `legalDocuments[document]` exposes `currentVersion`, `requiredVersion` and a
  readonly `revisions` array. A revision contains `version`, `requiredVersion`,
  `effectiveDate` (ISO date) and `messageKey` (the immutable bilingual text tree).
- `getLegalRevision(document: string, version?: string)` resolves the exact
  revision, or current when omitted; unknown values return `undefined`.
- `hasRequiredLegalRevision(document, recordedVersion)` returns false for
  absent/unknown revisions. Otherwise it compares that revision's material
  generation (`requiredVersion`) with the document's currently required
  generation. Versions are opaque identifiers, never ordered lexically.

The initial exact and required versions are `2026-11-03`. Privacy revision
`2026-11-03.1` corrects the session lifetime of `NEXT_LOCALE` and discloses the
one-day `track_atlas_upload_intent` cookie; its immutable EN/ES text trees use
`r20261103cookies`. It retains required generation `2026-11-03`, so existing
acknowledgments remain valid and the original text stays available. For a typo-only
correction, append a new exact revision and EN/ES text trees, advance
`currentVersion`, and retain the existing `requiredVersion` on both the new
revision and document. For a material change, append a new revision whose
`requiredVersion` is its own new identifier, and advance both document pointers.
Do this independently for terms acceptance and privacy acknowledgment. Never
change the generation attached to a historical revision. For example, a
`2026-11-04` correction in generation `2026-11-03` leaves a recorded
`2026-11-03` valid; a later material generation invalidates both old revisions.

Consumers must record the **exact revision shown**, plus language and timestamp,
not just the material generation. Acceptance submissions validate the presented versions against the server's
current registry to handle changes between presentation and submission. Signup
and existing-session gates use this contract, as described below.
No consent to optional processing is inferred from privacy acknowledgment.

The original documents cover the operator/contact details, adults, current
features/visibility, unchanged original metadata, licenses, safety, moderation,
manual email rights requests, deactivation versus erasure, retention criteria and
provider/international processing. Production provider locations are the
operator's approved configuration, not a claim of EU-only processing or zero
provider retention. The privacy text describes current OpenFreeMap,
OpenTopoMap, optional Mapbox Satellite, and user-triggered GPX Studio requests.
Account-erasure operations are delivered separately; the document describes the
staff-request process without promising automatic immediate removal.

Source review (2026-11-03): Wikiloc's [terms](https://es.wikiloc.com/wikiloc/terms_es.html?v=6.1)
and [privacy](https://es.wikiloc.com/wikiloc/privacy_es.html?v=4.3) informed structure
only; no subscription, tracking or sales provisions were imported. Rights and
statutory response information were checked against the
[AEPD](https://www.aepd.es/derechos-y-deberes/ejerce-tus-derechos).
Provider context: [DigitalOcean](https://www.digitalocean.com/legal/privacy-policy),
[Cloudflare](https://www.cloudflare.com/privacypolicy/),
[Backblaze](https://www.backblaze.com/company/privacy),
[Brevo](https://www.brevo.com/legal/privacypolicy/),
[OpenFreeMap](https://openfreemap.org/privacy/), and
[Mapbox](https://www.mapbox.com/legal/privacy). Brevo's policy endpoint exposed
only an iframe to the fetch tool, so no specific transfer mechanism or retention
period was inferred for it. Map destinations and GPX Studio disclosure were
verified against the implemented request paths. The GDPR source endpoint
required a browser challenge; statutory rights timing was verified using AEPD.

### Adult signup and account legal evidence

Signup requires a calendar age of at least 18, evaluated on the server against
UTC's current calendar date. The exact 18th birthday is eligible; February 29
birthdays reach the anniversary on March 1 in a non-leap year. Both EN/ES forms
explain the age rule and display separate required, initially unchecked terms
acceptance and privacy acknowledgment controls. Each links to the immutable
exact revision displayed, opening separately so the signup draft stays available.
Hidden `termsVersion` and `privacyVersion` fields identify those exact revisions.

`validateSignup` allowlists profile, password, checkbox and revision inputs.
Each checkbox must occur exactly once with value `on`; each revision must occur
exactly once as a string matching that document's current exact revision.
Missing, duplicate, file-valued, malformed and stale submissions fail before
CAPTCHA verification and hashing. A stale form instructs the user to reload,
read and accept the newly displayed documents; it never silently upgrades an
agreement to new text. Safe bounded profile values and localized field errors
survive rejection, while passwords are cleared and never echoed. The action
validates its bound EN/ES locale; an extra submitted locale or account ID cannot
select the evidence owner/language. Privilege fields remain excluded.
`validateAccountInput` retains shared profile validation for administrative
edits without manufacturing legal acceptance for an existing account.

After atomic database-backed CAPTCHA consumption, registration keeps its
existing email-request allowance and hashing behavior. In one transaction it
creates the account, legal evidence, account-confirmation token and initial
session; any insertion failure rolls them all back. A failed registration does
not restore a consumed proof or the existing email allowance. Confirmation
email remains post-commit and capture-only in automated browser tests.

Migration `0021_signup-legal-acceptance.sql` and its generated Drizzle metadata
add `legal_acceptances`: UUID event ID, cascading account foreign key `user_id`,
`terms_version`, `privacy_version`, EN/ES `locale`, and timezone-aware
`accepted_at`, `created_at`, `updated_at` generated by database defaults.
The pair represents explicit terms acceptance and a distinct privacy
acknowledgment, never optional-processing consent. It records the exact text
revisions, not their material generations. No existing-account evidence is
inferred or backfilled. The table has a fresh `auditColumns()` and the required
`public.set_updated_at()` trigger. A second trigger rejects all updates to
preserve immutable historical evidence; account deletion cascades the evidence,
while published documents remain independent.

`legal/acceptance-input.ts` supplies `LegalAcceptanceInput` and
`isCurrentLegalAcceptance`. Server-only `legal/acceptance-store.ts` exposes
`appendLegalAcceptance(executor, userId, input)` and
`listLegalAcceptances(executor, userId)` (oldest first). Append revalidates current
exact revisions and EN/ES locale, allowlists inserted fields and lets PostgreSQL
supply timestamps. Callers must authorize `userId` from the new account or an
existing session and pass their mutation transaction. These are internal
persistence interfaces, with no public account-ID endpoint or shared auth cache.
Renewal appends a new event; consumers can use `hasRequiredLegalRevision` from
the document registry to compare historical evidence by material generation.
Existing-account/session enforcement and staff-operated erasure are described
below.

Signup unit/action tests cover legal input rejection, calendar/leap boundaries,
locale propagation, safe values and rejection before CAPTCHA. Migrated database
tests cover immutable evidence/history, DB timestamps, cascading cleanup,
concurrent duplicate registration, transactional insertion failures and real
CAPTCHA rejection/replay. Browser coverage uses the real widget in EN/ES,
including unchecked controls, exact legal links, tampering/stale revisions,
underage rejection, correction, captured confirmation email and shared
light/dark/mobile/hydration checks. Existing browser signup fixtures explicitly
check both controls and submit the revisions rendered by the application.

### Current legal acceptance for existing sessions

Authenticated feature access requires an immutable acceptance event covering both
current required material generations. `legal/authorization.ts` builds the same
SQL predicate for ORM and raw SQL authorization statements from the published
registry. Exact revisions in the current generation remain valid after a typo
correction. Missing, unknown or earlier material revisions never authorize an
account; publishing a material terms or privacy revision gates already active
sessions without revoking them or rewriting historical evidence.

`findSessionIdentity` establishes only a live session and active account. It is
reserved for account chrome/logout, confirmation and recovery usability, and the
renewal flow. `findSessionUser` additionally enforces legal eligibility and is
the feature-service authorization interface. Settings, uploads/files, tracks,
private lists, votes, discussion/preferences, administration and GPX Studio
capabilities enforce acceptance at their service/read boundaries. Optional-auth
track/explorer/discussion reads reject a pending session instead of silently
using guest access. Private reads include acceptance in the same statement as
their access predicate. Mutations recheck after account/session lock waits and,
where later content locks can wait, before committing. Neither session status nor
legal eligibility enters a shared cache. Deactivation/session revocation remains
independent; a legal acceptance never reactivates an account or confirms email.

The request proxy sends pending GET/HEAD page visits to localized
`/accept-legal`, while service checks independently protect APIs and Server
Actions (including forms delivered before eligibility changed). Login explicitly
redirects a pending session after setting its cookie, since the action's render
need not revisit the proxy. Legal current/historical pages, privacy contact
information, logout and purpose-bound confirmation/reset pages remain available.
Request-specific checks happen outside Cache Components shared caches; renewal
renders inside Suspense. Header chrome retains the valid pending identity so
logout remains usable. Account controls stay disabled until hydration is ready.

The renewal action authorizes only the current cookie session. It requires two
separate initially unchecked controls and the exact revisions presented, validates
single string fields and EN/ES language, then locks account followed by session
and rechecks active status, database-clock expiry and current exact revisions.
`renewLegalAcceptance` appends through `appendLegalAcceptance` in that transaction;
serialized duplicate submissions are idempotent once the generation is covered.
Prior events remain immutable. A stale form must reload and review current text;
revoked, expired or deactivated sessions cannot record evidence. No new schema
or inferred acceptance is required. Account-token security, real ALTCHA login,
email restrictions and server-controlled identity remain unchanged.

`safeLegalDestination` permits only normalized EN/ES local application paths,
rejecting external/protocol-relative URLs, backslashes/control characters,
encoded paths, account-link routes and renewal loops. The proxy and login save
the intended path/query; language switching retains it. Success invalidates the
router's layout cache and resumes the validated destination. Tests cover service
and HTTP/action rejection, active and stale generations, corrections, immutable
renewal history, actual account-lock races and real-widget EN/ES browser flows
with themes, language changes, logout and hydration assertions.

### Staff-operated permanent account erasure

`auth/account-erasure.ts` exposes the internal server-only
`eraseAccount({db,userId,confirmation,dryRun,stores})` boundary; its only operator
adapter is `pnpm users:erase` (`scripts/erase-account.ts`). There is no public
endpoint, action or legal-gate UI in this operation. The [staff runbook](../account-erasure.md) requires verification through the
registered email, scope review and explicit UUID confirmation. Dry run reads owned/authored counts, sessions/tokens,
acceptance evidence and storage-location digests without mutation or storage
access. It is a snapshot; execution rechecks the last active administrator in
its transaction. CLI output omits identity fields, passwords, tokens, object
keys and provider errors.

Migration `0022_permanent-account-erasure.sql` adds nullable database-time
`users.erasure_started_at` and an inactive-account constraint. No new table is
needed: existing users retain their fresh audit defaults and update trigger.
An irreversible-state trigger rejects changes to an account once erasure has
started (apart from its audit update). Session insertion/update and account-token
insertion also lock/check the account and reject pending erasure.
Migration `0023_preserve-token-constraint-errors.sql` preserves native NOT NULL
and foreign-key errors for malformed/missing accounts while keeping this guard. Administrative
profile or reactivation attempts return forbidden. Existing active-account checks
therefore remain authoritative for login, recovery, settings, sessions, content,
notifications, media and public owned-track access, independently of the legal
acceptance gate. An account undergoing erasure cannot become active, renew a
session or reset its password to regain access. The legal gate must compose with
this inactive barrier, never substitute for it.

Erasure is phased:

1. Acquire administrative advisory lock `241022`, then lock the target account;
   reject the last active admin before making changes. In one committed
   transaction set inactive, record the erasure start, clear the avatar pointer,
   delete sessions/account tokens, and withdraw pending files while retaining
   at least 24 hours of deletion bookkeeping. Existing longer deadlines survive.
   Self-deactivation also acquires this advisory lock before its account lock
   and refuses the last active administrator. Other account mutations serialize
   on the account lock. Later failures cannot
   reactivate the account or restore its sessions.
2. Lock the account and all affected tracks in UUID order. Use
   `deleteLockedTrack` for owned tracks, retaining ADR-0001 request tombstones and
   withdrawing photo associations through the existing lifecycle. Its optional
   `notBefore` SQL deadline lets account erasure retain originals for the safety
   window too; ordinary owner/admin deletion keeps its previous policy. Delete
   authored replies, authored comments (including others' attached owner replies),
   owned lists and votes. The existing database vote-deletion trigger updates
   surviving popularity while track locks serialize concurrent voting. Owned
   tracks cascade their other users' votes, discussion and list memberships.
   Mark every remaining owned file deleting, including old avatars, pending and
   unattached uploads. Rollback leaves this phase resumable with access already
   blocked. Repeated execution does not refresh its established tombstones.
3. Invoke the existing `cleanupFiles` orchestration with an account filter for
   each supplied object store, matching exact persisted `storageLocation`.
   Original keys plus all deterministic avatar/photo derivative keys are removed
   even for unfinished or uncertain writes without derivative metadata. The
   local adapter removes temporary files too; the B2 adapter removes all versions
   and delete markers. Failed removals retain rows. Missing location configuration
   retains rows and reports `unconfiguredLocations`; staff rerun with the original
   location configuration. A successful physical removal before its deadline
   still retains the row and reports pending, so the post-window attempt removes
   objects again before dropping bookkeeping.
4. Lock the account again and remove it only when no owned file rows remain.
   Cascades remove remaining person-linked legal evidence, account-specific
   discussion events and upload attempt/deleted-request identities. No anonymized
   account or permanent erasure receipt is kept; historical legal documents have
   no account dependency. The unique email reservation ends only at this step.

`storage/file-lifecycle.ts` supplies `writeReservedFile` and
`withFileStorageLock`. Each physical upload (including GPX creation) validates a
live pending reservation, active account and current legal evidence under a
per-file transaction advisory lock, also used by physical removal and row
retirement. No account lock is held
while waiting for this storage lock. A delayed read/process cannot begin writing
after withdrawal or retirement; cleanup waits for writes already in progress.
Physical I/O remains outside account/publication transactions. Objects are
server-keyed and never reused; all writers and cleaners must use this lifecycle,
and providers must settle writes within the retained safety window. The existing
24-hour tombstones still cover failed/uncertain transport and interrupted workers;
the lock does not justify shortening them. Upload finalization separately
reauthorizes against the account/session and still protects a committed ready
file when the database commit acknowledgment is lost.

The service reports `dry-run`, `pending`, `failed` or `complete`; pending/failure
cannot be treated as physical erasure. Infrastructure exceptions use the CLI's
fixed safe failure message, since withdrawal may already have committed. Resuming
a completed UUID reports absent rather than manufacturing a historical receipt.
Shared CAPTCHA replay protection and HMAC address/shared daily email budgets have
no user foreign key and remain untouched for their current windows. Time-based
ineffectiveness and coordinated physical pruning are distinct; the
[maintenance procedure](../account-erasure.md#expired-protection-record-maintenance)
documents expired-record cleanup. Request correspondence, delivered
mail, downloaded copies and provider operational retention remain separate staff
responsibilities.

`tests/db/account-erasure.test.ts` exercises the command and service seams with
migrated loopback PostgreSQL, real local and fake/failing stores: dry-run and
confirmation, irreversible guards, last-admin/admin races, cascades/popularity,
evidence/sessions/tokens, email reservation/reuse and shared limits, phase rollback,
retry identities, delayed reads, in-flight writes, deterministic derivatives,
multiple locations and truthful completion. A real erasure-versus-renewal
account-lock wait verifies that neither ungated identity lookup nor gated feature
lookup can restore access or append new acceptance after withdrawal. Existing
ready-file commit-loss
checks fault the PostgreSQL acknowledgment at publication rather than assuming
a fixed count of preceding transactions. `tests/e2e/account-erasure.spec.ts`
covers staff-command revocation and pending authentication rejection in EN/ES,
light/dark, real login CAPTCHA and hydration diagnostics with capture-only email.

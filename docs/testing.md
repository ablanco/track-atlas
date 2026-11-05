# Testing and verification

[Documentation index](README.md) · [Operations](operations.md#commands)

## Required checks

For application changes, run `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`,
and the suites relevant to the change. Report failing or skipped checks. For
shared UI, verify English/Spanish, light/dark themes, and hydration. Authentication,
CAPTCHA, and account-email changes need unit, database, and browser coverage,
including rejection/replay paths and the real widget.

Use a migrated **development database**, never production. Automated email tests
must use capture or mocked delivery. Use a separate database for concurrently
running suites that exercise shared email limits, or run them sequentially.

## Suite coverage

| Command                | Coverage / prerequisite                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm test:db:unit`    | Database configuration and lazy connection initialization; no live database.                    |
| `pnpm test:auth`       | Validation, password/session/CAPTCHA policy, account actions, and mocked/captured email.        |
| `pnpm test:storage`    | File validation, local permissions, and B2 wire behavior on loopback.                           |
| `pnpm test:tracks`     | GPX parsing, derivation, map styles, bounded workers, and large tracks.                         |
| `pnpm test:db`         | Migrated database: account/session flows, legal gates, replay, tokens, and email limits.        |
| `pnpm test:storage:db` | Migrated database: file, avatar, and photo lifecycle, quotas, and failures.                     |
| `pnpm test:tracks:db`  | Migrated database: tracks, explorer, lists, votes, GPX Studio, comments, and notifications.     |
| `pnpm test:erasure:db` | Migrated database: permanent erasure, concurrency, storage failures, and retries.               |
| `pnpm test`            | HTTP rendering, localization, metadata, and legal/account-link routes; running server required. |
| `pnpm test:e2e`        | Chromium UI, accessibility, themes/locales, real CAPTCHA, and capture-only account flows.       |

The generic `pnpm test:db` script does not include all database suites. Select the
feature suites too; administration has focused commands below. Apply all pending
migrations with `pnpm db:migrate`. Limiter clock tests need `CREATE SCHEMA`
privileges for isolated test schemas; runtime code exposes no clock or CAPTCHA
verification bypass. Tests use rollback or uniquely named fixtures with scoped
cleanup. Signup cases serialize within their file to respect the hashing guard.

## HTTP tests and browser harness

`pnpm test` uses `http://localhost:3000` unless `TEST_BASE_URL` is set. Start the
application separately before running these HTTP checks.

Install Chromium once:

```bash
pnpm exec playwright install chromium
```

By default, Playwright runs two workers and starts its own application at
`http://127.0.0.1:3100`, with isolated build output, capture-only email, and an
ephemeral local upload directory. It does not reuse your development server,
send real email, or access B2. Set `E2E_PORT` to isolate another run, for example
`E2E_PORT=3138 pnpm exec playwright test --workers=1`. Use separate migrated
loopback databases for concurrent runs and suites sharing email limits.

`tests/helpers/email-test-server.ts` starts a private ephemeral loopback sink
with a bearer secret and metadata under `/tmp/opencode`. Harness-only
`EMAIL_TEST_SINK_URL` and `EMAIL_TEST_SINK_TOKEN` are rejected in production.
Browser tests validate capture compatibility before creating fixtures. To target
an existing browser-test server with `TEST_BASE_URL`, configure a compatible
private capture harness and `EMAIL_TEST_METADATA` first. File endpoint tests skip
external servers because they require harness-owned isolated storage.

Development mode hides the Next.js indicator so it cannot cover mobile controls.
`pnpm db:down` preserves data; `docker compose down -v` deletes the volume.

## Explorer and private lists

```bash
pnpm exec playwright test tests/e2e/explore-ui.spec.ts tests/e2e/explore-access.spec.ts --workers=1
pnpm exec playwright test tests/e2e/lists-ui.spec.ts tests/e2e/track-lists-access.spec.ts --workers=1
```

These use the migrated development database and managed capture harness. The list
UI suite isolates response/error states; the acceptance suite exercises real
persistence and authorization. Focused list backend coverage:

```bash
pnpm exec tsx --conditions=react-server --test tests/db/lists.test.ts
```

The isolated map-component suite uses real WebGL/workers and deterministic HTTP
responses; it needs no database or email configuration:

```bash
pnpm exec playwright test --config=playwright.explore-map.config.ts
```

## Administration, discussion, and votes

Focused admin backend checks: `pnpm exec tsx --conditions=react-server --test tests/db/admin-mutations.test.ts tests/db/admin-comments.test.ts`. These require a migrated development database; use a separate database when running alongside other database suites. Email delivery is mocked.

Track discussion backend (including its DB/HTTP tests), GPX Studio handoff, track voting and explorer ranking checks run with `pnpm test:tracks:db`, including
paginated comments and owner replies, posting limits/cascades, session-bound GPX links, concurrent votes and authorization changes during lock waits. Apply migrations
with `pnpm db:migrate` first. Discussion notification/preferences backend checks
(mock transport only) run with
`pnpm exec tsx --conditions=react-server --test tests/db/discussion-notifications.test.ts`.
`DISCUSSION_EMAIL_DAILY_LIMIT` defaults to 250 attempts per UTC day, separately
from account email; set it to 0 to pause discussion sending. Focused localized browser coverage:
`pnpm exec playwright test tests/e2e/tracks.spec.ts --grep "details votes refresh"`.

Localized discussion and notification-preference browser checks (migrated
loopback development database, isolated capture-email/local-storage harness):
`pnpm exec playwright test tests/e2e/comments.spec.ts --workers=1`.

## Legal pages, signup, and session renewal

Public legal-page HTTP and frozen historical-text checks (running server):
`TEST_BASE_URL=http://localhost:3000 node --test tests/legal-pages.test.mjs`.
Localized legal navigation, revision/language switching, keyboard, mobile,
theme persistence and hydration checks (capture-only browser harness, no account
or database mutations):
`pnpm exec playwright test tests/e2e/legal-pages.spec.ts --workers=1`.
The [legal revision contract](architecture/legal-and-erasure.md#public-legal-documents-and-revision-contract)
describes how to publish corrections and material changes without rewriting
historical documents.

Adult signup and legal acceptance checks run in `pnpm test:auth`, `pnpm test:db`
and `pnpm exec playwright test tests/e2e/signup.spec.ts tests/e2e/captcha.spec.ts`.

Existing-session legal renewal uses `/{locale}/accept-legal`. Focused database
checks: `pnpm exec tsx --conditions=react-server --test tests/db/legal-gate.test.ts`.
Localized real-ALTCHA renewal, stale-action rejection, themes, language switching
and pending-session logout: `E2E_PORT=3139 pnpm exec playwright test tests/e2e/legal-gate.spec.ts --workers=1`.
Use a separate migrated loopback database and capture-only browser harness.

## Permanent account erasure

Run `pnpm test:erasure:db` and
`E2E_PORT=3140 pnpm exec playwright test tests/e2e/account-erasure.spec.ts --workers=1`.
The database suite uses fake/failing and private local object stores; browser
coverage uses the capture-only harness. Tests advance only their own tombstones;
operators must follow real deadlines in the [runbook](account-erasure.md).

## Shared footer

`pnpm exec playwright test tests/e2e/explorer-footer.spec.ts tests/e2e/legal-pages.spec.ts tests/e2e/homepage.spec.ts`.
Use a migrated local development database; the browser harness captures email.

## Recorded segment boundaries

`pnpm test:tracks` covers parser/worker limits and timing, chart separators through
envelope sampling/section pagination, and map world-copy/endpoint data. Run
`pnpm test:tracks:db` on a migrated loopback development database (through `0024`)
for publication, HTTP data/original reads, constraints, 100-segment spatial queries
and plans, the shared 2,048-vertex display budget and unavailable fallback.

`E2E_PORT=3175 pnpm exec playwright test tests/e2e/tracks.spec.ts tests/e2e/explore-access.spec.ts tests/e2e/explore-ui.spec.ts tests/e2e/explorer-footer.spec.ts --workers=1`
uses capture-only email and ephemeral local storage. Track acceptance uploads real
GPX bytes and checks disjoint/shared-endpoint breaks, local timestamp resets,
numbered keyboard endpoints, chart paths/markers, localized segment errors,
unchanged downloads and the full 100,000-point details map. English/Spanish and
light/dark checks include hydration diagnostics. The isolated browser-map suite
uses MultiLineString HTTP fixtures with the real renderer and workers; singleton
observer assertions still count original points, not geometry parts.

Admin read coverage:
`pnpm exec tsx --conditions=react-server --test tests/admin/*.test.ts tests/db/admin.test.ts`.
Run email-limit/mutation suites sequentially when sharing a development database.

## Multi-track parser and preview contract

`pnpm test:tracks` includes `tests/tracks/gpx-document.test.ts` at the confirmed
parser/worker seam: ordered independent outputs, exact singleton bytes,
standalone GPX 1.0/1.1 with inherited namespaces and track-local extensions,
indexed later-track failures, shared upload limits, structural preview and
Unicode title boundaries. `gpx-performance.test.ts` also processes 100 independent
tracks with 100,000 points through one native worker and reparses every isolated
output to compare its full derived data. Diagnostics report host-specific
elapsed time and sampled process RSS; RSS is not a per-worker V8 heap bound.
The existing singleton/segment, worker interruption and admission tests remain.
No database, browser UI, account or email behavior changes in parser delivery
#47; integrated acceptance remains #50 after backend #48 and UI #49.

## Multi-track backend publication

`pnpm test:tracks:db` includes service/HTTP checks for ordered independent
outputs, copied metadata and first-only photos, isolated downloads and access,
all-or-none storage/DB failures, lost commit acknowledgements, same-attempt
retries/conflicts, two concurrent pending attempts (including generic file
admission), final-slot quota races, actual output bytes, deletion tombstones,
independent spatial/admin reads, full 100-output publication and account erasure.
Use a migrated loopback development database through `0027`. Fault injection is
at object-store/PostgreSQL boundaries; tests do not send email. Existing singleton
and segmented publication coverage remains. `pnpm test:storage:db` and
`pnpm test:erasure:db` cover the shared quota, cleanup and erasure lifecycles;
admin checks use the focused commands above. #49–#50 own preview/localization and
integrated browser acceptance. Migration verification also created a real
singleton using the predecessor service before applying `0025`, then checked
its backfilled output identity, ordinal, unchanged file association and deferred
publication invariants.

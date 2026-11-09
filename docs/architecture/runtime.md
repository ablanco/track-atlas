# Runtime configuration and infrastructure

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Runtime configuration and operations

### Private configuration

| Setting                                                                    | Runtime use                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                             | Server and migration connection string; required when accessing the database.                                                                                                                            |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`       | Local Compose initialization and host port; not a substitute for `DATABASE_URL`.                                                                                                                         |
| `ALTCHA_HMAC_SECRET`                                                       | Signup/login challenge signing; at least 32 characters after trimming, shared across instances.                                                                                                          |
| `EMAIL_RATE_LIMIT_SECRET`                                                  | HMAC key for address limiter identities; at least 32 bytes, shared across instances.                                                                                                                     |
| `FILE_STORAGE_BACKEND`, `FILE_STORAGE_LOCAL_DIR`                           | Local or B2 backend; private local directory defaults to `.data/uploads/` in development. Production requires explicit backend selection.                                                                |
| `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY` | Required for B2; validated regional HTTPS endpoint, private dedicated bucket and server-only credentials.                                                                                                |
| `APP_ORIGIN`                                                               | Trusted upload/deletion and account-link origin, never derived from the request Host; HTTPS required in production. Nonproduction defaults to `http://localhost:3000` and permits HTTP only on loopback. |
| `EMAIL_DELIVERY_MODE`                                                      | Defaults to `capture` outside production and `brevo` in production; production rejects capture.                                                                                                          |
| `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`                   | Required in Brevo mode; sender name is bounded to 70 Unicode characters with no CR/LF.                                                                                                                   |
| `DISCUSSION_EMAIL_DAILY_LIMIT`                                             | Separate discussion-email attempt budget per UTC day; defaults to 250, zero disables sending, failures count.                                                                                            |
| `SEO_INDEXING_ENABLED`                                                     | Exact `true` opts into search discovery; defaults off. Configure together with trusted `APP_ORIGIN` at build and runtime.                                                                                |
| `EMAIL_CAPTURE_DIR`                                                        | Development capture directory; defaults to ignored `.superpowers/mail/`.                                                                                                                                 |

Compose reads `.env`; Next.js and Drizzle use Next's environment loader, with
development-mode precedence for local tooling. `.env.local` and
`.env.development.local` can override `.env`. Keep database credentials and ports
aligned across files. No secret belongs in a `NEXT_PUBLIC_` variable.
Optional `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is browser-visible build-time
configuration, not a server secret. It enables Satellite; see
[map deployment](../operations.md#track-maps) for origin restrictions and CSP.

Rotating the CAPTCHA secret invalidates outstanding challenges; rotating the
email limiter secret resets address bucket identities, not the shared daily quota.

### Infrastructure and delivery

Local Compose runs only PostgreSQL 18 / PostGIS 3.6, with a health check,
localhost-only port, and persistent named volume. Next.js runs on the host.
Host clients connect to `localhost:<POSTGRES_PORT>`; Compose-network clients use
`db:5432`. Initialization credentials apply only to an empty volume. Stopping
Compose preserves data unless the volume is explicitly removed. The upstream
image documents amd64 support only; ARM requires another compatible image or
emulation. Major PostgreSQL upgrades require data migration, not just an image
change. The initial PostGIS migration requires a suitably privileged role.

GitHub Actions builds AlmaLinux 10 x86-64 release packages with Node.js 24.
Packages retain the normal Next.js build, installed dependencies (including
maintenance CLIs), and committed source; private configuration and file storage
remain on the VPS. Builds use the release tag, production origin, and explicit
indexing/Mapbox variables without production database access or credentials.
The workflow attaches archives and checksums to an existing release and supports
manual builds of older tags.

After publishing assets, stable release events invoke the reusable VPS deployment
workflow. Manual builds and prereleases do not deploy. A separate manual dispatch
from the default branch deploys existing stable release assets without rebuilding.
Automatic deployments require the tag to still be GitHub's latest release when
the deployment job starts. GitHub concurrency and a VPS filesystem lock serialize
deployments; in-progress jobs are not automatically cancelled.

Only the deployment job receives the dedicated SSH key. It pins the server host
key, uploads the exact archive/checksum assets, and invokes the independently
installed `scripts/deploy-release.sh` as `track-atlas-deploy`. The deployment user
can read production configuration and write releases/current; its only root sudo
permission restarts `track-atlas.service`. The application runs as `track-atlas`
with Node.js 24. Migrations execute before activation and must be compatible with
the running application. A failed restart or local/public health check restores
the previous application pointer and restarts it; database changes remain applied.
Existing release directories are never overwritten. Backups, migration review,
maintenance-window releases, and old-release cleanup remain operator duties.
See [VPS deployment](../deployment.md).

Production deployment, backups, HTTPS, database network/TLS hardening,
least-privilege application roles, and scheduled maintenance are operator
responsibilities; this repository does not provision them.

Brevo requires a verified sender/domain and appropriate SPF/DKIM/DMARC records.
Disable transactional open and click tracking so secret-bearing URLs remain
direct. Other users of the same provider account can exhaust its quota even
when this app stays within its account-email budget (250 attempts per UTC day)
and separate configurable discussion-email budget. There is no delivery
queue, automatic retry, or webhook service. Automated tests never send real
messages; manual live-send checks require explicit authorization, a development
database, and an address controlled by the tester.

### Sensitive data and maintenance

Redact query strings from access logs for every locale's `/confirm-email` and
`/reset-password` routes. Framework development logs and browser traces can also
contain live token URLs; keep them private. Do not add third-party analytics or
assets to account-token pages.

Local file capture creates a private directory and files (modes `0700`/`0600`)
and prunes older matching JSON files before each write to retain roughly 100
messages. Existing directory permissions are not repaired. Capture files contain
live account links and must not be shared or served publicly.

`pnpm db:prune` removes one batch of up to 1,000 rows per table: expired
sessions, expired/consumed/revoked account links, expired CAPTCHA replay records,
and obsolete account/discussion email-limit buckets. Each table has its own
transaction, with a two-second lock timeout and ten-second statement timeout.
Session, token, and CAPTCHA batches skip rows locked by live requests. Email
pruning briefly takes a `SHARE ROW EXCLUSIVE` table lock, coordinating with
writers' insert/read/update transactions; active address windows and current UTC
daily budgets remain intact. Daily writers acquire their table lock before
choosing the UTC date, including when a wait crosses midnight. CAPTCHA consumption
rechecks database-clock expiry after insert/conflict waits, so deleting an expired
replay record cannot permit a delayed proof to authorize another request.
See [ADR 0011](../adr/0011-online-database-pruning.md) for concurrency rationale.

Schedule the command externally; no scheduler is installed. The command loads
Next.js environment files for `NODE_ENV`, uses `getDb()`, prints only deletion
counts, closes its pool, and exits nonzero on failure. Earlier table batches may
already have committed; retrying is safe. It does not touch upload retry identities,
file tombstones, legal evidence, or finalize account erasure. The
[maintenance procedure](../operations.md#database-pruning) covers deployment and
backlogs. Logical expiry remains enforced even if pruning is delayed.

Keep secret-bearing route logs, captures, backups, and external-provider retention
within the operator's private data-handling procedures. Physical account erasure
and its storage tombstones have a separate [staff runbook](../account-erasure.md).

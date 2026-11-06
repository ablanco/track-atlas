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

Expired sessions and CAPTCHA proofs are rejected without automatic row pruning.
Account tokens and email limiter rows also need periodic cleanup. The canonical
[protection-record maintenance procedure](../account-erasure.md#expired-protection-record-maintenance)
requires a coordinated window with protection writers stopped, preserving current
address and daily budgets. It also covers discussion-email buckets. No scheduler
for these statements is included.

In that same coordinated maintenance window, expired sessions and unusable account
links can be removed separately:

```sql
DELETE FROM sessions WHERE expires_at < clock_timestamp();
DELETE FROM account_action_tokens
WHERE expires_at < clock_timestamp() OR consumed_at IS NOT NULL OR revoked_at IS NOT NULL;
```

Keep secret-bearing route logs, captures, backups, and external-provider retention
within the operator's private data-handling procedures. Physical account erasure
and its storage tombstones have a separate [staff runbook](../account-erasure.md).

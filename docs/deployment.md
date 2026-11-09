# VPS release packages

[Documentation index](README.md) · [Operations](operations.md)

The `Build VPS release` GitHub Actions workflow builds on AlmaLinux 10 for
Linux x86-64. It uploads a compressed application package and SHA-256 checksum
to an existing GitHub release. The VPS needs Node.js 24, npm, `libatomic`, and
`libstdc++`; it does not need to install dependencies or compile the application.
ARM hosts need a separate build. nginx and Certbot remain managed on the VPS.

Stable releases automatically deploy after asset publication once the
[automated deployment setup](#automated-deployment) is complete. Prereleases and
manual builds only produce packages.

## Build a release

Publishing a GitHub release triggers `.github/workflows/release-build.yml`.
The release tag must equal `v` followed by the version in `package.json`.
The workflow checks out that tag, installs its pinned pnpm and frozen lockfile,
runs lint and TypeScript checks, and builds with the required dependency patches.
It needs no production credentials or database connection. A build-only
placeholder `DATABASE_URL` allows routes to construct lazy connection pools
during prerendering; the VPS supplies the real connection string at runtime.

The build uses `APP_ORIGIN=https://trackatlas.net`. Set these optional repository
**Actions variables** before building:

- `SEO_INDEXING_ENABLED`: `true` to enable indexing; otherwise defaults to `false`.
- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`: the public, origin-restricted token if Satellite
  should be available.

Keep those settings consistent with the server environment. They affect the
compiled release; changing them requires another build.

To build an already published release, including `v1.0.0`, use **Actions → Build
VPS release → Run workflow**, choose the branch containing the workflow and enter
the tag. Use `master` for the current workflow. Manual builds use the selected branch's
packaging tooling and the requested tag's application source. This does not move
or replace the tag. Existing assets are never overwritten; a repeated upload with
an existing filename fails.

The download names are:

```text
track-atlas-v1.0.0-almalinux10-x64.tar.gz
track-atlas-v1.0.0-almalinux10-x64.tar.gz.sha256
```

The archive contains committed source, `public/`, the production `.next` output,
and installed `node_modules`, including CLI dependencies such as `tsx` and
Drizzle Kit. This deliberately keeps existing migration and maintenance commands
working and uses the normal Next.js server rather than standalone output. It is
larger than a web-only package. Build caches, Git metadata, local environment
files, and uploaded files are excluded. `RELEASE.json` identifies the source
commit and builder Node version. Node itself is not bundled.

## Install on the VPS manually

Download both assets from the GitHub release onto the VPS. Verify and extract
into a **new empty directory**, rather than overwriting a running application:

```bash
sha256sum -c track-atlas-v1.0.0-almalinux10-x64.tar.gz.sha256
mkdir -p /var/www/track-atlas-releases/v1.0.0
tar -xzf track-atlas-v1.0.0-almalinux10-x64.tar.gz \
  -C /var/www/track-atlas-releases/v1.0.0
```

Keep runtime configuration and uploaded files outside the release directories.
For example, retain configuration in `/etc/track-atlas.env` and link it into each
release so interactive commands also load it automatically:

```bash
ln -s /etc/track-atlas.env /var/www/track-atlas-releases/v1.0.0/.env.local
```

The service user must be able to read this file when using the symlink. For
example, use root ownership, the service user's group, and permissions `0640`.
Next.js and the existing CLI tools load `.env.local`; use only this environment
file and avoid conflicting `.env.development.local` overrides. systemd can
continue to use `EnvironmentFile=/etc/track-atlas.env` as well. Set
`APP_ORIGIN=https://trackatlas.net`, production Brevo credentials, and an absolute
persistent `FILE_STORAGE_LOCAL_DIR` (or configure B2). Back up the database and
uploads separately. Do not package production environment files in CI.

Before switching versions, back up the database, check migration compatibility
with the running version, and apply pending migrations:

```bash
cd /var/www/track-atlas-releases/v1.0.0
NODE_ENV=production npm run db:migrate
```

Stop the service during migrations that cannot run alongside the old application.
For the first deployment, initialize PostgreSQL/PostGIS as described in the
[operations reference](operations.md#3-start-and-migrate-the-database).

Use `/var/www/track-atlas` as a symlink to the active release to preserve the
existing service's `WorkingDirectory`. If it is currently a Git checkout, stop
the service and move that checkout aside first; preserve its environment file
and uploads, configuring persistent storage before switching. Do not attempt to
replace a nonempty checkout with `ln`.

Once `/var/www/track-atlas` is a symlink (or does not exist):

```bash
ln -sfnT /var/www/track-atlas-releases/v1.0.0 /var/www/track-atlas
sudo systemctl restart track-atlas
sudo systemctl status track-atlas
curl --fail https://trackatlas.net/en >/dev/null
```

The service user needs write access to the release's `.next` runtime cache and
to persistent local uploads. Keep the application bound to `127.0.0.1:3000` behind
nginx. With npm available, retain this service command:

```ini
WorkingDirectory=/var/www/track-atlas
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000
```

Neither `npm install` nor `npm run build` is required on the VPS. Maintenance
commands also work with npm from the active release directory:

```bash
NODE_ENV=production npm run files:cleanup
NODE_ENV=production npm run db:prune
```

Keep file cleanup scheduled at least every 15 minutes and database pruning
initially daily. See [maintenance operations](operations.md#database-pruning).
A symlink switch plus service restart causes brief downtime. Keep the previous
release for application rollback; changing the symlink does not undo database
migrations. Verify uploads, login, and relevant routes after deployment.

## Automated deployment

The `.github/workflows/deploy-vps.yml` workflow downloads the published archive
and checksum, verifies them, and connects to the VPS with OpenSSH. It invokes an
installed deployment script; it never installs or updates that script over SSH.
Production database, B2, and email credentials stay on the VPS. The deployment
account can read them because release migration commands need the same environment.

### Required VPS layout

Provision the following once, using an administrator account:

- `track-atlas`: application account, with no interactive shell.
- `track-atlas-deploy`: SSH account with supplementary group `track-atlas`.
- `/etc/track-atlas.env`: owned by `root:track-atlas`, mode `0640`.
- `/var/www/track-atlas-releases`: owned by `track-atlas-deploy:track-atlas`, mode
  `2750`. Existing releases must be readable/traversable by the application group.
- `/var/www/track-atlas-deployment`: same owner/group and mode, containing a
  `current` symlink pointing to the existing release.
- `/var/www/track-atlas`: a root-managed symlink pointing to
  `/var/www/track-atlas-deployment/current`.
- `/home/track-atlas-deploy/incoming`: owned by the deployment account, mode `0700`.

Keep persistent local uploads outside releases if not using B2. Preserve SELinux
and apply appropriate labels to new paths. Configure key authentication for the
deployment user, with mode `0700` on `.ssh` and `0600` on `authorized_keys`; run
`restorecon -Rv /home/track-atlas-deploy/.ssh` after creating them. Prefix the
dedicated public key in `authorized_keys` with `restrict` to disable forwarding
and terminal allocation while allowing commands and file transfer. SSH must be
reachable from GitHub's runner network; never disable host-key verification.

AlmaLinux's versioned Node.js packages can coexist with Node.js 22. Install
`nodejs24 nodejs24-npm`, verify `/usr/bin/node-24 --version`, and configure the
existing systemd service with these settings (preserve its other settings):

```ini
User=track-atlas
Group=track-atlas
WorkingDirectory=/var/www/track-atlas
Environment=NODE_ENV=production
EnvironmentFile=/etc/track-atlas.env
ExecStart=/usr/bin/node-24 /var/www/track-atlas/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
```

The running release's `.next` directory must be writable by the application.
Reload systemd, restart, and check local/public HTTP before enabling automation.
Create `/etc/sudoers.d/track-atlas-deploy` with `visudo -f` and mode `0440`:

```sudoers
track-atlas-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart track-atlas.service
```

Install the repository's deployment script as a root-owned executable:

```bash
sudo install -o root -g root -m 0755 scripts/deploy-release.sh \
  /usr/local/bin/track-atlas-deploy
sudo -u track-atlas-deploy /usr/local/bin/track-atlas-deploy --check
```

If the repository is on your computer, upload that file to the deployment user's
home first, then run `install` as an administrator on the VPS using the uploaded
path. The check validates access and prerequisites without migrating or restarting.
The separately installed script from the guided VPS setup is compatible with this
workflow; future script changes require an explicit administrator installation.

### GitHub connection settings

Configure repository Actions variables:

| Variable       | Value                                                 |
| -------------- | ----------------------------------------------------- |
| `VPS_HOST`     | VPS public hostname or IP, without a protocol or port |
| `VPS_SSH_PORT` | SSH port, normally `22`                               |
| `VPS_SSH_USER` | `track-atlas-deploy`                                  |

Configure repository Actions secrets:

| Secret                | Value                                                 |
| --------------------- | ----------------------------------------------------- |
| `VPS_SSH_KEY`         | Dedicated unencrypted deployment private key          |
| `VPS_SSH_KNOWN_HOSTS` | Verified OpenSSH known-hosts entry for that host/port |

Transfer secrets directly from files with `gh secret set NAME < FILE`. Verify
the server fingerprint through an existing trusted administrator connection.
For a nondefault port the known-hosts hostname must use `[hostname]:port`.
Only the deploy job receives the key; build and packaging jobs have no VPS access.

Before the first deployment, run **Actions → Deploy VPS release → Run workflow**
from `master`, enter an existing stable release tag (for example `v1.0.0`), and
leave `check_only` enabled. This verifies GitHub-to-VPS SSH and the installed
script's prerequisites without downloading/uploading packages, applying migrations,
or restarting the service. Manual runs default to this connection-only mode.

### Release behavior and recovery

Publishing a stable GitHub release runs build → publish → deploy. The automatic
deployment requires the release to still be marked latest when the deploy job
starts, so older builds do not normally replace a newer release. There is no
version-order guarantee if releases change during an already running deployment.
Manual builds never deploy. Automatic deployment accepts only `vMAJOR.MINOR.PATCH`
tags; tags containing prerelease/build suffixes can still be packaged manually.

To deploy already published assets, use **Actions → Deploy VPS release → Run
workflow**, select the default branch (`master`), enter the stable tag, and disable
`check_only`.
This does not rebuild or reupload GitHub release assets. It can deploy an older
stable release intentionally, but cannot overwrite any existing VPS release
directory, including a previously failed deployment. Inspect failed directories
before removing an inactive one or choose a new release tag; never delete the
active release.

Both entry points share a production concurrency group, and the VPS script holds
an exclusive lock across extraction, migration, activation, and recovery. Avoid
manually cancelling a deployment: abrupt termination can interrupt migrations or
prevent recovery. GitHub can replace pending jobs; deployment is not a FIFO queue.

Before publishing, verify a current database backup and compatibility of new
migrations with both the running application and the rollback version. The script
applies migrations with Node.js 24 before atomically switching `current` and
restarting systemd. A migration failure leaves the previous application running,
but database changes may already have committed. Releases needing incompatible
migrations require a maintenance procedure instead of this automatic path.

After activation, local HTTP is polled and public HTTPS is checked. These checks
verify homepage availability, not login, B2, or database correctness. A failed
restart or health check restores the previous application release and reports the
deployment as failed; migrations are never reversed. Inspect any rollback failure
immediately on the VPS. Confirm application features after deployment.

For a deliberate application rollback, first confirm schema compatibility, then
run as `track-atlas-deploy`, substituting the retained release tag:

```bash
cd /var/www/track-atlas-deployment
exec 9>deployment.lock
flock -n 9 || exit 1
test -d /var/www/track-atlas-releases/v1.0.0 || exit 1
ln -s /var/www/track-atlas-releases/v1.0.0 current.rollback
mv -Tf current.rollback current
sudo -n /usr/bin/systemctl restart track-atlas.service
curl --fail http://127.0.0.1:3000/en >/dev/null
flock -u 9
exec 9>&-
```

Run that block in a separate Bash session; its failure exits must not be pasted
into a shell doing other work. Keep previous releases and incoming assets until
you have verified the new version, then remove inactive files manually as needed.

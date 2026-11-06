# VPS release packages

[Documentation index](README.md) · [Operations](operations.md)

The `Build VPS release` GitHub Actions workflow builds on AlmaLinux 10 for
Linux x86-64. It uploads a compressed application package and SHA-256 checksum
to an existing GitHub release. The VPS needs Node.js 24, npm, `libatomic`, and
`libstdc++`; it does not need to install dependencies or compile the application.
ARM hosts need a separate build. nginx and Certbot remain managed on the VPS.

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
the tag. Once merged, use `master`. Manual builds use the selected branch's
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

## Install on the VPS

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

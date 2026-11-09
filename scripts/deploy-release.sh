#!/usr/bin/env bash
set -Eeuo pipefail
umask 0027

releases=/var/www/track-atlas-releases
control=/var/www/track-atlas-deployment
incoming=/home/track-atlas-deploy/incoming
node=/usr/bin/node-24
staging=
previous=
restore_needed=0

die() { echo "$*" >&2; exit 1; }
[[ $(id -un) == track-atlas-deploy ]] || die 'Run as track-atlas-deploy, without sudo.'
[[ $# == 1 ]] || die 'Usage: track-atlas-deploy --check | track-atlas-deploy vMAJOR.MINOR.PATCH'

for tool in tar sha256sum flock curl readlink mktemp timeout; do
  command -v "$tool" >/dev/null || die "Missing command: $tool"
done
[[ -x $node ]] || die 'Node.js 24 is missing.'
[[ -r /etc/track-atlas.env ]] || die 'Cannot read application environment.'
[[ -w $releases && -w $control ]] || die 'Cannot write deployment directories.'
[[ -L $control/current ]] || die 'The current release pointer must be a symlink.'
[[ $(readlink /var/www/track-atlas) == "$control/current" ]] || die 'Unexpected application symlink.'
sudo -n -l /usr/bin/systemctl restart track-atlas.service >/dev/null || die 'Missing service restart permission.'
"$node" -e 'if (process.versions.node.split(".")[0] !== "24" || process.arch !== "x64") process.exit(1)'

if [[ $1 == --check ]]; then
  echo 'Deployment prerequisites OK. No release changed or service restarted.'
  exit 0
fi

tag=$1
[[ $tag =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || die 'Only stable vMAJOR.MINOR.PATCH tags are accepted.'
target=$releases/$tag
archive=track-atlas-${tag}-almalinux10-x64.tar.gz

# Shared by all versions; do not cancel a deployment midway through a migration.
exec 9>"$control/deployment.lock"
flock -n 9 || die 'Another deployment is running.'
[[ ! -e $target && ! -L $target ]] || die 'Release directory already exists; refusing to overwrite it.'
previous=$(readlink -f "$control/current")
[[ -d $previous ]] || die 'Previous release is missing.'

switch_to() {
  local destination=$1 temporary
  temporary=$(mktemp -d "$control/.switch.XXXXXXXX")
  ln -s -- "$destination" "$temporary/current"
  mv -Tf -- "$temporary/current" "$control/current"
  rmdir -- "$temporary"
}

healthy() {
  local attempt
  for ((attempt=0; attempt<15; attempt++)); do
    if curl --fail --silent --output /dev/null --max-time 3 \
      http://127.0.0.1:3000/en; then
      return 0
    fi
    sleep 2
  done
  return 1
}

finish() {
  local result=$?
  trap - EXIT HUP INT TERM
  if (( restore_needed )); then
    echo 'Activation failed; restoring the previous application release.' >&2
    if switch_to "$previous" &&
       timeout 90s sudo -n /usr/bin/systemctl restart track-atlas.service && healthy; then
      echo 'Previous application release restored. Database migrations were NOT reversed.' >&2
    else
      echo 'ROLLBACK FAILED: inspect the service on the VPS immediately.' >&2
    fi
    result=1
  fi
  [[ -z $staging ]] || rm -rf -- "$staging"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

cd "$incoming"
[[ -f $archive && -f $archive.sha256 ]] || die 'Upload the archive and checksum to the incoming directory first.'
# Accept only the checksum of this exact filename, never arbitrary paths.
"$node" - "$archive" <<'JS'
const fs = require('node:fs');
const name = process.argv[2];
const checksum = fs.readFileSync(name + '.sha256', 'utf8').trim();
if (!/^[a-fA-F0-9]{64}  /.test(checksum) || checksum.slice(66) !== name)
  throw new Error('Unexpected checksum file format');
JS
sha256sum --check --status -- "$archive.sha256"
echo 'Checksum verified; extracting release.'
staging=$(mktemp -d "$releases/.${tag}.XXXXXXXX")
tar --extract --gzip --file "$archive" --directory "$staging" --no-same-owner

cd "$staging"
[[ -s .next/BUILD_ID && -f node_modules/next/dist/bin/next && -f node_modules/drizzle-kit/bin.cjs ]] || die 'Incomplete release package.'
"$node" - "$tag" <<'JS'
const fs = require('node:fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const release = JSON.parse(fs.readFileSync('RELEASE.json', 'utf8'));
if (`v${pkg.version}` !== process.argv[2] || release.tag !== process.argv[2] ||
    release.platform !== 'linux' || release.architecture !== 'x64')
  throw new Error('Release metadata mismatch');
require('sharp');
require('pg');
JS
[[ ! -e .env.local && ! -L .env.local ]] || die 'Package unexpectedly contains .env.local.'
ln -s /etc/track-atlas.env .env.local
chgrp -hR track-atlas "$staging"
chmod -R g+rX "$staging"
chmod -R g+rwX "$staging/.next"
# Ensure runtime-created cache directories inherit the application group.
find "$staging/.next" -type d -exec chmod g+s {} +

mv -T -- "$staging" "$target"
staging=
cd "$target"
echo 'Applying migrations. These must be compatible with the running release.'
NODE_ENV=production "$node" node_modules/drizzle-kit/bin.cjs migrate

echo "Activating $tag."
restore_needed=1
switch_to "$target"
timeout 90s sudo -n /usr/bin/systemctl restart track-atlas.service
healthy || die 'Local health check failed.'
curl --fail --silent --show-error --output /dev/null \
  --max-time 15 --retry 2 --retry-delay 2 https://trackatlas.net/en
restore_needed=0
echo "Deployed $tag successfully. Previous release: $previous"

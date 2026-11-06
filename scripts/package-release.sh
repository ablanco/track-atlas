#!/usr/bin/env bash
# Package a clean release checkout, its build, and all installed CLI dependencies.
set -euo pipefail

if [[ $# != 3 ]]; then
  echo "Usage: package-release.sh SOURCE OUTPUT TAG" >&2
  exit 1
fi

source_dir=$(realpath "$1")
mkdir -p "$2"
output_dir=$(realpath "$2")
release_tag=$3

# Also prevents a tag from becoming an unsafe archive filename.
RELEASE_TAG="$release_tag" node -e '
  const pkg = require(process.argv[1]);
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(process.env.RELEASE_TAG) ||
      process.env.RELEASE_TAG !== `v${pkg.version}`) {
    throw Error("Release tag must match package.json version");
  }
' "$source_dir/package.json"

[[ -s "$source_dir/.next/BUILD_ID" ]]
[[ -d "$source_dir/node_modules/.pnpm" ]]

snapshot=$(mktemp -d)
trap 'rm -rf "$snapshot"' EXIT
# Only committed source enters the package: never local env files or uploads.
git -C "$source_dir" archive HEAD | tar -xf - -C "$snapshot"
RELEASE_TAG="$release_tag" node -e '
  const fs = require("node:fs");
  const { execFileSync } = require("node:child_process");
  fs.writeFileSync(process.argv[2], JSON.stringify({
    tag: process.env.RELEASE_TAG,
    commit: execFileSync("git", ["-C", process.argv[1], "rev-parse", "HEAD"], {encoding: "utf8"}).trim(),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    target: "AlmaLinux 10 x86-64",
  }, null, 2) + "\n");
' "$source_dir" "$snapshot/RELEASE.json"

archive="track-atlas-${release_tag}-almalinux10-x64.tar.gz"
tar -czf "$output_dir/$archive" \
  --exclude='.next/cache' --exclude='node_modules/.cache' \
  -C "$snapshot" . -C "$source_dir" .next node_modules
(cd "$output_dir" && sha256sum "$archive" > "$archive.sha256")

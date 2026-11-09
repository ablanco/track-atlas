import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const original = readFileSync(
  resolve(import.meta.dirname, "../../scripts/deploy-release.sh"),
  "utf8",
);

// Run the actual deployment shell in a temporary filesystem. Only platform
// commands (SSH account, Node installation, sudo, HTTP) are substituted.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "atlas-deploy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const releases = join(root, "releases");
  const control = join(root, "control");
  const incoming = join(root, "incoming");
  const bin = join(root, "bin");
  const previous = join(releases, "v1.0.0");
  for (const dir of [releases, control, incoming, bin, previous])
    mkdirSync(dir, { recursive: true });
  symlinkSync(previous, join(control, "current"));
  symlinkSync(join(control, "current"), join(root, "app"));
  const envFile = join(root, "app.env");
  writeFileSync(envFile, "DATABASE_URL=not-a-real-database\n", { mode: 0o640 });
  function executable(name, body) {
    const file = join(bin, name);
    writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
    chmodSync(file, 0o755);
    return file;
  }
  executable("id", "echo track-atlas-deploy");
  executable("chgrp", ":");
  executable("sleep", ":");
  executable(
    "sudo",
    `
    [[ "$*" == *' -l '* ]] && exit 0
    echo restart >> "$TEST_ROOT/restarts"
    if [[ \${TEST_RESTART_FAIL:-0} == 1 && ! -e $TEST_ROOT/failed-restart ]]; then
      touch "$TEST_ROOT/failed-restart"
      exit 1
    fi
  `,
  );
  executable(
    "curl",
    `
    case "$*" in
      *https://*) [[ \${TEST_PUBLIC_FAIL:-0} != 1 ]] ;;
      *)
        [[ \${TEST_ROLLBACK_FAIL:-0} == 1 ]] && exit 1
        if [[ \${TEST_HEALTH_FAIL:-0} == 1 ]]; then
          [[ $(readlink "$TEST_ROOT/control/current") == "$TEST_ROOT/releases/v1.0.0" ]]
        fi ;;
    esac
  `,
  );
  executable(
    "node-24",
    `
    [[ \${1:-} == -e ]] && exit 0
    exec "$TEST_NODE" "$@"
  `,
  );
  let source = original;
  for (const [from, to] of [
    ["/var/www/track-atlas-releases", releases],
    ["/var/www/track-atlas-deployment", control],
    ["/home/track-atlas-deploy/incoming", incoming],
    ["/var/www/track-atlas", join(root, "app")],
    ["/etc/track-atlas.env", envFile],
    ["/usr/bin/node-24", join(bin, "node-24")],
  ])
    source = source.replaceAll(from, to);
  const script = join(root, "deploy.sh");
  writeFileSync(script, source);
  const packageDir = join(root, "package");
  for (const path of [
    ".next",
    "node_modules/next/dist/bin",
    "node_modules/drizzle-kit",
    "node_modules/sharp",
    "node_modules/pg",
  ])
    mkdirSync(join(packageDir, path), { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ version: "1.1.0" }),
  );
  writeFileSync(
    join(packageDir, "RELEASE.json"),
    JSON.stringify({ tag: "v1.1.0", platform: "linux", architecture: "x64" }),
  );
  writeFileSync(join(packageDir, ".next/BUILD_ID"), "new-build");
  writeFileSync(
    join(packageDir, "node_modules/next/dist/bin/next"),
    "// fixture",
  );
  for (const dependency of ["sharp", "pg"])
    writeFileSync(
      join(packageDir, `node_modules/${dependency}/index.js`),
      "module.exports = {};\n",
    );
  writeFileSync(
    join(packageDir, "node_modules/drizzle-kit/bin.cjs"),
    `
    const fs = require('node:fs');
    fs.writeFileSync(process.env.TEST_ROOT + '/migration', process.env.NODE_ENV);
    if (process.env.TEST_MIGRATION_FAIL === '1') process.exit(1);
  `,
  );
  const archive = "track-atlas-v1.1.0-almalinux10-x64.tar.gz";
  execFileSync("tar", ["-czf", join(incoming, archive), "-C", packageDir, "."]);
  writeFileSync(
    join(incoming, archive + ".sha256"),
    execFileSync("sha256sum", [archive], { cwd: incoming }),
  );
  return {
    root,
    releases,
    control,
    incoming,
    archive,
    previous,
    run(tag = "v1.1.0", extra = {}) {
      return spawnSync("bash", [script, tag], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_ROOT: root,
          TEST_NODE: process.execPath,
          ...extra,
        },
        encoding: "utf8",
        timeout: 15000,
      });
    },
    pointer() {
      return readlinkSync(join(control, "current"));
    },
    restarts() {
      const file = join(root, "restarts");
      return existsSync(file)
        ? readFileSync(file, "utf8").trim().split("\n").length
        : 0;
    },
  };
}

test("prerequisite check does not migrate, activate, or restart", (t) => {
  const f = fixture(t);
  const result = f.run("--check");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.pointer(), f.previous);
  assert.equal(f.restarts(), 0);
  assert.equal(existsSync(join(f.root, "migration")), false);
});

test("verified release migrates in production and activates with runtime group access", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const target = join(f.releases, "v1.1.0");
  assert.equal(f.pointer(), target);
  assert.equal(f.restarts(), 1);
  assert.equal(readFileSync(join(f.root, "migration"), "utf8"), "production");
  assert.equal(
    readlinkSync(join(target, ".env.local")),
    join(f.root, "app.env"),
  );
  assert.equal(statSync(join(target, ".next")).mode & 0o2070, 0o2070);
  assert.equal(statSync(join(f.root, "app.env")).mode & 0o777, 0o640);
});

for (const tag of ["../../unsafe", "v1.1.0;id", "v1.1.0-rc.1", "v01.1.0"]) {
  test(`reject unsafe or nonstable tag: ${tag}`, (t) => {
    const f = fixture(t);
    assert.notEqual(f.run(tag).status, 0);
    assert.equal(f.pointer(), f.previous);
    assert.equal(f.restarts(), 0);
  });
}

test("checksum mismatch never migrates or activates", (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.incoming, f.archive + ".sha256"),
    `${"0".repeat(64)}  ${f.archive}\n`,
  );
  assert.notEqual(f.run().status, 0);
  assert.equal(f.pointer(), f.previous);
  assert.equal(f.restarts(), 0);
  assert.equal(existsSync(join(f.root, "migration")), false);
});

test("checksum file cannot request another filesystem path", (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.incoming, f.archive + ".sha256"),
    `${"0".repeat(64)}  /etc/passwd\n`,
  );
  assert.notEqual(f.run().status, 0);
  assert.equal(existsSync(join(f.root, "migration")), false);
});

test("migration failure leaves the running release untouched", (t) => {
  const f = fixture(t);
  assert.notEqual(f.run("v1.1.0", { TEST_MIGRATION_FAIL: "1" }).status, 0);
  assert.equal(f.pointer(), f.previous);
  assert.equal(f.restarts(), 0);
});

for (const flag of [
  "TEST_RESTART_FAIL",
  "TEST_HEALTH_FAIL",
  "TEST_PUBLIC_FAIL",
]) {
  test(`${flag} restores and restarts the previous release but reports failure`, (t) => {
    const f = fixture(t);
    const result = f.run("v1.1.0", { [flag]: "1" });
    assert.notEqual(result.status, 0);
    assert.equal(f.pointer(), f.previous, result.stderr);
    assert.equal(f.restarts(), 2);
    assert.match(result.stderr, /Database migrations were NOT reversed/);
  });
}

test("existing release directories are never overwritten", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.releases, "v1.1.0"));
  assert.notEqual(f.run().status, 0);
  assert.equal(f.pointer(), f.previous);
  assert.equal(f.restarts(), 0);
});

test("a held deployment lock prevents migrations and activation", async (t) => {
  const f = fixture(t);
  const holder = spawn(
    "bash",
    [
      "-c",
      'exec 9>"$1"; flock 9; echo locked; read -r _',
      "bash",
      join(f.control, "deployment.lock"),
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  t.after(() => holder.kill());
  await once(holder.stdout, "data");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Another deployment is running/);
  assert.equal(f.restarts(), 0);
  assert.equal(existsSync(join(f.root, "migration")), false);
});

test("failed rollback reports that operator intervention is required", (t) => {
  const f = fixture(t);
  const result = f.run("v1.1.0", { TEST_ROLLBACK_FAIL: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ROLLBACK FAILED/);
  assert.equal(f.pointer(), f.previous);
  assert.equal(f.restarts(), 2);
});

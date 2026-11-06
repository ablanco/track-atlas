import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const packager = resolve(
  import.meta.dirname,
  "../../scripts/package-release.sh",
);

function fixture(t, version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "track-atlas-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  mkdirSync(source);
  writeFileSync(
    join(source, "package.json"),
    JSON.stringify({ version }) + "\n",
  );
  execFileSync("git", ["init", "-q", source]);
  execFileSync("git", ["-C", source, "add", "package.json"]);
  execFileSync("git", [
    "-C",
    source,
    "-c",
    "user.name=Packaging test",
    "-c",
    "user.email=packaging@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Fixture",
  ]);
  for (const dir of [
    ".next/cache",
    "node_modules/.pnpm/tool",
    ".data/uploads",
  ]) {
    mkdirSync(join(source, dir), { recursive: true });
  }
  writeFileSync(join(source, ".next/BUILD_ID"), "fixture-build");
  writeFileSync(join(source, ".next/cache/private-build-cache"), "cache");
  writeFileSync(
    join(source, "node_modules/.pnpm/tool/index.js"),
    "module.exports = 42;\n",
  );
  symlinkSync(".pnpm/tool", join(source, "node_modules/tool"));
  writeFileSync(join(source, ".env.local"), "SECRET=must-not-ship\n");
  writeFileSync(join(source, ".data/uploads/private-file"), "private");
  return { root, source, output: join(root, "dist") };
}

test("package excludes private runtime files and caches while retaining pnpm links", (t) => {
  const { root, source, output } = fixture(t);
  execFileSync("bash", [packager, source, output, "v1.2.3"]);
  const archive = "track-atlas-v1.2.3-almalinux10-x64.tar.gz";
  const entries = execFileSync("tar", ["-tzf", join(output, archive)], {
    encoding: "utf8",
  });
  assert.ok(entries.includes(".next/BUILD_ID"));
  assert.ok(entries.includes("node_modules/.pnpm/tool/index.js"));
  assert.ok(!entries.includes(".env"));
  assert.ok(!entries.includes(".git/"));
  assert.ok(!entries.includes(".data/"));
  assert.ok(!entries.includes(".next/cache"));
  execFileSync("sha256sum", ["-c", `${archive}.sha256`], { cwd: output });
  const extracted = join(root, "extracted");
  mkdirSync(extracted);
  execFileSync("tar", ["-xzf", join(output, archive), "-C", extracted]);
  assert.equal(
    readFileSync(join(extracted, "node_modules/tool/index.js"), "utf8"),
    "module.exports = 42;\n",
  );
  const metadata = JSON.parse(
    readFileSync(join(extracted, "RELEASE.json"), "utf8"),
  );
  assert.equal(metadata.tag, "v1.2.3");
  assert.match(metadata.commit, /^[a-f0-9]{40}$/);
});

for (const tag of ["v1.2.4", "../../unsafe"]) {
  test(`reject mismatched or unsafe release tag: ${tag}`, (t) => {
    const { source, output } = fixture(t);
    assert.throws(() =>
      execFileSync("bash", [packager, source, output, tag], { stdio: "pipe" }),
    );
  });
}

test("supports SemVer prerelease and build metadata", (t) => {
  const { source, output } = fixture(t, "1.2.3-rc.1+build.7");
  execFileSync("bash", [packager, source, output, "v1.2.3-rc.1+build.7"]);
  execFileSync(
    "sha256sum",
    ["-c", "track-atlas-v1.2.3-rc.1+build.7-almalinux10-x64.tar.gz.sha256"],
    { cwd: output },
  );
});

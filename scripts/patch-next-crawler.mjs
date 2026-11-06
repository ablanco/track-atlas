// Next bundles the HTML renderer into minified runtime files. Patch the exact
// pinned implementation without checking multi-megabyte minified diffs into Git.
import { readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const nextRoot = dirname(require.resolve("next/package.json"));
const { version } = JSON.parse(
  await readFile(join(nextRoot, "package.json"), "utf8"),
);
if (version !== "16.4.2") {
  throw new Error(
    "Recheck the crawler HTML workaround before upgrading Next.js",
  );
}

const changes = [];
for (const variant of ["", "-turbo", "-experimental", "-turbo-experimental"]) {
  for (const mode of ["dev", "prod"]) {
    const development = mode === "dev";
    const before = development
      ? "renderToPipeableStream)(element,{...streamOptions,onHeaders:"
      : "renderToPipeableStream)(e,{...t,onHeaders:";
    const after = development
      ? "renderToPipeableStream)(element,{...streamOptions,/* track-atlas:crawler-html */progressiveChunkSize:deferPipe?Infinity:streamOptions?.progressiveChunkSize,onHeaders:"
      : "renderToPipeableStream)(e,{...t,/* track-atlas:crawler-html */progressiveChunkSize:l?Infinity:t?.progressiveChunkSize,onHeaders:";
    changes.push({
      path: `dist/compiled/next-server/app-page${variant}.runtime.${mode}.js`,
      before,
      after,
    });
  }
}
for (const prefix of ["dist", "dist/esm"]) {
  changes.push({
    path: `${prefix}/server/app-render/stream-ops.node.js`,
    before: "...streamOptions,\n            onHeaders:",
    after:
      "...streamOptions,\n            // track-atlas:crawler-html: completed large boundaries must remain visible without JavaScript.\n            progressiveChunkSize: deferPipe ? Infinity : streamOptions?.progressiveChunkSize,\n            onHeaders:",
  });
}

// Validate every target before writing, and accept exactly one already-patched
// occurrence so repeated installs are safe. Unknown package contents fail closed.
const pending = [];
for (const { path, before, after } of changes) {
  const target = join(nextRoot, path);
  const source = await readFile(target, "utf8");
  if (source.split(after).length === 2 && !source.includes(before)) continue;
  if (source.split(before).length !== 2 || source.includes(after)) {
    throw new Error(`Unexpected Next.js renderer contents: ${path}`);
  }
  pending.push({ target, source: source.replace(before, after) });
}
for (const { target, source } of pending) {
  // Replace the installed file without modifying a possible shared-store hardlink.
  const temporary = `${target}.track-atlas-${process.pid}`;
  await writeFile(temporary, source);
  await rename(temporary, target);
}

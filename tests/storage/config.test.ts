import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { getStorageConfig } from "../../storage/config";

const b2Env = {
  NODE_ENV: "development",
  FILE_STORAGE_BACKEND: "b2",
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_REGION: "us-west-004",
  B2_BUCKET: "private-tracks",
  B2_KEY_ID: "test-key-id",
  B2_APPLICATION_KEY: "test-application-key",
} satisfies NodeJS.ProcessEnv;

test("local configuration is lazy, absolute, stable, and explicit in production", () => {
  const config = getStorageConfig({ NODE_ENV: "development" });
  assert.equal(config.kind, "local");
  if (config.kind !== "local") throw new Error("Expected local config");
  assert.equal(config.directory, resolve(".data/uploads"));
  assert.match(config.location, /^[a-f0-9]{64}$/);
  assert.deepEqual(config, getStorageConfig({ NODE_ENV: "development" }));
  assert.throws(
    () => getStorageConfig({ NODE_ENV: "production" }),
    /FILE_STORAGE_BACKEND/,
  );
  assert.throws(
    () =>
      getStorageConfig({
        NODE_ENV: "development",
        FILE_STORAGE_BACKEND: "unknown",
      }),
    /FILE_STORAGE_BACKEND/,
  );
  for (const directory of [".", "..", "/"])
    assert.throws(
      () =>
        getStorageConfig({
          NODE_ENV: "development",
          FILE_STORAGE_LOCAL_DIR: directory,
        }),
      /application directory/,
    );
  assert.equal(
    getStorageConfig({ NODE_ENV: "production", FILE_STORAGE_BACKEND: "local" })
      .kind,
    "local",
  );
  assert.notEqual(
    config.location,
    getStorageConfig({
      NODE_ENV: "development",
      FILE_STORAGE_LOCAL_DIR: ".data/other",
    }).location,
  );
});

test("local configuration rejects public and build paths, including symlink ancestry", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-config-"));
  try {
    for (const forbidden of [
      "public",
      "public/uploads",
      ".next",
      ".next/uploads",
    ]) {
      assert.throws(
        () =>
          getStorageConfig({
            NODE_ENV: "development",
            FILE_STORAGE_LOCAL_DIR: forbidden,
          }),
        /outside public/,
      );
    }
    symlinkSync(resolve("public"), join(directory, "public-link"));
    assert.throws(
      () =>
        getStorageConfig({
          NODE_ENV: "development",
          FILE_STORAGE_LOCAL_DIR: join(directory, "public-link", "uploads"),
        }),
      /outside public/,
    );
    mkdirSync(join(directory, "private"));
    symlinkSync(join(directory, "private"), join(directory, "private-link"));
    assert.equal(
      getStorageConfig({
        NODE_ENV: "development",
        FILE_STORAGE_LOCAL_DIR: join(directory, "private-link", "missing"),
      }).location,
      getStorageConfig({
        NODE_ENV: "development",
        FILE_STORAGE_LOCAL_DIR: join(directory, "private", "missing"),
      }).location,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("B2 requires every setting and never falls back to local", () => {
  const config = getStorageConfig(b2Env);
  assert.equal(config.kind, "b2");
  for (const name of [
    "B2_ENDPOINT",
    "B2_REGION",
    "B2_BUCKET",
    "B2_KEY_ID",
    "B2_APPLICATION_KEY",
  ]) {
    assert.throws(() => getStorageConfig({ ...b2Env, [name]: "" }), /required/);
  }
  assert.equal(
    config.location,
    getStorageConfig({
      ...b2Env,
      B2_KEY_ID: "rotated",
      B2_APPLICATION_KEY: "rotated",
    }).location,
  );
  assert.notEqual(
    config.location,
    getStorageConfig({ ...b2Env, B2_BUCKET: "other-bucket" }).location,
  );
  assert.ok(
    !JSON.stringify(config.location).includes(b2Env.B2_APPLICATION_KEY),
  );
});

test("B2 rejects arbitrary endpoints, URL extras, and mismatched regions", () => {
  for (const endpoint of [
    "http://s3.us-west-004.backblazeb2.com",
    "https://example.com",
    `${b2Env.B2_ENDPOINT}/`,
    `${b2Env.B2_ENDPOINT}/bucket`,
    `${b2Env.B2_ENDPOINT}?query`,
    `${b2Env.B2_ENDPOINT}#fragment`,
    "https://user:pass@s3.us-west-004.backblazeb2.com",
    "https://s3.us-west-004.backblazeb2.com:443",
    "https://s3.us-west-004.backblazeb2.com.evil.example",
  ]) {
    assert.throws(
      () => getStorageConfig({ ...b2Env, B2_ENDPOINT: endpoint }),
      /B2_ENDPOINT/,
    );
  }
  assert.throws(
    () => getStorageConfig({ ...b2Env, B2_REGION: "eu-central-003" }),
    /matching B2_REGION/,
  );
  assert.throws(
    () => getStorageConfig({ ...b2Env, B2_BUCKET: "../path" }),
    /bucket name/,
  );
});

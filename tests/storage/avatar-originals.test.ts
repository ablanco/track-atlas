import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getStorageConfig } from "../../storage/config";
import { createObjectStore } from "../../storage/objects";

for (const variant of ["original", "128", "24"])
  test(`avatar ${variant} objects use private nested directories and clean up interrupted writes`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-original-"));
    const store = createObjectStore(
      getStorageConfig({
        NODE_ENV: "development",
        FILE_STORAGE_LOCAL_DIR: directory,
      }),
    );
    const id = randomUUID();
    const key = `avatars/${variant}/${id}`;
    const bytes = Buffer.from([1, 255, 13, 10]);
    try {
      await store.put(key, bytes, "image/png");
      assert.deepEqual(await readFile(join(directory, key)), bytes);
      assert.deepEqual(await store.get(key, bytes.length), bytes);
      for (const path of ["avatars", `avatars/${variant}`])
        assert.equal((await lstat(join(directory, path))).mode & 0o777, 0o700);
      assert.equal((await lstat(join(directory, key))).mode & 0o777, 0o600);
      assert.deepEqual(await readdir(join(directory, `avatars/${variant}`)), [
        id,
      ]);
      await assert.rejects(
        store.put(key, Buffer.from("replacement"), "image/png"),
        { code: "EEXIST" },
      );
      await writeFile(
        join(directory, `avatars/${variant}`, `.tmp-${id}`),
        "partial",
      );
      await store.remove(key);
      await store.remove(key);
      assert.equal(await store.get(key, 10), null);
      assert.deepEqual(
        await readdir(join(directory, `avatars/${variant}`)),
        [],
      );
      for (const path of [
        `avatars/other/${id}`,
        `avatars/original/../${id}`,
        `avatars/original/${id}/extra`,
        `/avatars/original/${id}`,
      ]) {
        await assert.rejects(store.put(path, bytes, "image/png"), /UUID/);
        await assert.rejects(store.get(path, 10), /UUID/);
        await assert.rejects(store.remove(path), /UUID/);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

for (const component of ["avatars", "original", "128", "24"])
  test(`avatar storage rejects a symlink at ${component}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-original-link-"));
    const outside = await mkdtemp(join(tmpdir(), "atlas-original-outside-"));
    const store = createObjectStore(
      getStorageConfig({
        NODE_ENV: "development",
        FILE_STORAGE_LOCAL_DIR: directory,
      }),
    );
    const id = randomUUID();
    const key = `avatars/${component === "avatars" ? "original" : component}/${id}`;
    try {
      if (component !== "avatars") await mkdir(join(directory, "avatars"));
      await symlink(
        outside,
        component === "avatars"
          ? join(directory, "avatars")
          : join(directory, "avatars", component),
      );
      await writeFile(join(outside, id), "outside");
      await assert.rejects(
        store.put(key, Buffer.from("private"), "image/png"),
        /symlink/,
      );
      await assert.rejects(store.get(key, 10), /symlink/);
      await assert.rejects(store.remove(key), /symlink/);
      assert.equal(await readFile(join(outside, id), "utf8"), "outside");
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

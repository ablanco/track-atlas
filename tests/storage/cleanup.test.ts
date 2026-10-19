import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createObjectStore } from "../../storage/objects";
import { getStorageConfig } from "../../storage/config";

test("local removal clears crash-left temporary objects as well as published bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "atlas-crashed-write-"));
  const store = createObjectStore({
    kind: "local",
    directory,
    location: "test-location",
  });
  const id = randomUUID();
  try {
    await writeFile(join(directory, `.tmp-${id}`), "partial bytes");
    await store.remove(id);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("canonical local storage identity survives ancestor symlink retargeting", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-retarget-"));
  const id = randomUUID();
  const first = join(root, "first", "uploads");
  const second = join(root, "second", "uploads");
  const current = join(root, "current");
  try {
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(join(first, id), "first bytes");
    await writeFile(join(second, id), "second bytes");
    await symlink(join(root, "first"), current);
    const store = createObjectStore(
      getStorageConfig({
        NODE_ENV: "development",
        FILE_STORAGE_LOCAL_DIR: join(current, "uploads"),
      }),
    );
    await unlink(current);
    await symlink(join(root, "second"), current);
    await store.remove(id);
    await assert.rejects(readFile(join(first, id)), { code: "ENOENT" });
    assert.equal(await readFile(join(second, id), "utf8"), "second bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("B2 removal permanently deletes all exact-key versions and markers across pages", async () => {
  const id = randomUUID();
  const unrelated = randomUUID();
  const removed: string[] = [];
  let lists = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET") {
      assert.equal(url.searchParams.get("prefix"), id);
      lists++;
      response.setHeader("content-type", "application/xml");
      if (lists === 1) {
        response.end(
          `<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>true</IsTruncated><NextKeyMarker>${id}</NextKeyMarker><NextVersionIdMarker>old</NextVersionIdMarker><Version><Key>${id}</Key><VersionId>old</VersionId></Version><Version><Key>${unrelated}</Key><VersionId>foreign</VersionId></Version></ListVersionsResult>`,
        );
      } else {
        assert.equal(url.searchParams.get("key-marker"), id);
        assert.equal(url.searchParams.get("version-id-marker"), "old");
        response.end(
          `<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><Version><Key>${id}</Key><VersionId>new</VersionId></Version><DeleteMarker><Key>${id}</Key><VersionId>hidden</VersionId></DeleteMarker></ListVersionsResult>`,
        );
      }
    } else {
      assert.equal(request.method, "DELETE");
      assert.equal(url.pathname, `/private-tracks/${id}`);
      const version = url.searchParams.get("versionId");
      assert.ok(version);
      removed.push(version);
      response.writeHead(204).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const store = createObjectStore({
    kind: "b2",
    endpoint: `http://127.0.0.1:${address.port}`,
    region: "us-west-004",
    bucket: "private-tracks",
    keyId: "test",
    applicationKey: "test-secret",
    location: "test",
  });
  try {
    await store.remove(id);
    assert.equal(lists, 2);
    assert.deepEqual(removed, ["old", "new", "hidden"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

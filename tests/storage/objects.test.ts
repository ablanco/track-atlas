import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { StorageConfig } from "../../storage/config";
import { createObjectStore } from "../../storage/objects";

async function localFixture() {
  const root = await mkdtemp(join(tmpdir(), "atlas-objects-"));
  const directory = join(root, "objects");
  const store = createObjectStore({
    kind: "local",
    directory,
    location: "test-location",
  });
  return {
    root,
    directory,
    store,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("local objects are private, byte-exact, immutable, and removable", async () => {
  const fixture = await localFixture();
  const { store, directory } = fixture;
  const key = randomUUID();
  const bytes = Buffer.from([0, 255, 13, 10]);
  try {
    assert.equal(store.location, "test-location");
    assert.equal(await store.get(key, 10), null);
    await store.remove(key);
    await store.put(key, bytes, "application/octet-stream");
    assert.deepEqual(await store.get(key, bytes.length), bytes);
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    assert.equal((await lstat(join(directory, key))).mode & 0o777, 0o600);
    await assert.rejects(
      store.put(key, Buffer.from("replacement"), "text/plain"),
      { code: "EEXIST" },
    );
    assert.deepEqual(await readFile(join(directory, key)), bytes);
    assert.deepEqual(await readdir(directory), [key]);
    await store.remove(key);
    await store.remove(key);
    assert.equal(await store.get(key, 10), null);
    await chmod(directory, 0o755);
    await store.put(randomUUID(), Buffer.alloc(0), "text/plain");
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  } finally {
    await fixture.cleanup();
  }
});

test("local writes atomically select one winner without leftover temporary files", async () => {
  const fixture = await localFixture();
  const key = randomUUID();
  try {
    const results = await Promise.allSettled([
      fixture.store.put(key, Buffer.alloc(100_000, 1), "text/plain"),
      fixture.store.put(key, Buffer.alloc(100_000, 2), "text/plain"),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const stored = await fixture.store.get(key, 100_000);
    assert.ok(stored);
    assert.ok(
      stored.equals(Buffer.alloc(100_000, 1)) ||
        stored.equals(Buffer.alloc(100_000, 2)),
    );
    assert.deepEqual(await readdir(fixture.directory), [key]);
  } finally {
    await fixture.cleanup();
  }
});

test("local rejects traversal, noncanonical UUIDs, invalid limits, and oversized objects", async () => {
  const fixture = await localFixture();
  try {
    for (const key of [
      "../escape",
      "/tmp/escape",
      "a/b",
      randomUUID().toUpperCase(),
      "00000000-0000-1000-8000-000000000000",
      "00000000-0000-4000-7000-000000000000",
    ]) {
      await assert.rejects(
        fixture.store.put(key, Buffer.from("x"), "text/plain"),
        /UUID/,
      );
      await assert.rejects(fixture.store.get(key, 10), /UUID/);
      await assert.rejects(fixture.store.remove(key), /UUID/);
    }
    const key = randomUUID();
    await fixture.store.put(key, Buffer.from("large"), "text/plain");
    for (const limit of [0, -1, 1.5, NaN, Infinity, 10 * 1024 * 1024 + 1]) {
      await assert.rejects(fixture.store.get(key, limit), /read limit/);
    }
    await assert.rejects(fixture.store.get(key, 4), /exceeds read limit/);
    assert.deepEqual(
      await fixture.store.get(key, 10 * 1024 * 1024),
      Buffer.from("large"),
    );
  } finally {
    await fixture.cleanup();
  }
});

test("local rejects root and object symlinks and propagates non-missing errors", async () => {
  const fixture = await localFixture();
  const key = randomUUID();
  try {
    await mkdir(fixture.directory);
    const outside = join(fixture.root, "outside");
    await writeFile(outside, "private");
    await symlink(outside, join(fixture.directory, key));
    await assert.rejects(fixture.store.get(key, 100), { code: "ELOOP" });
    await assert.rejects(
      fixture.store.put(key, Buffer.from("x"), "text/plain"),
      { code: "EEXIST" },
    );
    await fixture.store.remove(key);
    assert.equal(await readFile(outside, "utf8"), "private");
    await mkdir(join(fixture.directory, key));
    await assert.rejects(fixture.store.get(key, 10), /regular file/);
    await assert.rejects(fixture.store.remove(key));
    for (const target of [
      fixture.directory,
      resolve("public"),
      resolve(".next"),
    ]) {
      const alias = join(fixture.root, randomUUID());
      await symlink(target, alias);
      const store = createObjectStore({
        kind: "local",
        directory: alias,
        location: "alias",
      });
      await assert.rejects(
        store.put(randomUUID(), Buffer.from("x"), "text/plain"),
      );
      await assert.rejects(store.get(randomUUID(), 10));
      await assert.rejects(store.remove(randomUUID()));
    }
    const alias = join(fixture.root, "public-ancestor");
    await symlink(resolve("public"), alias);
    const store = createObjectStore({
      kind: "local",
      directory: join(alias, "nested"),
      location: "alias",
    });
    await assert.rejects(
      store.put(randomUUID(), Buffer.from("x"), "text/plain"),
      /outside public/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("B2 uses signed private S3 requests and bounded streamed reads on loopback", async () => {
  const requests: {
    method: string | undefined;
    path: string | undefined;
    authorization: string | undefined;
    acl: string | string[] | undefined;
    contentType: string | undefined;
    bytes: Buffer;
  }[] = [];
  const objects = new Map<string, Buffer>();
  const oversized = randomUUID();
  const streamed = randomUUID();
  const forbidden = randomUUID();
  const missing = randomUUID();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;
    requests.push({
      method: request.method,
      path,
      authorization: request.headers.authorization,
      acl: request.headers["x-amz-acl"],
      contentType: request.headers["content-type"],
      bytes: Buffer.concat(chunks),
    });
    if (
      path.endsWith(forbidden) ||
      url.searchParams.get("prefix") === forbidden
    ) {
      response.writeHead(403, { "content-type": "application/xml" });
      response.end(
        "<Error><Code>AccessDenied</Code><Message>Denied</Message></Error>",
      );
    } else if (path.endsWith(missing)) {
      response.writeHead(404, { "content-type": "application/xml" });
      response.end(
        "<Error><Code>NoSuchKey</Code><Message>Missing</Message></Error>",
      );
    } else if (url.searchParams.has("versions")) {
      const prefix = url.searchParams.get("prefix");
      const keyPath = `/private-tracks/${prefix}`;
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(
        `<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>${objects.has(keyPath) ? `<Version><Key>${prefix}</Key><VersionId>stored-version</VersionId></Version>` : ""}</ListVersionsResult>`,
      );
    } else if (request.method === "PUT") {
      objects.set(path, Buffer.concat(chunks));
      response.writeHead(200, { etag: '"test-etag"' });
      response.end();
    } else if (request.method === "DELETE") {
      objects.delete(path);
      response.writeHead(204);
      response.end();
    } else if (path.endsWith(oversized)) {
      response.writeHead(200, { "content-length": "1000" });
      response.end(Buffer.alloc(1000));
    } else if (path.endsWith(streamed)) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.write(Buffer.alloc(6));
      response.end(Buffer.alloc(6));
    } else if (objects.has(path)) {
      response.end(objects.get(path));
    } else {
      response.writeHead(404, { "content-type": "application/xml" });
      response.end(
        "<Error><Code>NoSuchKey</Code><Message>Missing</Message></Error>",
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config: StorageConfig = {
    kind: "b2",
    endpoint: `http://127.0.0.1:${address.port}`,
    region: "us-west-004",
    bucket: "private-tracks",
    keyId: "test-key-id",
    applicationKey: "test-secret",
    location: "b2-test",
  };
  const store = createObjectStore(config);
  const key = randomUUID();
  const bytes = Buffer.from([0, 255, 1, 2]);
  try {
    assert.equal(store.location, "b2-test");
    await store.put(key, bytes, "application/gpx+xml");
    assert.deepEqual(await store.get(key, bytes.length), bytes);
    await assert.rejects(store.get(oversized, 10), /exceeds read limit/);
    await assert.rejects(store.get(streamed, 10), /exceeds read limit/);
    await assert.rejects(store.get(forbidden, 10), { name: "AccessDenied" });
    await assert.rejects(store.put(forbidden, bytes, "text/plain"), {
      name: "AccessDenied",
    });
    await assert.rejects(store.remove(forbidden), { name: "AccessDenied" });
    await store.remove(missing);
    await store.remove(key);
    await store.remove(key);
    assert.equal(await store.get(key, 10), null);
    for (const variant of ["original", "128", "24"]) {
      const avatarKey = `avatars/${variant}/${randomUUID()}`;
      await store.put(
        avatarKey,
        bytes,
        variant === "original" ? "image/png" : "image/webp",
      );
      assert.deepEqual(await store.get(avatarKey, bytes.length), bytes);
      await store.remove(avatarKey);
      assert.equal(await store.get(avatarKey, bytes.length), null);
    }
    const before = requests.length;
    await assert.rejects(store.get("../escape", 10), /UUID/);
    await assert.rejects(store.put("../escape", bytes, "text/plain"), /UUID/);
    await assert.rejects(store.remove("../escape"), /UUID/);
    await assert.rejects(store.get(key, 0), /read limit/);
    assert.equal(requests.length, before);
    for (const request of requests) {
      assert.match(
        request.authorization ?? "",
        /^AWS4-HMAC-SHA256 Credential=test-key-id\//,
      );
      assert.match(
        request.path ?? "",
        /^\/private-tracks\/(?:avatars\/(?:original|128|24)\/)?[0-9a-f-]*$/,
      );
      assert.equal(request.acl, undefined);
    }
    assert.deepEqual(requests[0].bytes, bytes);
    assert.equal(requests[0].contentType, "application/gpx+xml");
    assert.equal(requests[0].path, `/private-tracks/${key}`);
    assert.equal(requests[0].method, "PUT");
    assert.ok(requests.some((request) => request.method === "GET"));
    assert.ok(requests.some((request) => request.method === "DELETE"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

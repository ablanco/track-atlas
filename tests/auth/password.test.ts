import assert from "node:assert/strict";
import { scrypt } from "node:crypto";
import { test } from "node:test";
import {
  hashPassword,
  verifyPassword,
  HashBusyError,
} from "../../auth/password";

test("salted password encoding independently verifies and preserves password spaces", async () => {
  const first = await hashPassword(" x ");
  const second = await hashPassword(" x ");
  assert.notEqual(first, second);
  for (const encoded of [first, second]) {
    const match = /^\$scrypt\$v=1\$N=32768,r=8,p=3\$([\w-]+)\$([\w-]+)$/.exec(
      encoded,
    );
    assert.ok(match);
    const salt = Buffer.from(match[1], "base64url");
    assert.equal(salt.length, 16);
    const derive = (password: string) =>
      new Promise<Buffer>((resolve, reject) =>
        scrypt(
          password,
          salt,
          64,
          { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
          (error, key) => (error ? reject(error) : resolve(key)),
        ),
      );
    const stored = Buffer.from(match[2], "base64url");
    assert.equal(stored.length, 64);
    assert.deepEqual(await derive(" x "), stored);
    assert.notDeepEqual(await derive("x"), stored);
  }
});

test("hashing rejects excess concurrent work without queueing and releases capacity", async () => {
  const outcomes = await Promise.allSettled([
    hashPassword("one"),
    hashPassword("two"),
    hashPassword("three"),
  ]);
  assert.equal(
    outcomes.filter((result) => result.status === "fulfilled").length,
    2,
  );
  const rejected = outcomes.find((result) => result.status === "rejected");
  assert.ok(
    rejected?.status === "rejected" && rejected.reason instanceof HashBusyError,
  );
  assert.ok(await hashPassword("after"));
});

test("hash operation failure also releases capacity", async () => {
  await assert.rejects(hashPassword(null as unknown as string));
  const outcomes = await Promise.allSettled([
    hashPassword("one"),
    hashPassword("two"),
  ]);
  assert.ok(outcomes.every((result) => result.status === "fulfilled"));
});

test("password verification preserves spaces and rejects wrong passwords", async () => {
  const encoded = await hashPassword(" x ");
  assert.equal(await verifyPassword(" x ", encoded), true);
  assert.equal(await verifyPassword("x", encoded), false);
  assert.equal(await verifyPassword("wrong", encoded), false);
});

test("unsupported encodings use bounded dummy work and never authenticate", async () => {
  const encoded = await hashPassword("secret");
  const parts = encoded.split("$");
  for (const value of [
    null,
    "synthetic",
    encoded.replace("v=1", "v=2"),
    encoded.replace("N=32768", "N=1073741824"),
    encoded + "extra",
    encoded.replace(parts[4], "AA"),
    encoded.replace(parts[5], "AA"),
    encoded.replace(parts[4], parts[4] + "="),
    "a".repeat(10000),
  ]) {
    const first = verifyPassword("secret", value);
    const second = hashPassword("another");
    await assert.rejects(verifyPassword("secret", encoded), HashBusyError);
    assert.equal(await first, false);
    await second;
  }
});

test("hash and verify share capacity and verification errors release it", async () => {
  const encoded = await hashPassword("secret");
  const outcomes = await Promise.allSettled([
    hashPassword("one"),
    verifyPassword("secret", encoded),
    verifyPassword("secret", encoded),
  ]);
  assert.equal(
    outcomes.filter((result) => result.status === "fulfilled").length,
    2,
  );
  assert.ok(
    outcomes.some(
      (result) =>
        result.status === "rejected" && result.reason instanceof HashBusyError,
    ),
  );
  await assert.rejects(verifyPassword(null as unknown as string, encoded));
  assert.equal(await verifyPassword("secret", encoded), true);
});

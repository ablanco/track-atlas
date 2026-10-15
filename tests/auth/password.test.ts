import assert from "node:assert/strict";
import { scrypt } from "node:crypto";
import { test } from "node:test";
import { hashPassword, HashBusyError } from "../../auth/password";

test("salted password encoding independently verifies and preserves password spaces", async () => {
  const first = await hashPassword(" x ");
  const second = await hashPassword(" x ");
  assert.notEqual(first, second);
  for (const encoded of [first, second]) {
    const match = /^\$scrypt\$v=1\$N=32768,r=8,p=3\$([\w-]+)\$([\w-]+)$/.exec(encoded);
    assert.ok(match);
    const salt = Buffer.from(match[1], "base64url");
    assert.equal(salt.length, 16);
    const derive = (password: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
    const stored = Buffer.from(match[2], "base64url");
    assert.equal(stored.length, 64);
    assert.deepEqual(await derive(" x "), stored);
    assert.notDeepEqual(await derive("x"), stored);
  }
});

test("hashing rejects excess concurrent work without queueing and releases capacity", async () => {
  const outcomes = await Promise.allSettled([hashPassword("one"), hashPassword("two"), hashPassword("three")]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 2);
  const rejected = outcomes.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof HashBusyError);
  assert.ok(await hashPassword("after"));
});

test("hash operation failure also releases capacity", async () => {
  await assert.rejects(hashPassword(null as unknown as string));
  const outcomes = await Promise.allSettled([hashPassword("one"), hashPassword("two")]);
  assert.ok(outcomes.every((result) => result.status === "fulfilled"));
});

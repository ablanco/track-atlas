import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export class HashBusyError extends Error {
  constructor() { super("Password hashing is busy"); }
}

let activeHashes = 0;
const prefix = "$scrypt$v=1$N=32768,r=8,p=3$";
const dummySalt = Buffer.alloc(16);
const dummyKey = Buffer.alloc(64);

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (activeHashes >= 2) throw new HashBusyError();
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result));
    });
  } finally {
    activeHashes--;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${prefix}${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const match = encoded?.length === prefix.length + 22 + 1 + 86 ? /^\$scrypt\$v=1\$N=32768,r=8,p=3\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/.exec(encoded) : null;
  const salt = match ? Buffer.from(match[1], "base64url") : dummySalt;
  const expected = match ? Buffer.from(match[2], "base64url") : dummyKey;
  const supported = !!match && salt.toString("base64url") === match[1] && expected.toString("base64url") === match[2];
  const actual = await derive(password, supported ? salt : dummySalt);
  return timingSafeEqual(actual, supported ? expected : dummyKey) && supported;
}

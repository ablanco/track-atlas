import "server-only";
import { randomBytes, scrypt } from "node:crypto";

export class HashBusyError extends Error {
  constructor() { super("Password hashing is busy"); }
}

let activeHashes = 0;

export async function hashPassword(password: string): Promise<string> {
  if (activeHashes >= 2) throw new HashBusyError();
  activeHashes++;
  try {
    const salt = randomBytes(16);
    const key = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result));
    });
    return `$scrypt$v=1$N=32768,r=8,p=3$${salt.toString("base64url")}$${key.toString("base64url")}`;
  } finally {
    activeHashes--;
  }
}

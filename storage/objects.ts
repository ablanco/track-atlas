import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { getStorageConfig, type StorageConfig } from "./config";

export interface ObjectStore {
  readonly location: string;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string, maxBytes: number): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

const maximumRead = 20 * 1024 * 1024;

function validateKey(key: string): void {
  if (
    !/^(?:avatars\/(?:original|128|24)\/|photos\/(?:large|thumbnail)\/(?:jpeg|webp|avif)\/)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      key,
    )
  ) {
    throw new Error("Object keys must be canonical lowercase UUID v4 values");
  }
}

function validateLimit(maxBytes: number): void {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > maximumRead
  ) {
    throw new Error("Object read limit must be between 1 byte and 20 MiB");
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function localStore(
  config: Extract<StorageConfig, { kind: "local" }>,
): ObjectStore {
  async function syncDirectory(directory: string) {
    const handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function checkRoot(create = false): Promise<void> {
    const checked = getStorageConfig({
      NODE_ENV: "development",
      FILE_STORAGE_BACKEND: "local",
      FILE_STORAGE_LOCAL_DIR: config.directory,
    });
    if (checked.kind !== "local" || checked.directory !== config.directory)
      throw new Error("File storage location changed");
    if (create) {
      await mkdir(config.directory, { recursive: true, mode: 0o700 });
      let directory = config.directory;
      while (true) {
        await syncDirectory(directory);
        const parent = dirname(directory);
        if (directory === parent) break;
        directory = parent;
      }
    }
    const root = await lstat(config.directory);
    if (root.isSymbolicLink() || !root.isDirectory())
      throw new Error("Object storage root must be a real directory");
    if (create) await chmod(config.directory, 0o700);
  }

  async function objectDirectory(key: string, create = false) {
    await checkRoot(create);
    let directory = config.directory;
    if (!key.includes("/")) return directory;
    for (const part of key.split("/").slice(0, -1)) {
      const parent = directory;
      directory = join(/* turbopackIgnore: true */ parent, part);
      if (create) {
        try {
          await mkdir(directory, { mode: 0o700 });
        } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
        }
      }
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Avatar storage directory must not be a symlink");
      if (create) {
        await chmod(directory, 0o700);
        await syncDirectory(directory);
        await syncDirectory(parent);
      }
    }
    return directory;
  }

  return {
    location: config.location,
    async put(key, bytes) {
      validateKey(key);
      const directory = await objectDirectory(key, true);
      const temporary = join(directory, `.tmp-${basename(key)}`);
      const file = await open(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(bytes);
        await file.sync();
        await file.close();
        await link(temporary, join(config.directory, key));
      } finally {
        try {
          await file.close();
        } finally {
          await unlink(temporary);
          await syncDirectory(directory);
        }
      }
    },
    async get(key, maxBytes) {
      validateKey(key);
      validateLimit(maxBytes);
      try {
        const directory = await objectDirectory(key);
        const file = await open(
          join(directory, basename(key)),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const stat = await file.stat();
          if (!stat.isFile())
            throw new Error("Stored object must be a regular file");
          if (stat.size > maxBytes)
            throw new Error("Stored object exceeds read limit");
          const bytes = Buffer.alloc(maxBytes + 1);
          let total = 0;
          while (total < bytes.length) {
            const { bytesRead } = await file.read(
              bytes,
              total,
              bytes.length - total,
              null,
            );
            if (bytesRead === 0) break;
            total += bytesRead;
            if (total > maxBytes)
              throw new Error("Stored object exceeds read limit");
          }
          return bytes.subarray(0, total);
        } finally {
          await file.close();
        }
      } catch (error) {
        if (hasCode(error, "ENOENT")) return null;
        throw error;
      }
    },
    async remove(key) {
      validateKey(key);
      try {
        const directory = await objectDirectory(key);
        for (const name of [basename(key), `.tmp-${basename(key)}`]) {
          try {
            await unlink(join(directory, name));
          } catch (error) {
            if (!hasCode(error, "ENOENT")) throw error;
          }
        }
        await syncDirectory(directory);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
    },
  };
}

function b2Store(config: Extract<StorageConfig, { kind: "b2" }>): ObjectStore {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey,
    },
    forcePathStyle: true,
    maxAttempts: 2,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });

  async function timed<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      return await operation(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    location: config.location,
    async put(key, bytes, contentType) {
      validateKey(key);
      // B2's documented PutObject API has no If-None-Match. Never reuse server-generated UUID keys.
      await timed((abortSignal) =>
        client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
          }),
          { abortSignal },
        ),
      );
    },
    async get(key, maxBytes) {
      validateKey(key);
      validateLimit(maxBytes);
      return timed(async (abortSignal) => {
        let body: Readable | undefined;
        const abort = () =>
          body?.destroy(new Error("Object storage request timed out"));
        try {
          const result = await client.send(
            new GetObjectCommand({ Bucket: config.bucket, Key: key }),
            { abortSignal },
          );
          if (!(result.Body instanceof Readable))
            throw new Error("Object storage returned an invalid response body");
          body = result.Body;
          abortSignal.addEventListener("abort", abort, { once: true });
          if (abortSignal.aborted)
            throw new Error("Object storage request timed out");
          if (
            result.ContentLength !== undefined &&
            (!Number.isSafeInteger(result.ContentLength) ||
              result.ContentLength < 0 ||
              result.ContentLength > maxBytes)
          ) {
            throw new Error("Stored object exceeds read limit");
          }
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of body) {
            if (!(chunk instanceof Uint8Array))
              throw new Error("Object storage returned invalid bytes");
            total += chunk.byteLength;
            if (total > maxBytes)
              throw new Error("Stored object exceeds read limit");
            chunks.push(Buffer.from(chunk));
          }
          return Buffer.concat(chunks, total);
        } catch (error) {
          if (
            error instanceof Error &&
            (error.name === "NoSuchKey" || error.name === "NotFound")
          )
            return null;
          throw error;
        } finally {
          abortSignal.removeEventListener("abort", abort);
          body?.destroy();
        }
      });
    },
    async remove(key) {
      validateKey(key);
      try {
        await timed(async (abortSignal) => {
          let keyMarker: string | undefined;
          let versionMarker: string | undefined;
          while (true) {
            const page = await client.send(
              new ListObjectVersionsCommand({
                Bucket: config.bucket,
                Prefix: key,
                KeyMarker: keyMarker,
                VersionIdMarker: versionMarker,
              }),
              { abortSignal },
            );
            for (const version of [
              ...(page.Versions ?? []),
              ...(page.DeleteMarkers ?? []),
            ]) {
              if (version.Key !== key) continue;
              if (!version.VersionId)
                throw new Error(
                  "Object storage returned a version without an identifier",
                );
              await client.send(
                new DeleteObjectCommand({
                  Bucket: config.bucket,
                  Key: key,
                  VersionId: version.VersionId,
                }),
                { abortSignal },
              );
            }
            if (!page.IsTruncated) break;
            if (
              !page.NextKeyMarker ||
              (page.NextKeyMarker === keyMarker &&
                page.NextVersionIdMarker === versionMarker)
            )
              throw new Error("Invalid object version pagination");
            keyMarker = page.NextKeyMarker;
            versionMarker = page.NextVersionIdMarker;
          }
        });
      } catch (error) {
        if (!(
          error instanceof Error &&
          (error.name === "NoSuchKey" || error.name === "NotFound")
        ))
          throw error;
      }
    },
  };
}

export function createObjectStore(config: StorageConfig): ObjectStore {
  return config.kind === "local" ? localStore(config) : b2Store(config);
}

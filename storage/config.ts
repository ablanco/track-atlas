import "server-only";

import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type StorageConfig =
  | { kind: "local"; directory: string; location: string }
  | {
      kind: "b2";
      endpoint: string;
      region: string;
      bucket: string;
      keyId: string;
      applicationKey: string;
      location: string;
    };

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(canonicalPath(parent), relative(parent, path));
  }
}

function inside(path: string, root: string): boolean {
  const difference = relative(root, path);
  return (
    difference === "" ||
    (!isAbsolute(difference) &&
      difference !== ".." &&
      !difference.startsWith(`..${sep}`))
  );
}

function location(...parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function getStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): StorageConfig {
  const kind =
    env.FILE_STORAGE_BACKEND ??
    (env.NODE_ENV === "production" ? undefined : "local");
  if (kind === "local") {
    const directory = resolve(
      /* turbopackIgnore: true */ env.FILE_STORAGE_LOCAL_DIR || ".data/uploads",
    );
    const canonical = canonicalPath(directory);
    if (inside(process.cwd(), canonical))
      throw new Error(
        "File storage must not contain the application directory",
      );
    try {
      if (lstatSync(directory).isSymbolicLink())
        throw new Error("File storage root must not be a symlink");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    for (const name of ["public", ".next"]) {
      const forbidden = resolve(/* turbopackIgnore: true */ name);
      if (
        inside(directory, forbidden) ||
        inside(canonical, canonicalPath(forbidden))
      ) {
        throw new Error("File storage must be outside public and .next");
      }
    }
    return { kind, directory: canonical, location: location(kind, canonical) };
  }
  if (kind !== "b2")
    throw new Error("FILE_STORAGE_BACKEND must be local or b2");

  function required(name: string): string {
    const value = env[name];
    if (!value?.trim()) throw new Error(`${name} is required for B2 storage`);
    return value;
  }

  const endpoint = required("B2_ENDPOINT");
  const match =
    /^https:\/\/s3\.([a-z0-9]+(?:-[a-z0-9]+)*)\.backblazeb2\.com$/.exec(
      endpoint,
    );
  const region = required("B2_REGION");
  if (!match || match[1] !== region)
    throw new Error(
      "B2_ENDPOINT must be an HTTPS Backblaze S3 endpoint matching B2_REGION",
    );
  const bucket = required("B2_BUCKET");
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes("..")
  ) {
    throw new Error("B2_BUCKET must be a valid bucket name");
  }
  return {
    kind,
    endpoint,
    region,
    bucket,
    keyId: required("B2_KEY_ID"),
    applicationKey: required("B2_APPLICATION_KEY"),
    location: location(kind, endpoint, bucket),
  };
}

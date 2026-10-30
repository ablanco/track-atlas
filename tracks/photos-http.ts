import "server-only";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { AdminError } from "../admin/types";
import { requireAdmin } from "../admin/auth";
import { storedFiles, trackPhotos, trackPhotoVersions } from "../db/schema";
import { createObjectStore } from "../storage/objects";
import { getStorageConfig } from "../storage/config";
import {
  photoFormats,
  photoSizes,
  photoVersionKey,
  type PhotoSize,
  type PhotoFormat,
} from "../storage/photo-versions";
import { getTrack } from "./service";
import { TrackError, trackIdPattern } from "./validation";
import { trackFailure } from "./http";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function servePhotos(
  request: Request,
  trackId: string,
  photoId?: string,
) {
  try {
    const db = getDb(),
      token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (
      !trackIdPattern.test(trackId) ||
      (photoId && !trackIdPattern.test(photoId))
    )
      throw new TrackError("notFound");
    const track = await getTrack({ db, token, id: trackId });
    if (!track) throw new TrackError("notFound");
    const photos = await db
      .select({ id: trackPhotos.id, caption: trackPhotos.caption })
      .from(trackPhotos)
      .innerJoin(storedFiles, eq(storedFiles.id, trackPhotos.id))
      .where(
        and(eq(trackPhotos.trackId, trackId), eq(storedFiles.status, "ready")),
      )
      .orderBy(trackPhotos.ordinal);
    if (!photoId) return Response.json(photos, { headers });
    if (!photos.some((p) => p.id === photoId)) throw new TrackError("notFound");
    const params = new URL(request.url).searchParams;
    const size = params.get("size") ?? "large",
      format = params.get("format") ?? "webp";
    if (
      [...params.keys()].some((k) => !["size", "format"].includes(k)) ||
      params.getAll("size").length > 1 ||
      params.getAll("format").length > 1 ||
      !photoSizes.includes(size as PhotoSize) ||
      !photoFormats.includes(format as PhotoFormat)
    )
      throw new TrackError("invalidRequest");
    const [version] = await db
      .select({
        byteSize: trackPhotoVersions.byteSize,
        sha256: trackPhotoVersions.sha256,
        location: storedFiles.storageLocation,
      })
      .from(trackPhotoVersions)
      .innerJoin(storedFiles, eq(storedFiles.id, trackPhotoVersions.photoId))
      .where(
        and(
          eq(trackPhotoVersions.photoId, photoId),
          eq(trackPhotoVersions.size, size as PhotoSize),
          eq(trackPhotoVersions.format, format as PhotoFormat),
        ),
      );
    if (!version) throw new TrackError("notFound");
    const store = createObjectStore(getStorageConfig());
    if (store.location !== version.location)
      throw new Error("Storage location unavailable");
    const bytes = await store.get(
      photoVersionKey(photoId, size as PhotoSize, format as PhotoFormat),
      version.byteSize,
    );
    if (
      !bytes ||
      createHash("sha256").update(bytes).digest("hex") !== version.sha256
    )
      throw new Error("Photo integrity failure");
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": `image/${format}`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return trackFailure(
      error instanceof AdminError ? new TrackError(error.code) : error,
    );
  }
}
export async function serveAdminPhotoOriginal(id: string) {
  try {
    const db = getDb(),
      token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    await requireAdmin(db, token);
    if (!trackIdPattern.test(id)) throw new TrackError("notFound");
    const [file] = await db
      .select()
      .from(storedFiles)
      .where(
        and(
          eq(storedFiles.id, id),
          eq(storedFiles.purpose, "photo"),
          eq(storedFiles.status, "ready"),
        ),
      );
    if (!file) throw new TrackError("notFound");
    const store = createObjectStore(getStorageConfig());
    if (store.location !== file.storageLocation)
      throw new Error("Storage location unavailable");
    const bytes = await store.get(file.objectKey, file.byteSize);
    if (
      !bytes ||
      createHash("sha256").update(bytes).digest("hex") !== file.sha256
    )
      throw new Error("Photo integrity failure");
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="photo-original"',
      },
    });
  } catch (error) {
    return trackFailure(
      error instanceof AdminError ? new TrackError(error.code) : error,
    );
  }
}

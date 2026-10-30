import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { storedFiles, trackPhotoVersions } from "../db/schema";

/** Call inside the reservation transaction while holding the owner row lock. */
export async function hasUploadCapacity(
  executor: Pick<Database, "select">,
  ownerId: string,
  reservationBytes: number,
): Promise<boolean> {
  const [usage] = await executor
    .select({
      count: sql<number>`count(*)::integer`,
      bytes: sql<number>`coalesce(sum(${storedFiles.byteSize} + coalesce(${storedFiles.avatar128Bytes}, 0) + coalesce(${storedFiles.avatar24Bytes}, 0)), 0)::integer`,
      pending: sql<number>`count(*) FILTER (WHERE ${storedFiles.status} = 'pending')::integer`,
    })
    .from(storedFiles)
    .where(eq(storedFiles.ownerId, ownerId));
  return (
    usage.count < 100 &&
    usage.bytes +
      Number(
        (
          await executor
            .select({
              bytes: sql<number>`coalesce(sum(${trackPhotoVersions.byteSize}),0)`,
            })
            .from(trackPhotoVersions)
            .innerJoin(
              storedFiles,
              eq(storedFiles.id, trackPhotoVersions.photoId),
            )
            .where(eq(storedFiles.ownerId, ownerId))
        )[0].bytes,
      ) +
      reservationBytes <=
      1024 * 1024 * 1024 &&
    usage.pending < 2
  );
}

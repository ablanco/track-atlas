import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { findSessionUser, isSessionToken } from "../auth/session-store";
import { sessions, storedFiles, users } from "../db/schema";
import type { ObjectStore } from "./objects";
import { FileError, uploadPolicies, validateFile, type FilePurpose } from "./validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type StoredFile = typeof storedFiles.$inferSelect;
type FileDependencies = { db: Database; store: ObjectStore; token: string | undefined };
const fileIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

async function asOwner<T>(db: Database, token: string | undefined, work: (tx: Transaction, ownerId: string, avatarFileId: string | null) => Promise<T>): Promise<T> {
  if (!isSessionToken(token)) throw new FileError("unauthorized");
  const identity = await findSessionUser(db, token);
  if (!identity) throw new FileError("unauthorized");
  return db.transaction(async tx => {
    const [user] = await tx.select({ active: users.active, avatarFileId: users.avatarFileId }).from(users).where(eq(users.id, identity.userId)).for("update");
    if (!user?.active) throw new FileError("unauthorized");
    const [session] = await tx.select({ id: sessions.id }).from(sessions).where(and(
      eq(sessions.userId, identity.userId), eq(sessions.tokenHash, createHash("sha256").update(token).digest("hex")),
      gt(sessions.expiresAt, sql`clock_timestamp()`),
    )).for("update");
    if (!session) throw new FileError("unauthorized");
    return work(tx, identity.userId, user.avatarFileId);
  });
}

function publicFile(file: StoredFile) {
  return { id: file.id, purpose: file.purpose, byteSize: file.byteSize, contentType: file.contentType, createdAt: file.createdAt.toISOString(), downloadUrl: `/api/files/${file.id}` };
}

async function abandon(db: Database, id: string) {
  // A failed commit may already have made the file ready. Never delete that object.
  const [file] = await db.update(storedFiles).set({ status: "deleting", deleteAfter: sql`clock_timestamp() + interval '24 hours'` })
    .where(and(eq(storedFiles.id, id), eq(storedFiles.status, "pending"))).returning();
  return file;
}

export async function uploadFile({ db, store, token, purpose, contentType, read }: FileDependencies & {
  purpose: FilePurpose; contentType: string; read: () => Promise<Buffer>;
}) {
  const id = randomUUID();
  const objectKey = purpose === "avatar" ? `avatars/original/${id}` : id;
  await asOwner(db, token, async (tx, ownerId) => {
    const [usage] = await tx.select({
      count: sql<number>`count(*)::integer`, bytes: sql<number>`coalesce(sum(${storedFiles.byteSize}), 0)::integer`,
      pending: sql<number>`count(*) FILTER (WHERE ${storedFiles.status} = 'pending')::integer`,
    }).from(storedFiles).where(eq(storedFiles.ownerId, ownerId));
    if (usage.count >= 100 || usage.bytes + uploadPolicies[purpose].maxBytes > 250 * 1024 * 1024 || usage.pending >= 2) throw new FileError("quotaExceeded");
    await tx.insert(storedFiles).values({ id, ownerId, purpose, objectKey, storageLocation: store.location, byteSize: uploadPolicies[purpose].maxBytes });
  });
  try {
    const validated = await validateFile(purpose, await read(), contentType);
    const sha256 = createHash("sha256").update(validated.bytes).digest("hex");
    await store.put(objectKey, validated.bytes, validated.contentType);
    return await asOwner(db, token, async (tx, ownerId, previousAvatarId) => {
      const [file] = await tx.update(storedFiles).set({ status: "ready", contentType: validated.contentType, byteSize: validated.bytes.length, sha256 })
        .where(and(eq(storedFiles.id, id), eq(storedFiles.ownerId, ownerId), eq(storedFiles.status, "pending"), gt(storedFiles.expiresAt, sql`clock_timestamp()`))).returning();
      if (!file) throw new FileError("notFound");
      if (purpose === "avatar") {
        await tx.update(users).set({ avatarFileId: id }).where(eq(users.id, ownerId));
        if (previousAvatarId) await tx.update(storedFiles).set({ status: "deleting", deleteAfter: sql`clock_timestamp() + interval '24 hours'` })
          .where(and(eq(storedFiles.id, previousAvatarId), eq(storedFiles.ownerId, ownerId), eq(storedFiles.status, "ready")));
      }
      return publicFile(file);
    });
  } catch (error) {
    try { const file = await abandon(db, id); if (file) await store.remove(file.objectKey); } catch {}
    throw error;
  }
}

export async function downloadFile({ db, store, token, id }: FileDependencies & { id: string }) {
  if (!fileIdPattern.test(id)) throw new FileError("notFound");
  const file = await asOwner(db, token, async (tx, ownerId) => {
    const [row] = await tx.select().from(storedFiles).where(and(eq(storedFiles.id, id), eq(storedFiles.ownerId, ownerId), eq(storedFiles.status, "ready")));
    if (!row) throw new FileError("notFound");
    return row;
  });
  if (file.storageLocation !== store.location) throw new Error("File storage location is not configured");
  const bytes = await store.get(file.objectKey, file.byteSize);
  if (!bytes || bytes.length !== file.byteSize || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Stored file integrity failure");
  return { ...publicFile(file), bytes };
}

export async function deleteFile({ db, store, token, id }: FileDependencies & { id: string }) {
  if (!fileIdPattern.test(id)) throw new FileError("notFound");
  const file = await asOwner(db, token, async (tx, ownerId) => {
    const [row] = await tx.select().from(storedFiles).where(and(eq(storedFiles.id, id), eq(storedFiles.ownerId, ownerId))).for("update");
    if (!row) throw new FileError("notFound");
    if (row.storageLocation !== store.location) throw new Error("File storage location is not configured");
    if (row.status === "pending") throw new FileError("notFound");
    await tx.update(users).set({ avatarFileId: null }).where(and(eq(users.id, ownerId), eq(users.avatarFileId, id)));
    if (row.status !== "deleting") await tx.update(storedFiles).set({ status: "deleting", deleteAfter: sql`clock_timestamp() + interval '24 hours'` }).where(eq(storedFiles.id, id));
    return row;
  });
  await store.remove(file.objectKey);
}

export async function cleanupFiles({ db, store }: Pick<FileDependencies, "db" | "store">) {
  await db.update(storedFiles).set({ status: "deleting", deleteAfter: sql`clock_timestamp() + interval '24 hours'` })
    .where(and(eq(storedFiles.storageLocation, store.location), eq(storedFiles.status, "pending"), lte(storedFiles.expiresAt, sql`clock_timestamp()`)));
  let cursor: string | undefined;
  let processed = 0;
  let removed = 0;
  let failed = 0;
  while (true) {
    const files = await db.select().from(storedFiles).where(and(
      eq(storedFiles.storageLocation, store.location), eq(storedFiles.status, "deleting"),
      cursor ? gt(storedFiles.id, cursor) : undefined,
    )).orderBy(storedFiles.id).limit(100);
    if (!files.length) break;
    for (const file of files) {
      processed++;
      cursor = file.id;
      try {
        await store.remove(file.objectKey);
        await db.delete(storedFiles).where(and(eq(storedFiles.id, file.id), eq(storedFiles.status, "deleting"), lte(storedFiles.deleteAfter, sql`clock_timestamp()`)));
        removed++;
      } catch { failed++; }
    }
  }
  return { processed, removed, failed };
}

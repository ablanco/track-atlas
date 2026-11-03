import { legalDocuments } from "../../legal/documents";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { appendLegalAcceptance } from "../../legal/acceptance-store";
import { after, test } from "node:test";
import { createDatabase } from "../../db/client";
import { eraseAccount } from "../../auth/account-erasure";
import type { ObjectStore } from "../../storage/objects";

loadEnvConfig(process.cwd(), true);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Loopback development database required");
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
async function account() {
  const user = (
    await pool.query(
      `INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES ('Erasure','Test',$1,'synthetic','2000-01-01') RETURNING *`,
      [`erasure-${randomUUID()}@example.test`],
    )
  ).rows[0];
  await appendLegalAcceptance(db, user.id, {
    termsVersion: "2026-11-03",
    privacyVersion: legalDocuments.privacy.currentVersion,
    locale: "en",
  });
  return user;
}
const erase = (id: string, stores: ObjectStore[] = [], dryRun = false) =>
  eraseAccount({ db, userId: id, confirmation: id, stores, dryRun });
test("dry run reports scope without changing account, sessions or timestamps", async (t) => {
  const user = await account();
  t.after(() => pool.query("DELETE FROM users WHERE id=$1", [user.id]));
  const report = await erase(user.id, [], true);
  assert.equal(report.status, "dry-run");
  assert.equal(report.files, 0);
  assert.deepEqual(
    (await pool.query("SELECT * FROM users WHERE id=$1", [user.id])).rows[0],
    user,
  );
});
test("CLI rejects missing/wrong UUID confirmation before opening database", () => {
  const id = randomUUID();
  for (const args of [
    [],
    [id],
    [id, "--confirm", randomUUID()],
    [id, "--dry-run", "--confirm", id],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import=tsx",
        "scripts/erase-account.ts",
        ...args,
      ],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: "invalid" } },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stderr, /invalid/);
  }
});
test("erasure withdraws access, reserves email, survives failures and completes only after tombstones", async (t) => {
  const user = await account();
  const id = randomUUID();
  t.after(async () => {
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [user.id]);
    await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
  });
  await pool.query(
    `INSERT INTO stored_files(id,owner_id,purpose,storage_location,object_key,byte_size) VALUES($1::uuid,$2,'gpx','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$1::text,100)`,
    [id, user.id],
  );
  const pending = await erase(user.id);
  assert.equal(pending.status, "pending");
  assert.equal(pending.files, 1);
  const row = (await pool.query("SELECT * FROM users WHERE id=$1", [user.id]))
    .rows[0];
  assert.equal(row.active, false);
  await assert.rejects(
    pool.query("UPDATE users SET active=true WHERE id=$1", [user.id]),
  );
  await assert.rejects(
    pool.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
      user.id,
      "new-password",
    ]),
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES ('New','User',$1,'synthetic','2000-01-01')`,
      [user.email],
    ),
  );
  const broken: ObjectStore = {
    location:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    put: async () => {},
    get: async () => null,
    remove: async () => {
      throw Error("private provider error");
    },
  };
  assert.equal((await erase(user.id, [broken])).status, "failed");
  await pool.query(
    `UPDATE stored_files SET delete_after=now()-interval '1 second' WHERE owner_id=$1`,
    [user.id],
  );
  assert.equal((await erase(user.id, [broken])).status, "failed");
  const removed = new Set<string>();
  const store = {
    ...broken,
    remove: async (key: string) => {
      removed.add(key);
    },
  };
  const completions = await Promise.all([
    erase(user.id, [store]),
    erase(user.id, [store]),
  ]);
  assert.ok(completions.every((result) => result.status === "complete"));
  assert.ok(removed.has(id));
  assert.equal(
    (await pool.query("SELECT id FROM users WHERE id=$1", [user.id])).rowCount,
    0,
  );
  const replacement = await pool.query(
    `INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES ('New','User',$1,'synthetic','2000-01-01') RETURNING id`,
    [user.email],
  );
  await pool.query("DELETE FROM users WHERE id=$1", [replacement.rows[0].id]);
});
test("a delayed upload read cannot write after erasure and tombstone cleanup", async (t) => {
  const { uploadFile } = await import("../../storage/files");
  const { createSession } = await import("../../auth/session-store");
  const user = await account();
  t.after(async () => {
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [user.id]);
    await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
  });
  const token = (await createSession(db, user.id)).token;
  let release!: () => void;
  let entered!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const store: ObjectStore = {
    location: "b".repeat(64),
    put: async () => {
      writes++;
    },
    get: async () => null,
    remove: async () => {},
  };
  const upload = uploadFile({
    db,
    token,
    store,
    purpose: "gpx",
    contentType: "application/gpx+xml",
    read: async () => {
      entered();
      await gate;
      return Buffer.from(
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk/></gpx>',
      );
    },
  });
  const rejected = assert.rejects(upload);
  await reading;
  assert.equal((await erase(user.id, [store])).status, "pending");
  await pool.query(
    `UPDATE stored_files SET delete_after=now()-interval '1 second' WHERE owner_id=$1`,
    [user.id],
  );
  assert.equal((await erase(user.id, [store])).status, "complete");
  release();
  await rejected;
  assert.equal(writes, 0);
});
test("physical removal waits for in-flight writes; failed derivative removals keep every location resumable", async (t) => {
  const { uploadFile } = await import("../../storage/files");
  const { createSession } = await import("../../auth/session-store");
  const user = await account();
  t.after(async () => {
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [user.id]);
    await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
  });
  const token = (await createSession(db, user.id)).token;
  let release!: () => void, entered!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const objects = new Set<string>();
  const store: ObjectStore = {
    location: "c".repeat(64),
    put: async (key) => {
      entered();
      await gate;
      objects.add(key);
    },
    get: async () => null,
    remove: async (key) => {
      objects.delete(key);
    },
  };
  const upload = uploadFile({
    db,
    token,
    store,
    purpose: "gpx",
    contentType: "application/gpx+xml",
    read: async () =>
      Buffer.from(
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk/></gpx>',
      ),
  });
  const rejected = assert.rejects(upload);
  await writing;
  // Stage the irreversible barrier while the physical operation is still running.
  const erasing = erase(user.id, [store]);
  // Observe the committed access barrier without a timing sleep.
  for (let attempts = 0; attempts < 1000; attempts++) {
    if (
      !(await pool.query("SELECT active FROM users WHERE id=$1", [user.id]))
        .rows[0].active
    )
      break;
    if (attempts === 999) assert.fail("withdrawal did not commit");
  }
  assert.equal(objects.size, 0);
  release();
  assert.equal((await erasing).status, "pending");
  await rejected;
  assert.equal(objects.size, 0);
  const photoId = randomUUID();
  await pool.query(
    `INSERT INTO stored_files(id,owner_id,purpose,status,storage_location,object_key,byte_size,delete_after) VALUES($1::uuid,$2,'photo','deleting',$3,$1::text,100,now()+interval '24 hours')`,
    [photoId, user.id, "d".repeat(64)],
  );
  const removed = new Set<string>();
  const second = {
    ...store,
    location: "d".repeat(64),
    remove: async (key: string) => {
      removed.add(key);
      if (key.includes("/avif/")) throw Error("uncertain removal");
    },
  };
  assert.equal((await erase(user.id, [store, second])).status, "failed");
  assert.equal(removed.size, 7);
  await pool.query(
    `UPDATE stored_files SET delete_after=now()-interval '1 second' WHERE owner_id=$1`,
    [user.id],
  );
  assert.equal((await erase(user.id, [store])).status, "pending");
  assert.equal(
    (
      await erase(user.id, [
        store,
        {
          ...second,
          remove: async (key) => {
            removed.add(key);
          },
        },
      ])
    ).status,
    "complete",
  );
});
test("erasure removes all authored contributions and evidence, preserves surviving popularity and shared limits", async (t) => {
  const { createSession, findSessionUser } =
    await import("../../auth/session-store");
  const { createTrack, getTrack } = await import("../../tracks/service");
  const { getTrackVotes, setTrackVote } = await import("../../tracks/votes");
  const { listLegalAcceptances } = await import("../../legal/acceptance-store");
  const { issueAccountToken, inspectAccountToken } =
    await import("../../auth/account-token-store");
  const { getEmailRateKey, reserveEmailRequest, readEmailCooldown } =
    await import("../../auth/email-rate-limit");
  const user = await account(),
    other = await account();
  const ids = [user.id, other.id];
  t.after(async () => {
    await pool.query(
      "DELETE FROM track_comment_replies WHERE author_id=ANY($1::uuid[])",
      [ids],
    );
    await pool.query(
      "DELETE FROM track_comments WHERE author_id=ANY($1::uuid[])",
      [ids],
    );
    await pool.query("DELETE FROM tracks WHERE owner_id=ANY($1::uuid[])", [
      ids,
    ]);
    await pool.query(
      "DELETE FROM stored_files WHERE owner_id=ANY($1::uuid[])",
      [ids],
    );
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  });
  await pool.query(
    "UPDATE users SET email_confirmed=true WHERE id=ANY($1::uuid[])",
    [ids],
  );
  const token = (await createSession(db, user.id)).token,
    otherToken = (await createSession(db, other.id)).token;
  const store: ObjectStore = {
    location: "e".repeat(64),
    put: async () => {},
    get: async () => null,
    remove: async () => {},
  };
  const add = (token: string) =>
    createTrack({
      db,
      token,
      store,
      read: async () => ({
        requestId: randomUUID(),
        input: {
          name: "Erasure track",
          description: "Test",
          activity: "hiking",
          difficulty: 3,
          tags: [],
          visibility: "public",
        },
        bytes: Buffer.from(
          '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/></trkseg></trk></gpx>',
        ),
      }),
    });
  const owned = await add(token),
    surviving = await add(otherToken);
  await setTrackVote({ db, token, id: surviving.id, input: { vote: "up" } });
  await setTrackVote({
    db,
    token: otherToken,
    id: owned.id,
    input: { vote: "down" },
  });
  const [comment, ownedComment] = (
    await pool.query(
      `INSERT INTO track_comments(track_id,author_id,text) VALUES($1,$2,'Authored'),($3,$4,'Other person') RETURNING id`,
      [surviving.id, user.id, owned.id, other.id],
    )
  ).rows;
  await pool.query(
    `INSERT INTO track_comment_replies(comment_id,author_id,text) VALUES($1,$2,'Other owner reply'),($3,$4,'Authored reply')`,
    [comment.id, other.id, ownedComment.id, user.id],
  );
  const list = (
    await pool.query(
      `INSERT INTO track_lists(owner_id,name,normalized_name) VALUES($1,'Retained list','retained list') RETURNING id`,
      [other.id],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO track_list_memberships(list_id,track_id) VALUES($1,$2)",
    [list.id, owned.id],
  );
  const ownedList = (
    await pool.query(
      `INSERT INTO track_lists(owner_id,name,normalized_name) VALUES($1,'Erased list','erased list') RETURNING id`,
      [user.id],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO track_list_memberships(list_id,track_id) VALUES($1,$2)",
    [ownedList.id, surviving.id],
  );
  const link = await db.transaction((tx) =>
    issueAccountToken(
      tx,
      { id: user.id, email: user.email, firstName: user.first_name },
      "password-reset",
    ),
  );
  const key = await getEmailRateKey(db, user.email, "test-only-secret");
  await reserveEmailRequest(db, "password-reset", key);
  t.after(() =>
    pool.query("DELETE FROM email_send_limits WHERE key=$1", [
      `address:password-reset:${key}`,
    ]),
  );
  assert.equal((await erase(user.id, [store])).status, "pending");
  assert.equal(await findSessionUser(db, token), null);
  assert.equal(
    await inspectAccountToken(db, "password-reset", link.token),
    "invalid",
  );
  await assert.rejects(createSession(db, user.id));
  assert.equal(await getTrack({ db, token: otherToken, id: owned.id }), null);
  assert.equal(
    (await getTrackVotes({ db, token: otherToken, id: surviving.id }))
      ?.popularity,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM track_comments WHERE id=ANY($1::uuid[])",
        [[comment.id, ownedComment.id]],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM track_comment_replies WHERE comment_id=ANY($1::uuid[])",
        [[comment.id, ownedComment.id]],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM track_list_memberships WHERE list_id=$1",
        [list.id],
      )
    ).rowCount,
    0,
  );
  assert.equal((await listLegalAcceptances(db, user.id)).length, 1);
  await pool.query(
    `UPDATE stored_files SET delete_after=now()-interval '1 second' WHERE owner_id=$1`,
    [user.id],
  );
  assert.equal((await erase(user.id, [store])).status, "complete");
  assert.equal(
    (await pool.query("SELECT id FROM track_lists WHERE id=$1", [ownedList.id]))
      .rowCount,
    0,
  );
  assert.equal((await listLegalAcceptances(db, user.id)).length, 0);
  assert.ok((await readEmailCooldown(db, "password-reset", key)) > 0);
  assert.equal(
    (await pool.query("SELECT id FROM track_lists WHERE id=$1", [list.id]))
      .rowCount,
    1,
  );
});
test("staff cannot reactivate or edit a pending erasure through administration", async (t) => {
  const { createSession } = await import("../../auth/session-store");
  const { mutateAdminRecords } = await import("../../admin/mutations");
  const admin = await account(),
    user = await account();
  await pool.query("UPDATE users SET admin=true WHERE id=$1", [admin.id]);
  const fileId = randomUUID();
  await pool.query(
    `INSERT INTO stored_files(id,owner_id,purpose,storage_location,object_key,byte_size) VALUES($1::uuid,$2,'gpx',$3,$1::text,100)`,
    [fileId, user.id, "f".repeat(64)],
  );
  t.after(async () => {
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [user.id]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [admin.id, user.id],
    ]);
  });
  const token = (await createSession(db, admin.id)).token;
  await erase(user.id);
  for (const values of [{ active: true }, { first_name: "Changed" }]) {
    await assert.rejects(
      mutateAdminRecords(
        db,
        token,
        {
          model: "users",
          operation: "update",
          ids: [JSON.stringify([user.id])],
          values,
        },
        { send: async () => ({ ok: true, messageId: "mock" }) },
      ),
      { code: "forbidden" },
    );
  }
});
test("last active admin protection serializes concurrent erasures and privilege changes", async (t) => {
  const { createSession } = await import("../../auth/session-store");
  const { mutateAdminRecords } = await import("../../admin/mutations");
  const a = await account(),
    b = await account();
  t.after(() =>
    pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[a.id, b.id]]),
  );
  await pool.query("UPDATE users SET admin=true WHERE id=$1", [a.id]);
  const beforeRefusal = (
    await pool.query("SELECT * FROM users WHERE id=$1", [a.id])
  ).rows[0];
  await assert.rejects(erase(a.id), { code: "lastAdmin" });
  assert.deepEqual(
    (await pool.query("SELECT * FROM users WHERE id=$1", [a.id])).rows[0],
    beforeRefusal,
  );
  await pool.query("UPDATE users SET admin=true WHERE id=$1", [b.id]);
  const token = (await createSession(db, a.id)).token;
  const outcomes = await Promise.allSettled([
    erase(a.id),
    mutateAdminRecords(
      db,
      token,
      {
        model: "users",
        operation: "update",
        ids: [JSON.stringify([b.id])],
        values: { active: false },
      },
      { send: async () => ({ ok: true, messageId: "mock" }) },
    ),
  ]);
  assert.ok(outcomes.some((outcome) => outcome.status === "rejected"));
  assert.equal(
    (await pool.query("SELECT id FROM users WHERE active AND admin")).rowCount,
    1,
  );
  // Restore only a still-mutable account for the independent double-erasure race.
  const survivor = (
    await pool.query("SELECT id FROM users WHERE active AND admin")
  ).rows[0].id;
  const c = await account();
  t.after(() => pool.query("DELETE FROM users WHERE id=$1", [c.id]));
  await pool.query("UPDATE users SET admin=true WHERE id=$1", [c.id]);
  const simultaneous = await Promise.allSettled([erase(survivor), erase(c.id)]);
  assert.equal(
    simultaneous.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    simultaneous.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.equal(
    (await pool.query("SELECT id FROM users WHERE active AND admin")).rowCount,
    1,
  );
});
test("content rollback keeps access withdrawn and a later invocation resumes", async (t) => {
  const { createSession, findSessionUser } =
    await import("../../auth/session-store");
  const user = await account();
  const trackId = randomUUID();
  const suffix = user.id.replaceAll("-", "");
  const fn = `erasure_fail_${suffix}`;
  t.after(async () => {
    await pool.query(
      `DROP TRIGGER IF EXISTS ${fn} ON tracks; DROP FUNCTION IF EXISTS ${fn}()`,
    );
    await pool.query("DELETE FROM tracks WHERE owner_id=$1", [user.id]);
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [user.id]);
    await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
  });
  // Real publication creates complete track geometry and retry bookkeeping.
  const { createTrack } = await import("../../tracks/service");
  await pool.query("UPDATE users SET email_confirmed=true WHERE id=$1", [
    user.id,
  ]);
  const token = (await createSession(db, user.id)).token;
  const store: ObjectStore = {
    location: "9".repeat(64),
    put: async () => {},
    get: async () => null,
    remove: async () => {},
  };
  await createTrack({
    db,
    token,
    store,
    read: async () => ({
      requestId: trackId,
      input: {
        name: "Rollback",
        description: "Test",
        activity: "hiking",
        difficulty: 3,
        tags: [],
      },
      bytes: Buffer.from(
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/></trkseg></trk></gpx>',
      ),
    }),
  });
  await pool.query(
    `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.owner_id='${user.id}'::uuid THEN RAISE EXCEPTION 'synthetic deletion failure'; END IF; RETURN OLD; END $$; CREATE TRIGGER ${fn} BEFORE DELETE ON tracks FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
  );
  await assert.rejects(erase(user.id, [store]));
  assert.equal(await findSessionUser(db, token), null);
  assert.equal(
    (await pool.query("SELECT active FROM users WHERE id=$1", [user.id]))
      .rows[0].active,
    false,
  );
  assert.equal(
    (await pool.query("SELECT id FROM tracks WHERE owner_id=$1", [user.id]))
      .rowCount,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM deleted_track_uploads WHERE owner_id=$1",
        [user.id],
      )
    ).rowCount,
    0,
  );
  await pool.query(`DROP TRIGGER ${fn} ON tracks; DROP FUNCTION ${fn}()`);
  assert.equal((await erase(user.id, [store])).status, "pending");
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM deleted_track_uploads WHERE owner_id=$1",
        [user.id],
      )
    ).rowCount,
    1,
  );
  await pool.query(
    `UPDATE stored_files SET delete_after=now()-interval '1 second' WHERE owner_id=$1`,
    [user.id],
  );
  assert.equal((await erase(user.id, [store])).status, "complete");
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM deleted_track_uploads WHERE owner_id=$1",
        [user.id],
      )
    ).rowCount,
    0,
  );
});
test("old and current avatars and unattached photo originals and derivatives are physically removed", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { default: sharp } = await import("sharp");
  const { createObjectStore } = await import("../../storage/objects");
  const { getStorageConfig } = await import("../../storage/config");
  const { uploadFile } = await import("../../storage/files");
  const { createSession } = await import("../../auth/session-store");
  const user = await account();
  const directory = await mkdtemp(join(tmpdir(), "atlas-erasure-40-"));
  t.after(async () => {
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [user.id]);
    await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
    await rm(directory, { recursive: true, force: true });
  });
  const store = createObjectStore(
    getStorageConfig({
      NODE_ENV: "development",
      FILE_STORAGE_BACKEND: "local",
      FILE_STORAGE_LOCAL_DIR: directory,
    }),
  );
  const token = (await createSession(db, user.id)).token;
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const upload = (purpose: "avatar" | "photo") =>
    uploadFile({
      db,
      token,
      store,
      purpose,
      contentType: "image/png",
      read: async () => bytes,
    });
  const first = await upload("avatar"),
    second = await upload("avatar"),
    photo = await upload("photo");
  const keys = [
    ...[first, second].flatMap(({ id }) => [
      `avatars/original/${id}`,
      `avatars/128/${id}`,
      `avatars/24/${id}`,
    ]),
    photo.id,
    ...["large", "thumbnail"].flatMap((size) =>
      ["jpeg", "webp", "avif"].map(
        (format) => `photos/${size}/${format}/${photo.id}`,
      ),
    ),
  ];
  for (const key of keys) assert.ok(await store.get(key, 20 * 1024 * 1024));
  const report = await erase(user.id, [store]);
  assert.equal(report.status, "pending");
  assert.equal(report.files, 3);
  for (const key of keys)
    assert.equal(await store.get(key, 20 * 1024 * 1024), null);
  const deadline = (
    await pool.query(
      "SELECT min(delete_after) AS deadline FROM stored_files WHERE owner_id=$1",
      [user.id],
    )
  ).rows[0].deadline;
  assert.ok(deadline.getTime() > Date.now() + 23 * 3600000);
  await erase(user.id, [store]);
  assert.equal(
    (
      await pool.query(
        "SELECT min(delete_after) AS deadline FROM stored_files WHERE owner_id=$1",
        [user.id],
      )
    ).rows[0].deadline.getTime(),
    deadline.getTime(),
  );
  await pool.query(
    `UPDATE stored_files SET delete_after=now()-interval '1 second' WHERE owner_id=$1`,
    [user.id],
  );
  assert.equal((await erase(user.id, [store])).status, "complete");
});
test("pending erasure rejects recovery and profile changes without sending account email", async (t) => {
  const { requestPasswordReset } = await import("../../auth/account-email");
  const { createSession } = await import("../../auth/session-store");
  const { updateProfile } = await import("../../auth/settings");
  const user = await account(),
    id = randomUUID();
  const token = (await createSession(db, user.id)).token;
  t.after(async () => {
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [user.id]);
    await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
  });
  await pool.query(
    `INSERT INTO stored_files(id,owner_id,purpose,storage_location,object_key,byte_size) VALUES($1::uuid,$2,'gpx',$3,$1::text,100)`,
    [id, user.id, "7".repeat(64)],
  );
  await erase(user.id);
  let sends = 0;
  await requestPasswordReset(db, user.email, "en", async () => {
    sends++;
    return { ok: true, messageId: "mock" };
  });
  assert.equal(sends, 0);
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM account_action_tokens WHERE user_id=$1",
        [user.id],
      )
    ).rowCount,
    0,
  );
  assert.deepEqual(
    await updateProfile(db, token, {
      firstName: "Changed",
      lastName: "Test",
      displayName: null,
    }),
    { ok: false, reason: "unauthorized" },
  );
});
test("self-deactivation cannot race erasure to remove the last active administrator", async (t) => {
  const { createSession } = await import("../../auth/session-store");
  const { deactivateAccount } = await import("../../auth/settings");
  const a = await account(),
    b = await account();
  t.after(() =>
    pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[a.id, b.id]]),
  );
  await pool.query("UPDATE users SET admin=true WHERE id=$1", [a.id]);
  const token = (await createSession(db, a.id)).token;
  assert.deepEqual(await deactivateAccount(db, token), {
    ok: false,
    reason: "unavailable",
  });
  await pool.query("UPDATE users SET admin=true WHERE id=$1", [b.id]);
  await Promise.allSettled([erase(b.id), deactivateAccount(db, token)]);
  assert.equal(
    (await pool.query("SELECT id FROM users WHERE active AND admin")).rowCount,
    1,
  );
});
test("CLI infrastructure errors and absent accounts are safe and do not claim completion", () => {
  const id = randomUUID();
  const run = (env: NodeJS.ProcessEnv) =>
    spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import=tsx",
        "scripts/erase-account.ts",
        id,
        "--confirm",
        id,
      ],
      { encoding: "utf8", env, timeout: 15000 },
    );
  const missing = run(process.env);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(
    missing.stderr,
    "Account not found; no erasure was performed.\n",
  );
  const failed = run({
    ...process.env,
    DATABASE_URL: "postgresql://private:secret@127.0.0.1:1/unavailable",
  });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.equal(
    failed.stderr,
    "Account erasure failed. Cleanup may be pending; rerun after checking database and storage configuration.\n",
  );
});
test("erasure wins a real account-lock wait against legal renewal and blocks both identity layers", async (t) => {
  const { createSession, findSessionIdentity, findSessionUser } =
    await import("../../auth/session-store");
  const { renewLegalAcceptance } = await import("../../legal/renewal");
  const { listLegalAcceptances } = await import("../../legal/acceptance-store");
  const { legalDocuments } = await import("../../legal/documents");
  const user = await account(),
    fileId = randomUUID();
  await pool.query("DELETE FROM legal_acceptances WHERE user_id=$1", [user.id]);
  const token = (await createSession(db, user.id)).token;
  assert.ok(await findSessionIdentity(db, token));
  assert.equal(await findSessionUser(db, token), null);
  await pool.query(
    `INSERT INTO stored_files(id,owner_id,purpose,storage_location,object_key,byte_size) VALUES($1::uuid,$2,'gpx',$3,$1::text,100)`,
    [fileId, user.id, "6".repeat(64)],
  );
  const instance = (name: string) => {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("application_name", name);
    return createDatabase(url.href);
  };
  const erasureName = `erase40-${randomUUID()}`,
    renewalName = `renew40-${randomUUID()}`;
  const eraser = instance(erasureName),
    renewer = instance(renewalName);
  t.after(async () => {
    await eraser.pool.end();
    await renewer.pool.end();
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [user.id]);
    await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
  });
  const waitForLock = async (name: string) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (
        (
          await pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND wait_event_type='Lock'",
            [name],
          )
        ).rowCount
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("Expected a real account-lock wait");
  };
  const blocker = await pool.connect();
  let erasing: ReturnType<typeof eraseAccount> | undefined;
  let renewing: ReturnType<typeof renewLegalAcceptance> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      user.id,
    ]);
    erasing = eraseAccount({
      db: eraser.db,
      userId: user.id,
      confirmation: user.id,
      stores: [],
    });
    await waitForLock(erasureName);
    const form = new FormData();
    for (const [key, value] of Object.entries({
      termsAccepted: "on",
      privacyAcknowledged: "on",
      termsVersion: legalDocuments.terms.currentVersion,
      privacyVersion: legalDocuments.privacy.currentVersion,
    }))
      form.set(key, value);
    renewing = renewLegalAcceptance(renewer.db, token, "en", form);
    await waitForLock(renewalName);
    await blocker.query("COMMIT");
    assert.equal((await erasing).status, "pending");
    assert.equal(await renewing, "unauthorized");
    assert.equal(await findSessionIdentity(db, token), null);
    assert.equal(await findSessionUser(db, token), null);
    assert.equal((await listLegalAcceptances(db, user.id)).length, 0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled([erasing, renewing]);
  }
});

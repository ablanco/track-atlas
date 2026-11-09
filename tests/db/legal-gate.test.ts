import { legalDocuments } from "../../legal/documents";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../../db/client";
import { authTransaction, fixtureUser } from "./auth-helpers";
import { createSession, findSessionUser } from "../../auth/session-store";
import { getSettingsProfile, updateProfile } from "../../auth/settings";
import { appendLegalAcceptance } from "../../legal/acceptance-store";
loadEnvConfig(process.cwd(), true);
const { pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
test("an already active session cannot read or mutate settings until explicit current acceptance", async (t) => {
  const { client, db } = await authTransaction(t, pool);
  const id = await fixtureUser(client);
  const { token } = await createSession(db, id);
  assert.equal(await findSessionUser(db, token), null);
  assert.equal(await getSettingsProfile(db, token), null);
  assert.deepEqual(
    await updateProfile(db, token, {
      firstName: "Grace",
      lastName: "Hopper",
      displayName: null,
    }),
    { ok: false, reason: "unauthorized" },
  );
  await appendLegalAcceptance(db, id, {
    termsVersion: legalDocuments.terms.currentVersion,
    privacyVersion: legalDocuments.privacy.currentVersion,
    locale: "es",
  });
  assert.equal((await findSessionUser(db, token))?.userId, id);
  assert.ok(await getSettingsProfile(db, token));
});

test("renewal records presented evidence once and rejects stale, duplicate, expired and revoked requests", async (t) => {
  const { renewLegalAcceptance } = await import("../../legal/renewal");
  const { listLegalAcceptances } = await import("../../legal/acceptance-store");
  const { client, db } = await authTransaction(t, pool);
  const id = await fixtureUser(client);
  const { token } = await createSession(db, id);
  const form = () => {
    const value = new FormData();
    value.set("termsAccepted", "on");
    value.set("privacyAcknowledged", "on");
    value.set("termsVersion", legalDocuments.terms.currentVersion);
    value.set("privacyVersion", legalDocuments.privacy.currentVersion);
    return value;
  };
  const stale = form();
  stale.set("termsVersion", "old");
  assert.equal(await renewLegalAcceptance(db, token, "en", stale), "invalid");
  const duplicate = form();
  duplicate.append("termsAccepted", "on");
  assert.equal(
    await renewLegalAcceptance(db, token, "en", duplicate),
    "invalid",
  );
  const unchecked = form();
  unchecked.delete("privacyAcknowledged");
  assert.equal(
    await renewLegalAcceptance(db, token, "es", unchecked),
    "invalid",
  );
  assert.equal(await renewLegalAcceptance(db, token, "es", form()), "accepted");
  assert.equal(await renewLegalAcceptance(db, token, "es", form()), "accepted");
  const evidence = await listLegalAcceptances(db, id);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].locale, "es");
  assert.ok(evidence[0].acceptedAt instanceof Date);
  await client.query(
    "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [id],
  );
  assert.equal(
    await renewLegalAcceptance(db, token, "es", form()),
    "unauthorized",
  );
  await client.query("DELETE FROM sessions WHERE user_id=$1", [id]);
  assert.equal(
    await renewLegalAcceptance(db, token, "es", form()),
    "unauthorized",
  );
  assert.deepEqual(await listLegalAcceptances(db, id), evidence);
});

test("pending sessions cannot access lists, preferences, uploads or administration services", async (t) => {
  const { getTrackLists } = await import("../../tracks/lists");
  const { getDiscussionPreferences } =
    await import("../../tracks/discussion-preferences");
  const { requireTrackOwner } = await import("../../tracks/service");
  const { requireAdmin } = await import("../../admin/auth");
  const { client, db } = await authTransaction(t, pool);
  const id = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [id]);
  const { token } = await createSession(db, id);
  for (const call of [
    () => getTrackLists({ db, token }),
    () => getDiscussionPreferences({ db, token }),
    () => requireTrackOwner({ db, token }),
    () => requireAdmin(db, token),
  ]) {
    await assert.rejects(
      call,
      (error: unknown) => (error as { code: string }).code === "unauthorized",
    );
  }
});

test("a material revision immediately gates active sessions without changing historical evidence", async (t) => {
  const { legalDocuments } = await import("../../legal/documents");
  const { listLegalAcceptances } = await import("../../legal/acceptance-store");
  const { getExploreResults } = await import("../../tracks/explore");
  const { client, db } = await authTransaction(t, pool);
  const id = await fixtureUser(client);
  await appendLegalAcceptance(db, id, {
    termsVersion: legalDocuments.terms.currentVersion,
    privacyVersion: legalDocuments.privacy.currentVersion,
    locale: "en",
  });
  const { token } = await createSession(db, id);
  const before = await listLegalAcceptances(db, id);
  const terms = legalDocuments.terms as { requiredVersion: string };
  const previous = terms.requiredVersion;
  try {
    terms.requiredVersion = "future-material-generation";
    assert.equal(await findSessionUser(db, token), null);
    assert.equal(await getSettingsProfile(db, token), null);
    await assert.rejects(
      () => getExploreResults({ db, token, filters: {} as never }),
      (error: unknown) => (error as { code: string }).code === "unauthorized",
    );
    assert.deepEqual(await listLegalAcceptances(db, id), before);
  } finally {
    terms.requiredVersion = previous;
  }
});

test("typo corrections preserve access, material privacy changes require new evidence and preserve history", async (t) => {
  const { legalDocuments } = await import("../../legal/documents");
  const { renewLegalAcceptance } = await import("../../legal/renewal");
  const { listLegalAcceptances } = await import("../../legal/acceptance-store");
  const { client, db } = await authTransaction(t, pool);
  const id = await fixtureUser(client);
  await appendLegalAcceptance(db, id, {
    termsVersion: legalDocuments.terms.currentVersion,
    privacyVersion: legalDocuments.privacy.currentVersion,
    locale: "en",
  });
  const { token } = await createSession(db, id);
  const privacy = legalDocuments.privacy as {
    currentVersion: string;
    requiredVersion: string;
    revisions: Array<{
      version: string;
      requiredVersion: string;
      effectiveDate: string;
      messageKey: string;
    }>;
  };
  const original = { ...privacy, revisions: [...privacy.revisions] };
  try {
    privacy.currentVersion = "correction";
    privacy.revisions.push({
      version: "correction",
      requiredVersion: original.requiredVersion,
      effectiveDate: "2026-11-03",
      messageKey: "correction",
    });
    assert.ok(await findSessionUser(db, token));
    privacy.currentVersion = "material";
    privacy.requiredVersion = "material";
    privacy.revisions.push({
      version: "material",
      requiredVersion: "material",
      effectiveDate: "2026-11-03",
      messageKey: "material",
    });
    assert.equal(await findSessionUser(db, token), null);
    const form = new FormData();
    for (const [name, value] of Object.entries({
      termsAccepted: "on",
      privacyAcknowledged: "on",
      termsVersion: legalDocuments.terms.currentVersion,
      privacyVersion: "material",
    }))
      form.set(name, value);
    assert.equal(await renewLegalAcceptance(db, token, "es", form), "accepted");
    assert.ok(await findSessionUser(db, token));
    const evidence = await listLegalAcceptances(db, id);
    assert.equal(evidence.length, 2);
    assert.ok(
      evidence.some((item) => item.privacyVersion === original.currentVersion),
    );
    assert.ok(evidence.some((item) => item.privacyVersion === "material"));
  } finally {
    Object.assign(privacy, original);
  }
});

for (const change of ["revoked", "expired", "inactive", "material"] as const)
  test(`renewal rejects ${change} authorization after a real account lock wait`, async () => {
    const { db } = createDatabase(process.env.DATABASE_URL);
    const { renewLegalAcceptance } = await import("../../legal/renewal");
    const { legalDocuments } = await import("../../legal/documents");
    const client = await pool.connect();
    let id: string | undefined;
    const terms = legalDocuments.terms as { currentVersion: string };
    const original = terms.currentVersion;
    try {
      id = await fixtureUser(client);
      const { token } = await createSession(db, id);
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
      const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      const form = new FormData();
      for (const [key, value] of Object.entries({
        termsAccepted: "on",
        privacyAcknowledged: "on",
        termsVersion: legalDocuments.terms.currentVersion,
        privacyVersion: legalDocuments.privacy.currentVersion,
      }))
        form.set(key, value);
      const pending = renewLegalAcceptance(db, token, "en", form);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",
          [pid],
        );
        if (result.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(waiting, "renewal must actually wait for the locked account");
      if (change === "revoked")
        await client.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      if (change === "expired")
        await client.query(
          "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
          [id],
        );
      if (change === "inactive")
        await client.query("UPDATE users SET active=false WHERE id=$1", [id]);
      if (change === "material") terms.currentVersion = "new-presented-version";
      await client.query("COMMIT");
      assert.equal(
        await pending,
        change === "material" ? "invalid" : "unauthorized",
      );
      assert.equal(
        (
          await client.query(
            "SELECT id FROM legal_acceptances WHERE user_id=$1",
            [id],
          )
        ).rowCount,
        0,
      );
    } finally {
      terms.currentVersion = original;
      await client.query("ROLLBACK");
      if (id) await client.query("DELETE FROM users WHERE id=$1", [id]);
      client.release();
      await db.$client.end();
    }
  });

test("concurrent renewal submissions serialize and append a single current event", async () => {
  const instance = createDatabase(process.env.DATABASE_URL);
  const { renewLegalAcceptance } = await import("../../legal/renewal");
  const { listLegalAcceptances } = await import("../../legal/acceptance-store");
  const client = await pool.connect();
  let id: string | undefined;
  try {
    id = await fixtureUser(client);
    const { token } = await createSession(instance.db, id);
    const form = () => {
      const data = new FormData();
      for (const [key, value] of Object.entries({
        termsAccepted: "on",
        privacyAcknowledged: "on",
        termsVersion: legalDocuments.terms.currentVersion,
        privacyVersion: legalDocuments.privacy.currentVersion,
      }))
        data.set(key, value);
      return data;
    };
    assert.deepEqual(
      await Promise.all([
        renewLegalAcceptance(instance.db, token, "en", form()),
        renewLegalAcceptance(instance.db, token, "es", form()),
      ]),
      ["accepted", "accepted"],
    );
    assert.equal((await listLegalAcceptances(instance.db, id)).length, 1);
  } finally {
    if (id) await client.query("DELETE FROM users WHERE id=$1", [id]);
    client.release();
    await instance.pool.end();
  }
});

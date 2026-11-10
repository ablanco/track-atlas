import assert from "node:assert/strict";
import { test } from "node:test";
import { PhotoDrafts, type PhotoPlatform } from "../../tracks/photo-drafts";

function fixture() {
  const jobs: {
    progress: (value: number) => void;
    finish: (status: number, body: string) => void;
    aborted: boolean;
  }[] = [];
  let now = 0;
  let key = 0;
  const revoked: string[] = [];
  const platform: PhotoPlatform = {
    now: () => now,
    key: () => `key-${++key}`,
    preview: () => `blob:${++key}`,
    revoke: (url) => revoked.push(url),
    upload: (_file, progress, finish) => {
      const job = { progress, finish, aborted: false };
      jobs.push(job);
      return () => {
        job.aborted = true;
      };
    },
  };
  const draft = new PhotoDrafts([], platform);
  draft.resume();
  const add = (count = 1) =>
    draft.add(
      Array.from({ length: count }, () => new File(["photo"], "photo.png")),
    );
  return {
    draft,
    jobs,
    add,
    revoked,
    advance: () => {
      now += 15 * 60 * 1000;
      draft.expire();
    },
  };
}
const id = "11111111-1111-4111-8111-111111111111";
test("malformed successful uploads block submission and can retry without reselection", () => {
  const { draft, jobs, add } = fixture();
  add();
  jobs[0].finish(201, JSON.stringify({ id: 42 }));
  assert.equal(draft.getSnapshot().rows[0].status, "failed");
  assert.equal(draft.submission(), null);
  draft.retry(draft.getSnapshot().rows[0].key);
  jobs[1].finish(201, JSON.stringify({ id }));
  assert.deepEqual(draft.submission(), [{ id, caption: "" }]);
});
test("two slots admit queued photos deterministically without late removed completions", () => {
  const { draft, jobs, add } = fixture();
  add(4);
  const keys = draft.getSnapshot().rows.map((p) => p.key);
  assert.deepEqual(
    draft.getSnapshot().rows.map((p) => p.status),
    ["uploading", "uploading", "queued", "queued"],
  );
  draft.remove(keys[0]);
  assert.equal(jobs[0].aborted, true);
  assert.deepEqual(
    draft.getSnapshot().rows.map((p) => p.status),
    ["uploading", "uploading", "queued"],
  );
  jobs[0].finish(201, JSON.stringify({ id }));
  jobs[0].progress(77);
  assert.equal(jobs.length, 3);
  jobs[1].finish(500, "");
  assert.deepEqual(
    draft.getSnapshot().rows.map((p) => p.status),
    ["failed", "uploading", "uploading"],
  );
  draft.retry(keys[1]);
  assert.equal(jobs.length, 4);
  jobs[2].finish(201, JSON.stringify({ id }));
  assert.equal(jobs.length, 5);
  jobs[1].finish(201, JSON.stringify({ id }));
  assert.equal(draft.getSnapshot().rows[0].status, "uploading");
});
test("expiry and retry preserve stable row identity, captions and frozen submissions", () => {
  const { draft, jobs, add, advance } = fixture();
  add(2);
  const [first, second] = draft.getSnapshot().rows;
  draft.caption(first.key, "Ridge");
  draft.move(first.key, 1);
  jobs[0].finish(201, JSON.stringify({ id }));
  const other = "22222222-2222-4222-8222-222222222222";
  jobs[1].finish(201, JSON.stringify({ id: other }));
  const frozen = draft.submission();
  assert.deepEqual(frozen, [
    { id: other, caption: "" },
    { id, caption: "Ridge" },
  ]);
  advance();
  assert.equal(draft.submission(), null);
  draft.retry(first.key);
  jobs[0].finish(201, JSON.stringify({ id: other }));
  jobs[2].finish(201, JSON.stringify({ id: other }));
  assert.deepEqual(
    draft.getSnapshot().rows.map((p) => p.key),
    [second.key, first.key],
  );
  assert.deepEqual(frozen, [
    { id: other, caption: "" },
    { id, caption: "Ridge" },
  ]);
});
test("Activity releases resources and restores previews while interrupted requests require retry", () => {
  const { draft, jobs, add, revoked } = fixture();
  add(3);
  const before = draft.getSnapshot().rows;
  draft.suspend();
  assert.equal(
    jobs.every((j) => j.aborted),
    true,
  );
  assert.deepEqual(
    revoked,
    before.map((p) => p.preview),
  );
  jobs[0].finish(201, JSON.stringify({ id }));
  draft.resume();
  assert.deepEqual(
    draft.getSnapshot().rows.map((p) => p.status),
    ["failed", "failed", "uploading"],
  );
  assert.ok(
    draft
      .getSnapshot()
      .rows.every((p, i) => p.preview && p.preview !== before[i].preview),
  );
  draft.retry(before[0].key);
  jobs[0].finish(201, JSON.stringify({ id }));
  assert.equal(draft.getSnapshot().rows[0].status, "uploading");
  draft.reset();
  assert.equal(draft.getSnapshot().ready, true);
  assert.equal(draft.getSnapshot().dirty, false);
  jobs[3].finish(201, JSON.stringify({ id }));
  assert.deepEqual(draft.submission(), []);
});
test("submission checks the lease clock even before the expiry timer runs", () => {
  let now = 0;
  const draft = new PhotoDrafts([], {
    now: () => now,
    key: () => "local",
    preview: () => "blob:local",
    revoke: () => {},
    upload: (_file, _progress, finish) => {
      finish(201, JSON.stringify({ id }));
      return () => {};
    },
  });
  draft.resume();
  draft.add([new File(["photo"], "photo.png")]);
  assert.deepEqual(draft.submission(), [{ id, caption: "" }]);
  now = 14 * 60 * 1000;
  assert.equal(draft.submission(), null);
  assert.equal(draft.getSnapshot().rows[0].expired, true);
});
test("saved photos have no staging lease and removing all additions restores a clean draft", () => {
  const { draft, add, advance } = fixture();
  draft.reset([{ id, caption: "Saved" }]);
  add();
  assert.equal(draft.getSnapshot().dirty, true);
  const key = draft.getSnapshot().rows[1].key;
  draft.remove(key);
  advance();
  assert.equal(draft.getSnapshot().dirty, false);
  assert.deepEqual(draft.submission(), [{ id, caption: "Saved" }]);
  draft.caption(id, "Changed");
  assert.equal(draft.getSnapshot().dirty, true);
});
test("queued admission follows current gallery order while the two running uploads keep their slots", () => {
  const { draft, jobs, add } = fixture();
  add(4);
  const keys = draft.getSnapshot().rows.map((p) => p.key);
  draft.move(keys[3], 0);
  assert.deepEqual(
    draft.getSnapshot().rows.map((p) => p.status),
    ["queued", "uploading", "uploading", "queued"],
  );
  jobs[0].finish(500, "");
  jobs[2].progress(35);
  assert.deepEqual(
    draft.getSnapshot().rows.map((p) => [p.key, p.status, p.progress]),
    [
      [keys[3], "uploading", 35],
      [keys[0], "failed", 0],
      [keys[1], "uploading", 0],
      [keys[2], "queued", 0],
    ],
  );
  jobs[1].finish(500, "");
  assert.deepEqual(
    draft.getSnapshot().rows.map((p) => p.status),
    ["uploading", "failed", "failed", "uploading"],
  );
});

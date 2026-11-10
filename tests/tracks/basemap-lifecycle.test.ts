import { test } from "node:test";
import assert from "node:assert/strict";
import { BasemapLifecycle } from "../../tracks/basemap-lifecycle";

test("initial load deadline is fatal in details but preserves explorer browsing", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const details = new BasemapLifecycle("details", "outdoor", "en");
  const explorer = new BasemapLifecycle("explorer", "outdoor", "en");
  details.start();
  explorer.start();
  t.mock.timers.tick(24_999);
  assert.equal(details.getSnapshot().fatal, false);
  assert.equal(explorer.getSnapshot().failure, null);
  t.mock.timers.tick(1);
  assert.equal(details.getSnapshot().fatal, true);
  assert.equal(explorer.getSnapshot().fatal, false);
  assert.equal(explorer.getSnapshot().failure, explorer.getSnapshot().attempt);
  details.stop();
  explorer.stop();
});

test("optional switch deadline gives one failed attempt and another selection recovers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const lifecycle = new BasemapLifecycle("details", "street", "en");
  lifecycle.start();
  lifecycle.event("load", lifecycle.getSnapshot().attempt);
  lifecycle.select("topographic", "en");
  const attempt = lifecycle.getSnapshot().attempt;
  assert.equal(lifecycle.getSnapshot().switching, true);
  assert.equal(typeof lifecycle.getSnapshot().style, "object");
  t.mock.timers.tick(25_000);
  assert.equal(lifecycle.getSnapshot().fatal, false);
  assert.equal(lifecycle.getSnapshot().switching, false);
  assert.equal(lifecycle.getSnapshot().failure, attempt);
  lifecycle.select("street", "en");
  assert.equal(lifecycle.getSnapshot().failure, null);
  lifecycle.event("idle", lifecycle.getSnapshot().attempt);
  t.mock.timers.tick(25_000);
  assert.equal(lifecycle.getSnapshot().fatal, false);
  assert.equal(lifecycle.getSnapshot().switching, false);
  lifecycle.stop();
});

test("removed sources and obsolete attempts cannot fail or complete a new selection", () => {
  const lifecycle = new BasemapLifecycle("details", "outdoor", "en");
  lifecycle.start();
  const oldAttempt = lifecycle.getSnapshot().attempt;
  lifecycle.event("load", oldAttempt);
  lifecycle.select("dark", "es");
  const attempt = lifecycle.getSnapshot().attempt;
  lifecycle.event("error", attempt, "outdoor");
  lifecycle.event("error", oldAttempt, "dark");
  lifecycle.event("idle", oldAttempt);
  assert.equal(lifecycle.getSnapshot().failure, null);
  assert.equal(lifecycle.getSnapshot().switching, true);
  lifecycle.event("error", attempt, "dark");
  assert.equal(lifecycle.getSnapshot().failure, attempt);
  assert.equal(lifecycle.getSnapshot().switching, false);
  lifecycle.stop();
});

test("repeated tile errors notify once per attempt, including after switching away and back", () => {
  const lifecycle = new BasemapLifecycle("explorer", "topographic", "en");
  const failures: number[] = [];
  const unsubscribe = lifecycle.subscribe(() => {
    const failure = lifecycle.getSnapshot().failure;
    if (failure !== null) failures.push(failure);
  });
  lifecycle.start();
  lifecycle.event("load", lifecycle.getSnapshot().attempt);
  lifecycle.event("error", lifecycle.getSnapshot().attempt, "topographic");
  lifecycle.event("error", lifecycle.getSnapshot().attempt, "topographic");
  lifecycle.select("street", "en");
  lifecycle.select("topographic", "en");
  lifecycle.event("error", lifecycle.getSnapshot().attempt, "topographic");
  assert.deepEqual(failures, [0, 2]);
  unsubscribe();
  lifecycle.stop();
});

for (const policy of ["details", "explorer"] as const) {
  test(`${policy}: Street errors and switch deadlines retain the declared failure policy`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    for (const error of [true, false]) {
      const lifecycle = new BasemapLifecycle(policy, "outdoor", "en");
      lifecycle.start();
      lifecycle.event("load", lifecycle.getSnapshot().attempt);
      lifecycle.select("street", "en");
      if (error)
        lifecycle.event(
          "error",
          lifecycle.getSnapshot().attempt,
          "openmaptiles",
        );
      else t.mock.timers.tick(25_000);
      assert.equal(lifecycle.getSnapshot().fatal, policy === "details");
      assert.equal(
        lifecycle.getSnapshot().failure !== null,
        policy === "explorer",
      );
      lifecycle.stop();
    }
  });
}

test("Activity teardown cancels deadlines and fences events before a fresh map load", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const lifecycle = new BasemapLifecycle("details", "outdoor", "en");
  lifecycle.start();
  const hiddenAttempt = lifecycle.getSnapshot().attempt;
  lifecycle.event("load", hiddenAttempt);
  lifecycle.stop();
  lifecycle.event("error", hiddenAttempt, "outdoor");
  t.mock.timers.tick(25_000);
  assert.equal(lifecycle.getSnapshot().failure, null);
  lifecycle.start();
  assert.equal(lifecycle.getSnapshot().loaded, false);
  lifecycle.event("load", hiddenAttempt);
  t.mock.timers.tick(25_000);
  assert.equal(lifecycle.getSnapshot().fatal, true);
  lifecycle.stop();
});

test("locale changes translate vector styles while unchanged selections keep their attempt", () => {
  const lifecycle = new BasemapLifecycle("explorer", "outdoor", "en");
  lifecycle.start();
  lifecycle.event("load", lifecycle.getSnapshot().attempt);
  const english = lifecycle.getSnapshot().style;
  lifecycle.select("outdoor", "es");
  assert.notDeepEqual(lifecycle.getSnapshot().style, english);
  assert.equal(lifecycle.getSnapshot().switching, true);
  lifecycle.select("street", "es");
  lifecycle.event("idle", lifecycle.getSnapshot().attempt);
  const street = lifecycle.getSnapshot();
  lifecycle.select("street", "fr");
  assert.equal(lifecycle.getSnapshot(), street);
  lifecycle.stop();
});

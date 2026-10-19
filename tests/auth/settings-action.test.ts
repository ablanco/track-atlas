import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleProfileUpdate,
  handlePasswordUpdate,
  handleDeactivation,
  type ProfileDependencies,
  type PasswordDependencies,
  type DeactivateDependencies,
} from "../../auth/settings-action";

const token = "A".repeat(43);
function profile() {
  const f = new FormData();
  f.set("firstName", " Ada ");
  f.set("lastName", " Lovelace ");
  return f;
}
function password() {
  const f = new FormData();
  f.set("password", " secret ");
  f.set("passwordConfirmation", " secret ");
  return f;
}
function dependencies() {
  const calls: string[] = [];
  const redirect = new Error("redirect signal");
  const common = {
    token: async () => token,
    refresh: () => {
      calls.push("refresh");
    },
  };
  const profile: ProfileDependencies = {
    ...common,
    update: async (t, input) => {
      assert.equal(t, token);
      assert.deepEqual(input, {
        firstName: "Ada",
        lastName: "Lovelace",
        displayName: null,
      });
      calls.push("update");
      return { ok: true };
    },
  };
  const password: PasswordDependencies = {
    ...common,
    update: async (t, input) => {
      assert.equal(t, token);
      assert.deepEqual(input, { password: " secret " });
      calls.push("update");
      return { ok: true };
    },
  };
  const deactivate: DeactivateDependencies = {
    token: common.token,
    deactivate: async (t) => {
      assert.equal(t, token);
      calls.push("deactivate");
      return { ok: true };
    },
    clearSession: async () => {
      calls.push("clear");
    },
    redirectHome: (locale) => {
      assert.equal(locale, "es");
      calls.push("redirect");
      throw redirect;
    },
  };
  return { calls, redirect, profile, password, deactivate };
}
test("profile mutation precedes refresh and returns only normalized safe values", async () => {
  const d = dependencies();
  assert.deepEqual(await handleProfileUpdate("en", profile(), d.profile), {
    values: { firstName: "Ada", lastName: "Lovelace", displayName: "" },
    fieldErrors: {},
    success: true,
  });
  assert.deepEqual(d.calls, ["update", "refresh"]);
});
test("password mutation precedes refresh and returns no secrets", async () => {
  const d = dependencies();
  assert.deepEqual(await handlePasswordUpdate("es", password(), d.password), {
    fieldErrors: {},
    success: true,
  });
  assert.deepEqual(d.calls, ["update", "refresh"]);
});
test("unsupported locale rejects before effects", async () => {
  const d = dependencies();
  assert.equal(
    (await handleProfileUpdate("fr", profile(), d.profile)).formError,
    "unavailable",
  );
  assert.equal(
    (await handlePasswordUpdate("fr", password(), d.password)).formError,
    "unavailable",
  );
  assert.deepEqual(await handleDeactivation("fr", d.deactivate), {
    formError: "unavailable",
  });
  assert.deepEqual(d.calls, []);
});
test("invalid form returns bounded errors without mutation or secrets", async () => {
  const d = dependencies();
  const p = profile();
  p.set("firstName", "a".repeat(500));
  const result = await handleProfileUpdate("en", p, d.profile);
  assert.deepEqual(result.fieldErrors, { firstName: "tooLong" });
  assert.equal(result.values.firstName.length, 200);
  const f = password();
  f.set("passwordConfirmation", "wrong");
  assert.deepEqual(await handlePasswordUpdate("en", f, d.password), {
    fieldErrors: { passwordConfirmation: "mismatch" },
  });
  assert.deepEqual(d.calls, []);
});
for (const malformed of [undefined, "bad"])
  test(`missing/malformed session ${malformed} rejects before mutation`, async () => {
    const d = dependencies();
    const token = async () => malformed;
    assert.equal(
      (await handleProfileUpdate("en", profile(), { ...d.profile, token }))
        .formError,
      "unauthorized",
    );
    assert.equal(
      (await handlePasswordUpdate("en", password(), { ...d.password, token }))
        .formError,
      "unauthorized",
    );
    assert.deepEqual(
      await handleDeactivation("es", { ...d.deactivate, token }),
      { formError: "unauthorized" },
    );
    assert.deepEqual(d.calls, []);
  });
for (const reason of ["unauthorized", "unavailable"] as const)
  test(`${reason} service result never refreshes, clears cookie or claims success`, async () => {
    const d = dependencies();
    const fail = async () => ({ ok: false as const, reason });
    const p = await handleProfileUpdate("en", profile(), {
      ...d.profile,
      update: fail,
    });
    const w = await handlePasswordUpdate("en", password(), {
      ...d.password,
      update: fail,
    });
    assert.equal(p.formError, reason);
    assert.equal(w.formError, reason);
    assert.ok(!p.success && !w.success);
    assert.deepEqual(
      await handleDeactivation("es", { ...d.deactivate, deactivate: fail }),
      { formError: reason },
    );
    assert.deepEqual(d.calls, []);
  });
test("private exceptions are sanitized without exposing password or token", async () => {
  const d = dependencies();
  const fail = async (): Promise<never> => {
    throw Error(`secret SQL ${token}`);
  };
  const results = [
    await handleProfileUpdate("en", profile(), { ...d.profile, update: fail }),
    await handlePasswordUpdate("en", password(), {
      ...d.password,
      update: fail,
    }),
    await handleDeactivation("es", { ...d.deactivate, deactivate: fail }),
  ];
  for (const state of results) assert.equal(state.formError, "unavailable");
  for (const secret of ["SQL", token, " secret "])
    assert.ok(!JSON.stringify(results).includes(secret));
  assert.deepEqual(d.calls, []);
});
test("cookie-read failures return unavailable without any mutation", async () => {
  const d = dependencies();
  const token = async (): Promise<never> => {
    throw Error("cookie details");
  };
  assert.equal(
    (await handleProfileUpdate("en", profile(), { ...d.profile, token }))
      .formError,
    "unavailable",
  );
  assert.equal(
    (await handlePasswordUpdate("en", password(), { ...d.password, token }))
      .formError,
    "unavailable",
  );
  assert.deepEqual(await handleDeactivation("es", { ...d.deactivate, token }), {
    formError: "unavailable",
  });
  assert.deepEqual(d.calls, []);
});
test("deactivation commits before cookie clearing and redirect is never swallowed", async () => {
  const d = dependencies();
  await assert.rejects(
    handleDeactivation("es", d.deactivate),
    (error) => error === d.redirect,
  );
  assert.deepEqual(d.calls, ["deactivate", "clear", "redirect"]);
});
test("cookie clearing failure after commit reports completed deactivation, not rollback", async () => {
  const d = dependencies();
  assert.deepEqual(
    await handleDeactivation("es", {
      ...d.deactivate,
      clearSession: async () => {
        throw Error("private cookie error");
      },
    }),
    { deactivated: true },
  );
  assert.deepEqual(d.calls, ["deactivate"]);
});

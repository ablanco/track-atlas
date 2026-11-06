import assert from "node:assert/strict";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { users, sessions } from "../../db/schema";
import { signupFixture } from "./auth-helpers";
import { createAcceptedSession } from "../helpers/accepted-session";
import { handleSignup } from "../../auth/signup-action";
import { registerUser } from "../../auth/signup";
import { handlePasswordUpdate } from "../../auth/settings-action";
import { updatePassword } from "../../auth/settings";
import { handleResetLink } from "../../auth/account-email-action";
import { resetAccountPassword } from "../../auth/password-recovery";
import {
  issueAccountToken,
  inspectAccountToken,
} from "../../auth/account-token-store";
import { verifyPassword } from "../../auth/password";

loadEnvConfig(process.cwd(), true);
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
const forbidden = (): never => {
  throw Error("unexpected effect");
};
const strong = " violet otter brass lantern ";
function passwordForm(password: string, token?: string) {
  const form = new FormData();
  form.set("password", password);
  form.set("passwordConfirmation", password);
  if (token) form.set("token", token);
  return form;
}

test("signup action rejects weak passwords without creating a database account", async () => {
  const input = signupFixture();
  const form = passwordForm("P@ssw0rd!");
  for (const [key, value] of Object.entries(input))
    if (typeof value === "string" && key !== "password") form.set(key, value);
  form.set("termsAccepted", "on");
  form.set("privacyAcknowledged", "on");
  form.set("termsVersion", input.legalAcceptance.termsVersion);
  form.set("privacyVersion", input.legalAcceptance.privacyVersion);
  try {
    const result = await handleSignup("en", form, {
      currentUser: async () => null,
      verifyCaptcha: forbidden,
      register: (parsed) => registerUser(db, parsed, input.email),
      sendConfirmation: forbidden,
      setSession: forbidden,
      redirectHome: forbidden,
    });
    assert.deepEqual(result.fieldErrors, { password: "weak" });
    assert.deepEqual(
      await db.select().from(users).where(eq(users.email, input.email)),
      [],
    );
  } finally {
    await db.delete(users).where(eq(users.email, input.email));
  }
});

test("weak changes preserve hashes, sessions and reset links; corrected reset is single-use", async () => {
  const [user] = await db
    .insert(users)
    .values({ ...signupFixture(), passwordHash: "original" })
    .returning();
  try {
    const session = await createAcceptedSession(db, user.id);
    const reset = await db.transaction((tx) =>
      issueAccountToken(tx, user, "password-reset"),
    );
    const weak = passwordForm("P@ssw0rd!", reset.token);
    assert.deepEqual(
      await handlePasswordUpdate("en", weak, {
        token: async () => session.token,
        update: (token, input) => updatePassword(db, token, input),
        refresh: forbidden,
      }),
      { fieldErrors: { password: "weak" } },
    );
    const dependencies = {
      reset: (token: string, input: { password: string }) =>
        resetAccountPassword(db, token, input),
      clearSession: async () => {},
      refresh: () => {},
    };
    assert.deepEqual(await handleResetLink("en", weak, dependencies), {
      fieldErrors: { password: "weak" },
    });
    const [unchanged] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    assert.equal(unchanged.passwordHash, "original");
    assert.equal(
      (await db.select().from(sessions).where(eq(sessions.userId, user.id)))
        .length,
      1,
    );
    assert.equal(
      await inspectAccountToken(db, "password-reset", reset.token),
      "valid",
    );
    assert.deepEqual(
      await handleResetLink(
        "en",
        passwordForm(strong, reset.token),
        dependencies,
      ),
      {
        fieldErrors: {},
        completed: true,
      },
    );
    const [changed] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    assert.equal(await verifyPassword(strong, changed.passwordHash), true);
    assert.equal(
      await verifyPassword(strong.trim(), changed.passwordHash),
      false,
    );
    assert.deepEqual(
      await db.select().from(sessions).where(eq(sessions.userId, user.id)),
      [],
    );
    assert.deepEqual(
      await handleResetLink(
        "en",
        passwordForm(strong, reset.token),
        dependencies,
      ),
      {
        fieldErrors: {},
        formError: "invalid",
      },
    );
  } finally {
    await db.delete(users).where(eq(users.id, user.id));
  }
});

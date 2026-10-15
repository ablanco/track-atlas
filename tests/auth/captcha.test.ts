import assert from "node:assert/strict";
import { test } from "node:test";
import { getCaptchaSecret } from "../../auth/captcha";

test("CAPTCHA requires a configured signing secret without a public fallback", () => {
  const previous = process.env.ALTCHA_HMAC_SECRET;
  try {
    for (const value of [undefined, "", "short", " ".repeat(64)]) {
      if (value === undefined) delete process.env.ALTCHA_HMAC_SECRET;
      else process.env.ALTCHA_HMAC_SECRET = value;
      assert.throws(getCaptchaSecret, /ALTCHA_HMAC_SECRET/);
    }
    process.env.ALTCHA_HMAC_SECRET = "configured-secret-".repeat(4);
    assert.equal(getCaptchaSecret(), "configured-secret-".repeat(4));
  } finally {
    if (previous === undefined) delete process.env.ALTCHA_HMAC_SECRET;
    else process.env.ALTCHA_HMAC_SECRET = previous;
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBirthday, parseBirthday } from "../../auth/birthday-format";

for (const [locale, display] of [
  ["en", "12/10/1815"],
  ["es", "10/12/1815"],
  ["fr", "10/12/1815"],
  ["pt", "10/12/1815"],
  ["de", "10/12/1815"],
  ["it", "10/12/1815"],
]) {
  test(`${locale} birthday display and submission preserve date-only values`, () => {
    assert.equal(formatBirthday("1815-12-10", locale), display);
    assert.equal(parseBirthday(display, locale), "1815-12-10");
    assert.equal(
      parseBirthday(formatBirthday("0001-01-02", locale), locale),
      "0001-01-02",
    );
    assert.equal(
      parseBirthday(formatBirthday("2000-02-29", locale), locale),
      "2000-02-29",
    );
    assert.equal(formatBirthday("", locale), "");
    assert.equal(parseBirthday("", locale), "");
    assert.equal(parseBirthday("invalid", locale), "invalid");
  });
}

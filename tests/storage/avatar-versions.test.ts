import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { createAvatarVersions } from "../../storage/avatar-versions";

test("avatar versions are exact WebP squares with transparency but no embedded metadata", async () => {
  const original = await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  })
    .png()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const versions = await createAvatarVersions(original);
  assert.deepEqual(
    versions.map((version) => version.size),
    [128, 24],
  );
  for (const version of versions) {
    const metadata = await sharp(version.bytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, version.size);
    assert.equal(metadata.height, version.size);
    assert.equal(metadata.hasAlpha, true);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.ok(version.bytes.length < 65536);
  }
});

test("avatar processing rotates before center cropping rather than stretching or keeping edge content", async () => {
  // A wide image with blue edges and a square center split red/green.
  // A 90-degree clockwise EXIF rotation turns that center into red over green.
  const original = await sharp({
    create: { width: 300, height: 100, channels: 3, background: "blue" },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 50, height: 100, channels: 3, background: "red" },
        })
          .png()
          .toBuffer(),
        left: 100,
        top: 0,
      },
      {
        input: await sharp({
          create: { width: 50, height: 100, channels: 3, background: "lime" },
        })
          .png()
          .toBuffer(),
        left: 150,
        top: 0,
      },
    ])
    .png()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  for (const { size, bytes } of await createAvatarVersions(original)) {
    const { data, info } = await sharp(bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const top =
      (Math.floor(size / 4) * size + Math.floor(size / 2)) * info.channels;
    const bottom =
      (Math.floor((size * 3) / 4) * size + Math.floor(size / 2)) *
      info.channels;
    assert.ok(
      data[top] > 220 && data[top + 1] < 30 && data[top + 2] < 30,
      "top center must be red",
    );
    assert.ok(
      data[bottom] < 30 && data[bottom + 1] > 220 && data[bottom + 2] < 30,
      "bottom center must be green",
    );
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { createPhotoVersions } from "../../storage/photo-versions";

test("photo displays produce six oriented, uncropped, metadata-free opaque versions without enlargement", async () => {
  const original = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  })
    .png()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const versions = await createPhotoVersions(original);
  assert.equal(versions.length, 6);
  assert.deepEqual(
    versions.map((v) => `${v.size}/${v.format}`),
    [
      "large/jpeg",
      "large/webp",
      "large/avif",
      "thumbnail/jpeg",
      "thumbnail/webp",
      "thumbnail/avif",
    ],
  );
  for (const version of versions) {
    const metadata = await sharp(version.bytes).metadata();
    assert.equal(metadata.width, 80);
    assert.equal(metadata.height, 120);
    assert.equal(metadata.hasAlpha, false);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
  }
});

test("portrait displays fit the 1080 height boundary and thumbnails fit 480", async () => {
  const original = await sharp({
    create: { width: 1200, height: 2400, channels: 3, background: "blue" },
  })
    .jpeg()
    .toBuffer();
  for (const version of await createPhotoVersions(original)) {
    const metadata = await sharp(version.bytes).metadata();
    assert.equal(metadata.width, version.size === "large" ? 540 : 240);
    assert.equal(metadata.height, version.size === "large" ? 1080 : 480);
  }
});

import { animatedPng } from "./animated-png";
import { validateFile } from "../../storage/validation";
test("photo validation accepts JPEG but rejects SVG and animation", async () => {
  const jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .jpeg()
    .toBuffer();
  assert.equal(
    (await validateFile("photo", jpeg, "image/jpeg")).contentType,
    "image/jpeg",
  );
  await assert.rejects(
    validateFile("photo", Buffer.from("<svg/>"), "image/svg+xml"),
  );
  await assert.rejects(validateFile("photo", animatedPng(), "image/png"));
  await assert.rejects(
    validateFile("photo", Buffer.alloc(20 * 1024 * 1024 + 1), "image/jpeg"),
  );
});

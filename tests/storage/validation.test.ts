import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import {
  FileError,
  isAvatarMediaType,
  parsePurpose,
  uploadPolicies,
  validateFile,
} from "../../storage/validation";
import { getUploadOrigin, readUploadBody } from "../../storage/http";
import { animatedPng } from "./animated-png";

const gpx = Buffer.from(
  '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="42" lon="-3"/></trkseg></trk></gpx>',
);
const code = (expected: string) => (error: unknown) =>
  error instanceof FileError && error.code === expected;

test("purpose and trusted origin reject unknown or malformed configuration", () => {
  assert.equal(parsePurpose("gpx"), "gpx");
  assert.equal(parsePurpose("avatar"), "avatar");
  for (const purpose of [null, "other", "GPX", "../avatar"])
    assert.throws(() => parsePurpose(purpose), code("invalidRequest"));
  assert.equal(
    getUploadOrigin({ NODE_ENV: "development" }),
    "http://localhost:3000",
  );
  assert.equal(
    getUploadOrigin({
      NODE_ENV: "production",
      APP_ORIGIN: "https://atlas.example",
    }),
    "https://atlas.example",
  );
  for (const origin of [
    undefined,
    "http://atlas.example",
    "https://atlas.example/path",
    "https://user:pass@atlas.example",
    "https://atlas.example?query",
    "https://atlas.example#fragment",
  ]) {
    assert.throws(() =>
      getUploadOrigin({ NODE_ENV: "production", APP_ORIGIN: origin }),
    );
  }
});

test("GPX accepts UTF-8 documents with matching version and namespace, preserving bytes", async () => {
  const result = await validateFile("gpx", gpx, "application/gpx+xml");
  assert.deepEqual(result, { bytes: gpx, contentType: "application/gpx+xml" });
  const v1 = Buffer.from(
    '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/0" version="1.0" creator="tests"/>',
  );
  assert.deepEqual((await validateFile("gpx", v1, "text/xml")).bytes, v1);
});

for (const xml of [
  "<html/>",
  '<gpx version="1.1"/>',
  '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.0"/>',
  gpx.toString() + "<second/>",
  gpx.toString().slice(0, -3),
  '<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">&x;</gpx>',
  '<?xml-stylesheet href="https://example.test/remote"?>' + gpx,
  gpx
    .toString()
    .replace("<trk>", "<a>".repeat(65) + "</a>".repeat(65) + "<trk>"),
  '<?xml version="1.0" encoding="UTF-16"?>' + gpx,
])
  test(`rejects unsafe or malformed XML ${xml.slice(0, 45)}`, async () => {
    await assert.rejects(
      validateFile("gpx", Buffer.from(xml), "application/xml"),
      code("invalidFile"),
    );
  });

test("GPX rejects invalid UTF-8, unsupported MIME, empty and oversized content", async () => {
  await assert.rejects(
    validateFile("gpx", Buffer.from([0xff, 0xfe]), "application/xml"),
    code("invalidFile"),
  );
  await assert.rejects(
    validateFile("gpx", gpx, "text/html"),
    code("invalidFile"),
  );
  await assert.rejects(
    validateFile("gpx", Buffer.alloc(0), "application/gpx+xml"),
    code("invalidFile"),
  );
  await assert.rejects(
    validateFile(
      "gpx",
      Buffer.alloc(uploadPolicies.gpx.maxBytes + 1),
      "application/gpx+xml",
    ),
    code("tooLarge"),
  );
});

for (const format of ["png", "jpeg", "webp"] as const)
  test(`avatar verifies ${format} without changing original bytes or metadata`, async () => {
    const input = await sharp({
      create: { width: 1400, height: 700, channels: 3, background: "red" },
    })
      .toFormat(format)
      .withMetadata()
      .toBuffer();
    const result = await validateFile("avatar", input, `image/${format}`);
    const metadata = await sharp(result.bytes).metadata();
    assert.deepEqual(result.bytes, input);
    assert.equal(result.contentType, `image/${format}`);
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 1400);
    assert.equal(metadata.height, 700);
    assert.ok(metadata.exif);
    await assert.rejects(
      validateFile(
        "avatar",
        input.subarray(0, Math.floor(input.length / 2)),
        `image/${format}`,
      ),
      code("invalidFile"),
    );
    assert.equal(
      (await validateFile("avatar", input, "text/html")).contentType,
      `image/${format}`,
    );
  });

for (const { format, mime } of [
  { format: "gif", mime: "image/gif" },
  { format: "avif", mime: "image/avif" },
  { format: "tiff", mime: "image/tiff" },
] as const) {
  test(`avatar accepts original ${format} and detects its type independently of browser metadata`, async () => {
    const bytes = await sharp({
      create: { width: 32, height: 16, channels: 3, background: "green" },
    })
      .toFormat(format)
      .toBuffer();
    for (const declared of ["", "application/octet-stream", "image/jpeg"]) {
      const result = await validateFile("avatar", bytes, declared);
      assert.equal(result.contentType, mime);
      assert.deepEqual(result.bytes, bytes);
    }
    assert.equal(isAvatarMediaType(mime), true);
  });
}

test("avatar media types reject active, non-image and unknown content types", () => {
  for (const type of [
    "image/svg+xml",
    "text/html",
    "application/pdf",
    "image/unknown-format",
    "image/png\r\nX-Test: bad",
  ])
    assert.equal(isAvatarMediaType(type), false);
});

test("avatar rejects animated PNG while preserving accepted static originals", async () => {
  const bytes = animatedPng();
  assert.equal((await sharp(bytes).metadata()).format, "png");
  await sharp(bytes).stats();
  await assert.rejects(
    validateFile("avatar", bytes, "image/png"),
    code("invalidFile"),
  );
});

test("avatar rejects SVG, disguised files and excessive pixel counts", async () => {
  for (const bytes of [
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    gpx,
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  ]) {
    await assert.rejects(
      validateFile("avatar", bytes, "image/png"),
      code("invalidFile"),
    );
  }
  const bomb = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    validateFile("avatar", bomb, "image/png"),
    code("invalidFile"),
  );
});

test("body reader bounds actual chunked bytes and cancels oversized input", async () => {
  let cancelled = false;
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    duplex: "half",
    body: new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    }),
  };
  await assert.rejects(
    readUploadBody(new Request("http://localhost", init), 5),
    code("tooLarge"),
  );
  assert.equal(cancelled, true);
});

test("body reader rejects lying/malformed lengths, disconnects and early oversized headers", async () => {
  for (const length of ["-1", "Infinity", "1.5", "9007199254740992", "5"]) {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-length": length },
      body: "abc",
    });
    await assert.rejects(readUploadBody(request, 10), code("invalidRequest"));
  }
  await assert.rejects(
    readUploadBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-length": "20" },
        body: "abc",
      }),
      10,
    ),
    code("tooLarge"),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readUploadBody(
      new Request("http://localhost", {
        method: "POST",
        body: "abc",
        signal: controller.signal,
      }),
      10,
    ),
    code("invalidRequest"),
  );
  assert.deepEqual(
    await readUploadBody(
      new Request("http://localhost", { method: "POST", body: "abc" }),
      3,
    ),
    Buffer.from("abc"),
  );
});

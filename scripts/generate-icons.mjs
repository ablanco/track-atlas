import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

// Use the simplified favicon artwork unchanged for Next.js icon metadata.
const svg = await readFile(new URL("../app/favicon2.svg", import.meta.url));
await writeFile(new URL("../app/icon.svg", import.meta.url), svg);

// ICO supports PNG frames; include the common browser and desktop sizes.
const sizes = [16, 32, 48];
const frames = await Promise.all(
  sizes.map((size) =>
    sharp(Buffer.from(svg)).resize(size, size).png().toBuffer(),
  ),
);
const directory = Buffer.alloc(6 + 16 * frames.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
for (const [index, frame] of frames.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index];
  directory[entry + 1] = sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
}
await writeFile(
  new URL("../app/favicon.ico", import.meta.url),
  Buffer.concat([directory, ...frames]),
);

// iOS supplies its own corner mask; give the touch icon an opaque background.
await sharp(Buffer.from(svg))
  .resize(160, 160)
  .extend({ top: 10, bottom: 10, left: 10, right: 10, background: "#ffffff" })
  .flatten({ background: "#ffffff" })
  .png()
  .toFile(new URL("../app/apple-icon.png", import.meta.url).pathname);

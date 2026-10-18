import "server-only";
import sharp from "sharp";
import { SaxesParser } from "saxes";

export const uploadPolicies = {
  avatar: { maxBytes: 5 * 1024 * 1024 },
  gpx: { maxBytes: 10 * 1024 * 1024 },
} as const;
export type FilePurpose = keyof typeof uploadPolicies;
export type FileErrorCode = "unauthorized" | "notFound" | "invalidRequest" | "invalidFile" | "tooLarge" | "quotaExceeded" | "forbidden";
export class FileError extends Error {
  constructor(readonly code: FileErrorCode) { super(code); }
}

export function parsePurpose(value: string | null): FilePurpose {
  if (value !== "avatar" && value !== "gpx") throw new FileError("invalidRequest");
  return value;
}

export async function validateFile(purpose: FilePurpose, bytes: Buffer, contentType: string) {
  if (bytes.length > uploadPolicies[purpose].maxBytes) throw new FileError("tooLarge");
  if (!bytes.length) throw new FileError("invalidFile");
  if (purpose === "avatar") {
    try {
      const image = sharp(bytes, { limitInputPixels: 16_777_216, failOn: "warning", animated: true });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
          contentType !== `image/${metadata.format}` || (metadata.pages ?? 1) !== 1) throw new FileError("invalidFile");
      if (metadata.format === "png") {
        for (let offset = 8; offset < bytes.length;) {
          if (offset + 12 > bytes.length) throw new FileError("invalidFile");
          const length = bytes.readUInt32BE(offset);
          if (offset + 12 + length > bytes.length || bytes.toString("ascii", offset + 4, offset + 8) === "acTL") throw new FileError("invalidFile");
          offset += 12 + length;
        }
      }
      await image.stats();
      return { bytes, contentType: `image/${metadata.format}` };
    } catch (error) {
      if (error instanceof FileError) throw error;
      throw new FileError("invalidFile");
    }
  }
  if (!["application/gpx+xml", "application/xml", "text/xml"].includes(contentType)) throw new FileError("invalidFile");
  try {
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0;
    let elements = 0;
    let root = false;
    parser.on("xmldecl", (declaration) => {
      if (declaration.encoding && declaration.encoding.toLowerCase() !== "utf-8") throw new FileError("invalidFile");
    });
    parser.on("doctype", () => { throw new FileError("invalidFile"); });
    parser.on("processinginstruction", () => { throw new FileError("invalidFile"); });
    parser.on("opentag", (tag) => {
      if (++depth > 64 || ++elements > 500_000) throw new FileError("invalidFile");
      if (depth !== 1) return;
      const version = tag.attributes.version?.value;
      if (root || tag.local !== "gpx" || !["1.0", "1.1"].includes(version ?? "") ||
          tag.uri !== `http://www.topografix.com/GPX/${version?.replace(".", "/")}`) throw new FileError("invalidFile");
      root = true;
    });
    parser.on("closetag", () => { depth--; });
    parser.on("error", () => { throw new FileError("invalidFile"); });
    parser.write(xml).close();
    if (!root || depth !== 0) throw new FileError("invalidFile");
    return { bytes, contentType: "application/gpx+xml" };
  } catch {
    throw new FileError("invalidFile");
  }
}

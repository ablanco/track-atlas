import "server-only";
import sharp from "sharp";

export const photoSizes = ["large", "thumbnail"] as const;
export const photoFormats = ["jpeg", "webp", "avif"] as const;
export type PhotoSize = (typeof photoSizes)[number];
export type PhotoFormat = (typeof photoFormats)[number];
export const maxPhotoVersionBytes = 4 * 1024 * 1024;
export const photoReservationBytes =
  20 * 1024 * 1024 + 6 * maxPhotoVersionBytes;
export function photoVersionKey(
  id: string,
  size: PhotoSize,
  format: PhotoFormat,
) {
  return `photos/${size}/${format}/${id}`;
}
export async function createPhotoVersions(original: Buffer) {
  const versions = [];
  for (const size of photoSizes)
    for (const format of photoFormats) {
      const bytes = await sharp(original, {
        limitInputPixels: 16_777_216,
        failOn: "warning",
      })
        .timeout({ seconds: 10 })
        .autoOrient()
        .resize(size === "large" ? 1920 : 480, size === "large" ? 1080 : 480, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .toFormat(format, {
          quality: format === "jpeg" ? 82 : format === "webp" ? 80 : 50,
        })
        .toBuffer();
      if (bytes.length > maxPhotoVersionBytes)
        throw new Error("Photo version exceeds storage limit");
      versions.push({ size, format, bytes });
    }
  return versions;
}

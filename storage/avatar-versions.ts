import "server-only";
import sharp from "sharp";

export const avatarSizes = [128, 24] as const;
export type AvatarSize = (typeof avatarSizes)[number];
export const maxAvatarVersionBytes = 64 * 1024;
export const avatarReservationBytes =
  5 * 1024 * 1024 + 2 * maxAvatarVersionBytes;

// Called only after the upload's format, frame count and full decode are validated.
export async function createAvatarVersions(original: Buffer) {
  const versions = [];
  for (const size of avatarSizes) {
    const bytes = await sharp(original, {
      limitInputPixels: 16_777_216,
      failOn: "warning",
    })
      .timeout({ seconds: 10 })
      .autoOrient()
      .resize(size, size, { fit: "cover", position: "centre" })
      .webp({ quality: 80 })
      .toBuffer();
    if (bytes.length > maxAvatarVersionBytes)
      throw new Error("Avatar version exceeds storage limit");
    versions.push({ size, bytes });
  }
  return versions;
}

export function avatarVersionKey(id: string, size: AvatarSize) {
  return `avatars/${size}/${id}`;
}

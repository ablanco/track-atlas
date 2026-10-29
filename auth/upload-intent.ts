/** Only this fixed, internal destination is supported; never redirect to input URLs. */
export const UPLOAD_INTENT_COOKIE = "track_atlas_upload_intent";
export function hasUploadIntent(value: unknown): boolean {
  return value === "upload";
}

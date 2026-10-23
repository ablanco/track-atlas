export const activityTypes = [
  "walking",
  "hiking",
  "road_running",
  "trail_running",
  "cycling",
  "mountain_biking",
  "ski_touring",
  "cross_country_skiing",
  "snowshoeing",
  "paddling",
  "horse_riding",
  "four_by_four",
  "road_motorcycling",
  "off_road_motorcycling",
  "atv_quad",
  "other",
] as const;
export type ActivityType = (typeof activityTypes)[number];
export type TrackInput = {
  name: string;
  description: string;
  activity: ActivityType;
  difficulty: number;
  tags: string[];
  visibility: "private" | "public";
};
export type TrackField = keyof TrackInput | "file";
export type TrackFieldErrors = Partial<
  Record<TrackField, "required" | "invalid" | "tooLong">
>;
export type TrackErrorCode =
  | "unauthorized"
  | "emailUnconfirmed"
  | "invalidRequest"
  | "invalidMetadata"
  | "invalidFile"
  | "unsupportedStructure"
  | "tooLarge"
  | "tooManyPoints"
  | "notFound"
  | "quotaExceeded"
  | "forbidden"
  | "conflict"
  | "processing"
  | "processingTimeout"
  | "unavailable";
export class TrackError extends Error {
  constructor(
    readonly code: TrackErrorCode,
    readonly fieldErrors?: TrackFieldErrors,
  ) {
    super(code);
  }
}
export const trackIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function tagKey(tag: string) {
  return tag.normalize("NFKC").toLowerCase();
}
export function validateTrackEditInput(value: unknown): TrackInput {
  const fields = [
    "name",
    "description",
    "activity",
    "difficulty",
    "tags",
    "visibility",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new TrackError("invalidRequest");
  return validateTrackInput(value);
}
export function validateTrackInput(value: unknown): TrackInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TrackError("invalidMetadata");
  const input = value as Record<string, unknown>;
  const fieldErrors: TrackFieldErrors = {};
  function text(field: "name" | "description", max: number) {
    const value = typeof input[field] === "string" ? input[field].trim() : "";
    if (!value) fieldErrors[field] = "required";
    else if (Array.from(value).length > max) fieldErrors[field] = "tooLong";
    else if (value.includes("\0")) fieldErrors[field] = "invalid";
    return value;
  }
  const name = text("name", 200),
    description = text("description", 5000);
  const visibility =
    input.visibility === undefined ? "private" : input.visibility;
  if (visibility !== "private" && visibility !== "public")
    fieldErrors.visibility = "invalid";
  const activity = input.activity;
  if (
    typeof activity !== "string" ||
    !activityTypes.includes(activity as ActivityType)
  )
    fieldErrors.activity = activity ? "invalid" : "required";
  const difficulty = input.difficulty;
  if (
    typeof difficulty !== "number" ||
    !Number.isInteger(difficulty) ||
    difficulty < 1 ||
    difficulty > 5
  )
    fieldErrors.difficulty = difficulty ? "invalid" : "required";
  const tags: string[] = [],
    seen = new Set<string>();
  if (!Array.isArray(input.tags)) fieldErrors.tags = "invalid";
  else if (input.tags.length > 10) fieldErrors.tags = "tooLong";
  else
    for (const value of input.tags) {
      if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
        fieldErrors.tags = "invalid";
        continue;
      }
      const tag = value.trim(),
        key = tagKey(tag);
      if (Array.from(tag).length > 30 || Array.from(key).length > 120) {
        fieldErrors.tags = "tooLong";
        continue;
      }
      if (!seen.has(key)) {
        tags.push(tag);
        seen.add(key);
      }
    }
  if (Object.keys(fieldErrors).length)
    throw new TrackError("invalidMetadata", fieldErrors);
  return {
    name,
    description,
    activity: activity as ActivityType,
    difficulty: difficulty as number,
    tags,
    visibility: visibility as TrackInput["visibility"],
  };
}

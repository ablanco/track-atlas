import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  customType,
  doublePrecision,
  jsonb,
  primaryKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./columns";
import { activityTypes, type ActivityType } from "../tracks/validation";

type TrackGeometry = { type: "LineString"; coordinates: [number, number][] };
const lineString = customType<{ data: TrackGeometry; driverData: string }>({
  dataType: () => "geometry(LineString,4326)",
  toDriver: (value) =>
    `SRID=4326;LINESTRING(${value.coordinates.map(([lon, lat]) => `${lon} ${lat}`).join(",")})`,
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    displayName: text("display_name"),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    avatarUrl: text("avatar_url"),
    avatarFileId: uuid("avatar_file_id").references(
      (): AnyPgColumn => storedFiles.id,
      { onDelete: "set null" },
    ),
    active: boolean("active").notNull().default(true),
    admin: boolean("admin").notNull().default(false),
    emailConfirmed: boolean("email_confirmed").notNull().default(false),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
    check("users_first_name_nonblank", sql`btrim(${table.firstName}) <> ''`),
    check("users_last_name_nonblank", sql`btrim(${table.lastName}) <> ''`),
    check("users_email_nonblank", sql`btrim(${table.email}) <> ''`),
    check("users_email_trimmed", sql`${table.email} = btrim(${table.email})`),
    check(
      "users_password_hash_nonblank",
      sql`btrim(${table.passwordHash}) <> ''`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_index").on(table.userId),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export const captchaUses = pgTable(
  "captcha_uses",
  {
    challengeHash: text("challenge_hash").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...auditColumns(),
  },
  (table) => [index("captcha_uses_expires_at_index").on(table.expiresAt)],
);

export const accountActionTokens = pgTable(
  "account_action_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose")
      .$type<"email-confirmation" | "password-reset">()
      .notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("account_action_tokens_hash_unique").on(table.tokenHash),
    index("account_action_tokens_user_purpose_index").on(
      table.userId,
      table.purpose,
    ),
    index("account_action_tokens_expiry_index").on(table.expiresAt),
    check(
      "account_action_tokens_purpose_check",
      sql`${table.purpose} IN ('email-confirmation','password-reset')`,
    ),
  ],
);

export const storedFiles = pgTable(
  "stored_files",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    purpose: text("purpose").$type<"avatar" | "gpx">().notNull(),
    status: text("status")
      .$type<"pending" | "ready" | "deleting">()
      .notNull()
      .default("pending"),
    storageLocation: text("storage_location").notNull(),
    objectKey: text("object_key").notNull(),
    byteSize: integer("byte_size").notNull(),
    contentType: text("content_type"),
    sha256: text("sha256"),
    avatar128Bytes: integer("avatar_128_bytes"),
    avatar128Sha256: text("avatar_128_sha256"),
    avatar24Bytes: integer("avatar_24_bytes"),
    avatar24Sha256: text("avatar_24_sha256"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '15 minutes'`),
    deleteAfter: timestamp("delete_after", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    index("stored_files_owner_index").on(table.ownerId),
    index("stored_files_cleanup_index").on(
      table.storageLocation,
      table.status,
      table.expiresAt,
    ),
    check(
      "stored_files_avatar_versions_check",
      sql`(
    ${table.avatar128Bytes} IS NULL AND ${table.avatar128Sha256} IS NULL AND ${table.avatar24Bytes} IS NULL AND ${table.avatar24Sha256} IS NULL
  ) OR (
    ${table.purpose} = 'avatar' AND
    ${table.avatar128Bytes} IS NOT NULL AND ${table.avatar128Bytes} BETWEEN 1 AND 65536 AND
    ${table.avatar24Bytes} IS NOT NULL AND ${table.avatar24Bytes} BETWEEN 1 AND 65536 AND
    ${table.avatar128Sha256} IS NOT NULL AND ${table.avatar128Sha256} ~ '^[a-f0-9]{64}$' AND
    ${table.avatar24Sha256} IS NOT NULL AND ${table.avatar24Sha256} ~ '^[a-f0-9]{64}$'
  )`,
    ),
    check(
      "stored_files_purpose_check",
      sql`${table.purpose} IN ('avatar', 'gpx')`,
    ),
    check(
      "stored_files_status_check",
      sql`${table.status} IN ('pending', 'ready', 'deleting')`,
    ),
    check(
      "stored_files_size_check",
      sql`${table.byteSize} > 0 AND ${table.byteSize} <= 10485760`,
    ),
    check(
      "stored_files_object_key_check",
      sql`${table.objectKey} = ${table.id}::text OR (${table.purpose} = 'avatar' AND ${table.objectKey} = 'avatars/original/' || ${table.id}::text)`,
    ),
    check(
      "stored_files_location_check",
      sql`${table.storageLocation} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "stored_files_ready_check",
      sql`${table.status} <> 'ready' OR (${table.contentType} IS NOT NULL AND ${table.sha256} IS NOT NULL AND ${table.sha256} ~ '^[a-f0-9]{64}$' AND ((${table.purpose} = 'avatar' AND ${table.contentType} ~ '^image/[a-z0-9][a-z0-9.+-]*$' AND ${table.contentType} <> 'image/svg+xml') OR (${table.purpose} = 'gpx' AND ${table.contentType} = 'application/gpx+xml')))`,
    ),
    check(
      "stored_files_deleting_check",
      sql`(${table.status} = 'deleting') = (${table.deleteAfter} IS NOT NULL)`,
    ),
  ],
);

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    originalFileId: uuid("original_file_id")
      .notNull()
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    requestId: uuid("request_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    activity: text("activity").$type<ActivityType>().notNull(),
    difficulty: integer("difficulty").notNull(),
    visibility: text("visibility")
      .$type<"private" | "public">()
      .notNull()
      .default("private"),
    pointCount: integer("point_count").notNull(),
    distanceMeters: doublePrecision("distance_meters").notNull(),
    durationSeconds: doublePrecision("duration_seconds"),
    ascentMeters: doublePrecision("ascent_meters"),
    descentMeters: doublePrecision("descent_meters"),
    minElevationMeters: doublePrecision("min_elevation_meters"),
    maxElevationMeters: doublePrecision("max_elevation_meters"),
    elevationSampleCount: integer("elevation_sample_count").notNull(),
    version: integer("version").notNull(),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("tracks_original_unique").on(table.originalFileId),
    uniqueIndex("tracks_request_unique").on(table.ownerId, table.requestId),
    index("tracks_owner_created_index").on(table.ownerId, table.createdAt),
    check(
      "tracks_text_check",
      sql`char_length(${table.name}) BETWEEN 1 AND 200 AND btrim(${table.name}) <> '' AND char_length(${table.description}) BETWEEN 1 AND 5000 AND btrim(${table.description}) <> ''`,
    ),
    check(
      "tracks_activity_check",
      sql`${table.activity} IN (${sql.join(
        activityTypes.map((value) => sql.raw(`'${value}'`)),
        sql`, `,
      )})`,
    ),
    check(
      "tracks_classification_check",
      sql`${table.difficulty} BETWEEN 1 AND 5 AND ${table.visibility} IN ('private', 'public') AND ${table.version} = 1`,
    ),
    check(
      "tracks_elevation_coverage_check",
      sql`((${table.elevationSampleCount} = 0) = (${table.minElevationMeters} IS NULL AND ${table.maxElevationMeters} IS NULL)) AND (${table.elevationSampleCount} = 0 OR (${table.minElevationMeters} IS NOT NULL AND ${table.maxElevationMeters} IS NOT NULL AND ${table.minElevationMeters} <= ${table.maxElevationMeters})) AND ((${table.elevationSampleCount} = ${table.pointCount}) = (${table.ascentMeters} IS NOT NULL AND ${table.descentMeters} IS NOT NULL)) AND ((${table.ascentMeters} IS NULL) = (${table.descentMeters} IS NULL))`,
    ),
    check(
      "tracks_metrics_check",
      sql`${table.pointCount} BETWEEN 2 AND 100000 AND ${table.distanceMeters} > 0 AND ${table.distanceMeters} < 'Infinity'::float8 AND ${table.elevationSampleCount} BETWEEN 0 AND ${table.pointCount} AND (${table.durationSeconds} IS NULL OR (${table.durationSeconds} > 0 AND ${table.durationSeconds} < 'Infinity'::float8)) AND (${table.ascentMeters} IS NULL OR (${table.ascentMeters} >= 0 AND ${table.ascentMeters} < 'Infinity'::float8)) AND (${table.descentMeters} IS NULL OR (${table.descentMeters} >= 0 AND ${table.descentMeters} < 'Infinity'::float8)) AND (${table.minElevationMeters} IS NULL OR (${table.minElevationMeters} > '-Infinity'::float8 AND ${table.minElevationMeters} < 'Infinity'::float8)) AND (${table.maxElevationMeters} IS NULL OR (${table.maxElevationMeters} > '-Infinity'::float8 AND ${table.maxElevationMeters} < 'Infinity'::float8))`,
    ),
  ],
);

export const trackData = pgTable(
  "track_data",
  {
    trackId: uuid("track_id")
      .primaryKey()
      .references(() => tracks.id, { onDelete: "cascade" }),
    geometry: lineString("geometry").notNull(),
    samples: jsonb("samples")
      .$type<
        {
          distanceMeters: number;
          elevationMeters: number | null;
          speedMps: number | null;
        }[]
      >()
      .notNull(),
    ...auditColumns(),
  },
  (table) => [
    index("track_data_geometry_index").using("gist", table.geometry),
    check(
      "track_data_coordinates_check",
      sql`ST_XMin(${table.geometry}::box3d) >= -180 AND ST_XMax(${table.geometry}::box3d) <= 180 AND ST_YMin(${table.geometry}::box3d) >= -90 AND ST_YMax(${table.geometry}::box3d) <= 90`,
    ),
    check(
      "track_data_samples_check",
      sql`jsonb_typeof(${table.samples}) = 'array' AND jsonb_array_length(${table.samples}) = ST_NPoints(${table.geometry}) AND ST_NPoints(${table.geometry}) BETWEEN 2 AND 100000 AND NOT ST_IsEmpty(${table.geometry})`,
    ),
  ],
);

export const trackTags = pgTable(
  "track_tags",
  {
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    label: text("label").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    ...auditColumns(),
  },
  (table) => [
    primaryKey({ columns: [table.trackId, table.ordinal] }),
    uniqueIndex("track_tags_key_unique").on(table.trackId, table.normalizedKey),
    index("track_tags_key_index").on(table.normalizedKey),
    check(
      "track_tags_values_check",
      sql`${table.ordinal} BETWEEN 0 AND 9 AND char_length(${table.label}) BETWEEN 1 AND 30 AND btrim(${table.label}) <> '' AND char_length(${table.normalizedKey}) BETWEEN 1 AND 120`,
    ),
  ],
);

export const trackRepresentations = pgTable(
  "track_directional_representations",
  {
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    intermediateCount: integer("intermediate_count").notNull(),
    geometry: lineString("geometry").notNull(),
    directionlessEdges: jsonb("directionless_edges")
      .$type<boolean[]>()
      .notNull(),
    version: integer("version").notNull(),
    ...auditColumns(),
  },
  (table) => [
    primaryKey({ columns: [table.trackId, table.intermediateCount] }),
    index("track_representations_geometry_index").using("gist", table.geometry),
    check(
      "track_representations_values_check",
      sql`${table.intermediateCount} IN (0,1,3,4,5) AND ${table.version} = 1 AND ST_NPoints(${table.geometry}) = ${table.intermediateCount} + 2 AND jsonb_typeof(${table.directionlessEdges}) = 'array' AND jsonb_array_length(${table.directionlessEdges}) = ${table.intermediateCount} + 1`,
    ),
  ],
);

export const trackUploadAttempts = pgTable(
  "track_upload_attempts",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => storedFiles.id, { onDelete: "cascade" }),
    trackId: uuid("track_id").references(() => tracks.id, {
      onDelete: "cascade",
    }),
    state: text("state").$type<"pending" | "complete" | "failed">().notNull(),
    ...auditColumns(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.requestId] }),
    uniqueIndex("track_attempt_file_unique").on(table.fileId),
    check(
      "track_attempt_state_check",
      sql`${table.fingerprint} ~ '^[a-f0-9]{64}$' AND ${table.state} IN ('pending','complete','failed') AND ((${table.state} = 'complete') = (${table.trackId} IS NOT NULL))`,
    ),
  ],
);

// Keep only request identities after deletion, independently of GPX cleanup.
export const deletedTrackUploads = pgTable(
  "deleted_track_uploads",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    trackId: uuid("track_id").notNull(),
    ...auditColumns(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.requestId] }),
    uniqueIndex("deleted_track_uploads_track_unique").on(table.trackId),
  ],
);

export const emailSendLimits = pgTable("email_send_limits", {
  key: text("key").primaryKey(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true })
    .array()
    .notNull()
    .default(sql`'{}'::timestamptz[]`),
  ...auditColumns(),
});

export const trackLists = pgTable(
  "track_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("track_lists_owner_name_unique").on(
      t.ownerId,
      t.normalizedName,
    ),
    check(
      "track_lists_name_valid",
      sql`char_length(${t.name}) BETWEEN 1 AND 100 AND ${t.name}=btrim(${t.name})`,
    ),
  ],
);
export const trackListMemberships = pgTable(
  "track_list_memberships",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => trackLists.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    ...auditColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.trackId] }),
    index("track_list_memberships_track_index").on(t.trackId),
  ],
);

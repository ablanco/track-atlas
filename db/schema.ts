import { sql } from "drizzle-orm";
import { boolean, check, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  displayName: text("display_name"),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
  avatarUrl: text("avatar_url"),
  active: boolean("active").notNull().default(true),
  admin: boolean("admin").notNull().default(false),
  emailConfirmed: boolean("email_confirmed").notNull().default(false),
  ...auditColumns(),
}, (table) => [
  uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
  check("users_first_name_nonblank", sql`btrim(${table.firstName}) <> ''`),
  check("users_last_name_nonblank", sql`btrim(${table.lastName}) <> ''`),
  check("users_email_nonblank", sql`btrim(${table.email}) <> ''`),
  check("users_email_trimmed", sql`${table.email} = btrim(${table.email})`),
  check("users_password_hash_nonblank", sql`btrim(${table.passwordHash}) <> ''`),
]);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...auditColumns(),
}, (table) => [
  uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  index("sessions_user_id_index").on(table.userId),
]);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export const captchaUses = pgTable("captcha_uses", {
  challengeHash: text("challenge_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...auditColumns(),
}, (table) => [index("captcha_uses_expires_at_index").on(table.expiresAt)]);

export const accountActionTokens = pgTable("account_action_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").$type<"email-confirmation" | "password-reset">().notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...auditColumns(),
}, table => [
  uniqueIndex("account_action_tokens_hash_unique").on(table.tokenHash),
  index("account_action_tokens_user_purpose_index").on(table.userId, table.purpose),
  index("account_action_tokens_expiry_index").on(table.expiresAt),
  check("account_action_tokens_purpose_check", sql`${table.purpose} IN ('email-confirmation','password-reset')`),
]);

export const emailSendLimits = pgTable("email_send_limits", {
  key: text("key").primaryKey(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).array().notNull().default(sql`'{}'::timestamptz[]`),
  ...auditColumns(),
});

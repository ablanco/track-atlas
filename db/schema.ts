import { sql } from "drizzle-orm";
import { boolean, check, date, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

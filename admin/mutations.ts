import "server-only";
import { adminEditableFields as editable } from "./models";
import { sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { hashAccountToken } from "../auth/account-token";
import { requireAdmin } from "./auth";
import { AdminError } from "./types";
import { validateSignup } from "../auth/validation";
import { validateTrackInput, tagKey } from "../tracks/validation";
import { listName } from "../tracks/list-validation";
import {
  issueAccountToken,
  type IssuedAccountEmail,
} from "../auth/account-token-store";
import { deliverIssuedAccountEmail } from "../auth/account-email";
import { getEmailRateKey, reserveEmailRequest } from "../auth/email-rate-limit";
import { getEmailConfig } from "../email/config";
import { sendEmail } from "../email/send";
import type { SendEmail, EmailLocale } from "../email/types";

const capabilities: Record<string, string[]> = {
  users: ["update"],
  tracks: ["update", "delete"],
  track_lists: ["update", "delete"],
  track_list_memberships: ["delete"],
  stored_files: ["delete"],
  sessions: ["revoke"],
  account_action_tokens: ["revoke"],
};

function invalid(): never {
  throw new AdminError("invalidRequest");
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Row = Record<string, unknown>;
export async function mutateAdminRecords(
  db: Pick<Database, "select" | "execute" | "transaction">,
  token: string | undefined,
  input: unknown,
  options: { send?: SendEmail; locale?: EmailLocale } = {},
): Promise<{ ok: true; warning?: "confirmationDeliveryFailed" }> {
  const identity = await requireAdmin(db, token);
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const request = input as Record<string, unknown>;
  if (
    Object.keys(request).some(
      (k) => !["model", "operation", "ids", "values"].includes(k),
    )
  )
    invalid();
  const { model, operation, ids, values } = request;
  if (
    typeof model !== "string" ||
    typeof operation !== "string" ||
    !Object.hasOwn(capabilities, model) ||
    !capabilities[model].includes(operation) ||
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 100 ||
    new Set(ids).size !== ids.length
  )
    invalid();
  const table = sql.identifier(model);
  const keys =
    model === "track_list_memberships" ? ["list_id", "track_id"] : ["id"];
  const identities = ids.map((id) => {
    try {
      const parts: unknown = JSON.parse(
        typeof id === "string" ? id : invalid(),
      );
      if (
        !Array.isArray(parts) ||
        parts.length !== keys.length ||
        parts.some((p) => typeof p !== "string" || !uuid.test(p))
      )
        invalid();
      return parts as string[];
    } catch {
      return invalid();
    }
  });
  const predicates = identities.map((parts) =>
    sql.join(
      keys.map((k, i) => sql`${sql.identifier(k)}=${parts[i]}`),
      sql` AND `,
    ),
  );
  if (operation === "update") {
    if (
      ids.length !== 1 ||
      !values ||
      typeof values !== "object" ||
      Array.isArray(values) ||
      !Object.keys(values).length ||
      Object.keys(values).some((k) => !editable[model]?.includes(k))
    )
      invalid();
  } else if (values !== undefined) invalid();
  let emailConfig: ReturnType<typeof getEmailConfig> | undefined;
  try {
    emailConfig = getEmailConfig();
  } catch {
    /* Saving account changes does not depend on transport configuration. */
  }
  let issued: IssuedAccountEmail | undefined;
  let emailChanged = false;
  await db.transaction(async (tx) => {
    // Serialize privilege changes, then acquire all affected account locks in UUID order.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(241022)`);
    const candidates = await tx.execute<Row>(
      sql`SELECT * FROM ${table} WHERE ${sql.join(
        predicates.map((p) => sql`(${p})`),
        sql` OR `,
      )}`,
    );
    if (candidates.rows.length !== ids.length) throw new AdminError("notFound");
    const ownerIds = new Set<string>([identity.userId]);
    for (const r of candidates.rows) {
      if (model === "users") ownerIds.add(String(r.id));
      else if (r.owner_id || r.user_id)
        ownerIds.add(String(r.owner_id ?? r.user_id));
      else if (model === "track_list_memberships") {
        const owner = await tx.execute<Row>(
          sql`SELECT owner_id FROM track_lists WHERE id=${r.list_id}`,
        );
        if (owner.rows[0]) ownerIds.add(String(owner.rows[0].owner_id));
      }
    }
    await tx.execute(
      sql`SELECT id FROM users WHERE id IN (${sql.join(
        [...ownerIds].sort().map((id) => sql`${id}`),
        sql`,`,
      )}) ORDER BY id FOR UPDATE`,
    );
    const actor = await tx.execute<Row>(
      sql`SELECT active,admin FROM users WHERE id=${identity.userId}`,
    );
    if (!actor.rows[0]?.active) throw new AdminError("unauthorized");
    if (!actor.rows[0]?.admin) throw new AdminError("forbidden");
    const session = await tx.execute<Row>(
      sql`SELECT id FROM sessions WHERE user_id=${identity.userId} AND token_hash=${hashAccountToken(token!)} AND expires_at>clock_timestamp() FOR UPDATE`,
    );
    if (!session.rows.length) throw new AdminError("unauthorized");
    async function checkSession() {
      const valid = await tx.execute(
        sql`SELECT id FROM sessions WHERE id=${session.rows[0].id} AND expires_at>clock_timestamp()`,
      );
      if (!valid.rows.length) throw new AdminError("unauthorized");
    }
    for (const predicate of predicates) {
      const locked = await tx.execute<Row>(
        sql`SELECT * FROM ${table} WHERE ${predicate} FOR UPDATE`,
      );
      const row = locked.rows[0];
      if (!row) throw new AdminError("notFound");
      await checkSession();
      if (operation === "update") {
        const v = values as Record<string, unknown>;
        let patch: Record<string, unknown> = { ...v };
        if (model === "users") {
          for (const k of ["active", "admin"])
            if (k in v && typeof v[k] !== "boolean") invalid();
          if (
            row.id === identity.userId &&
            (v.admin === false || v.active === false)
          )
            throw new AdminError("forbidden");
          if (
            row.active &&
            row.admin &&
            (v.active === false || v.admin === false)
          ) {
            const others = await tx.execute(
              sql`SELECT id FROM users WHERE active AND admin AND id<>${row.id}`,
            );
            if (!others.rows.length) throw new AdminError("forbidden");
          }
          const form = new FormData();
          for (const [snake, camel] of Object.entries({
            first_name: "firstName",
            last_name: "lastName",
            display_name: "displayName",
            date_of_birth: "dateOfBirth",
            email: "email",
          }))
            form.set(camel, String((snake in v ? v[snake] : row[snake]) ?? ""));
          form.set("password", "unused");
          const parsed = validateSignup(
            form,
            new Date().toISOString().slice(0, 10),
          );
          if (
            !parsed.ok ||
            Object.values(v).some(
              (x) => typeof x === "string" && x.includes("\0"),
            )
          )
            invalid();
          for (const [snake, camel] of Object.entries({
            first_name: "firstName",
            last_name: "lastName",
            display_name: "displayName",
            date_of_birth: "dateOfBirth",
            email: "email",
          }))
            if (snake in v) {
              if (v[snake] !== null && typeof v[snake] !== "string") invalid();
              patch[snake] = parsed.input[camel as keyof typeof parsed.input];
            }
          emailChanged =
            "email" in patch &&
            String(patch.email).toLowerCase() !==
              String(row.email).toLowerCase();
          if (emailChanged || v.active === false) {
            // Editing one's own email intentionally revokes the acting session after final authorization.
            await tx.execute(
              sql`UPDATE account_action_tokens SET revoked_at=clock_timestamp() WHERE user_id=${row.id} AND consumed_at IS NULL AND revoked_at IS NULL`,
            );
          }
          if (emailChanged) patch.email_confirmed = false;
          await tx.execute(
            sql`UPDATE users SET ${sql.join(
              Object.entries(patch).map(
                ([k, value]) => sql`${sql.identifier(k)}=${value}`,
              ),
              sql`,`,
            )} WHERE id=${row.id}`,
          );
          if (emailChanged && emailConfig) {
            const config = emailConfig;
            const key = await getEmailRateKey(
              tx,
              String(patch.email),
              config.rateSecret,
            );
            const reservation = await reserveEmailRequest(
              tx,
              "email-confirmation",
              key,
            );
            if (reservation.allowed)
              issued = await issueAccountToken(
                tx,
                {
                  id: String(row.id),
                  email: String(patch.email),
                  firstName: String(patch.first_name ?? row.first_name),
                },
                "email-confirmation",
              );
          }
          await checkSession();
          if (emailChanged || v.active === false)
            await tx.execute(sql`DELETE FROM sessions WHERE user_id=${row.id}`);
        } else if (model === "tracks") {
          const oldTags = await tx.execute<{ label: string }>(
            sql`SELECT label FROM track_tags WHERE track_id=${row.id} ORDER BY ordinal`,
          );
          let parsed;
          try {
            parsed = validateTrackInput({
              ...row,
              tags: oldTags.rows.map((t) => t.label),
              ...v,
            });
          } catch {
            invalid();
          }
          patch = { ...parsed };
          delete patch.tags;
          await tx.execute(
            sql`UPDATE tracks SET ${sql.join(
              Object.entries(patch).map(
                ([k, value]) => sql`${sql.identifier(k)}=${value}`,
              ),
              sql`,`,
            )} WHERE id=${row.id}`,
          );
          await tx.execute(
            sql`DELETE FROM track_tags WHERE track_id=${row.id}`,
          );
          for (const [ordinal, label] of parsed!.tags.entries())
            await tx.execute(
              sql`INSERT INTO track_tags(track_id,ordinal,label,normalized_key) VALUES(${row.id},${ordinal},${label},${tagKey(label)})`,
            );
        } else {
          let parsed;
          try {
            parsed = listName(v);
          } catch {
            invalid();
          }
          await tx.execute(
            sql`UPDATE track_lists SET name=${parsed!.name},normalized_name=${parsed!.normalizedName} WHERE id=${row.id}`,
          );
        }
      } else if (model === "sessions") {
        if (row.id === session.rows[0].id) throw new AdminError("forbidden");
        await tx.execute(sql`DELETE FROM sessions WHERE id=${row.id}`);
      } else if (model === "account_action_tokens") {
        await tx.execute(
          sql`UPDATE account_action_tokens SET revoked_at=clock_timestamp() WHERE id=${row.id} AND consumed_at IS NULL AND revoked_at IS NULL`,
        );
      } else if (model === "tracks") {
        await tx.execute(
          sql`INSERT INTO deleted_track_uploads(owner_id,request_id,track_id) VALUES(${row.owner_id},${row.request_id},${row.id})`,
        );
        await tx.execute(sql`DELETE FROM tracks WHERE id=${row.id}`);
        await tx.execute(
          sql`UPDATE stored_files SET status='deleting',delete_after=clock_timestamp() WHERE id=${row.original_file_id}`,
        );
      } else if (model === "stored_files") {
        if (row.status === "pending") throw new AdminError("forbidden");
        const attached = await tx.execute(
          sql`SELECT id FROM tracks WHERE original_file_id=${row.id}`,
        );
        if (attached.rows.length) throw new AdminError("forbidden");
        await tx.execute(
          sql`UPDATE users SET avatar_file_id=NULL WHERE id=${row.owner_id} AND avatar_file_id=${row.id}`,
        );
        await tx.execute(
          sql`UPDATE stored_files SET status='deleting',delete_after=coalesce(delete_after,clock_timestamp()+interval '24 hours') WHERE id=${row.id}`,
        );
      } else await tx.execute(sql`DELETE FROM ${table} WHERE ${predicate}`);
    }
    // A self email change revokes this session by design, after the final clock check above.
    if (!(
      model === "users" &&
      emailChanged &&
      identities[0][0] === identity.userId
    ))
      await checkSession();
  });
  if (emailChanged) {
    const delivery = issued
      ? await deliverIssuedAccountEmail(
          db,
          issued,
          options.locale ?? "en",
          options.send ?? sendEmail,
        )
      : null;
    if (!delivery?.ok)
      return { ok: true, warning: "confirmationDeliveryFailed" };
  }
  return { ok: true };
}

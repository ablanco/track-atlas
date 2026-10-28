import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Database } from "../auth/database";
import { requireAdmin } from "./auth";
import { adminModels, type AdminModel } from "./models";
import { AdminError, type AdminRecord, type AdminValue } from "./types";
const ident = (s: string) => sql.identifier(s);
export function getAdminModel(name: string) {
  if (!Object.hasOwn(adminModels, name)) throw new AdminError("invalidRequest");
  return adminModels[name as AdminModel];
}
export function encodeAdminId(parts: AdminValue[]) {
  return JSON.stringify(parts);
}
function keyWhere(model: string, id: string): SQL {
  const m = getAdminModel(model);
  let parts: unknown;
  try {
    parts = JSON.parse(id);
  } catch {
    throw new AdminError("invalidRequest");
  }
  if (
    !Array.isArray(parts) ||
    parts.length !== m.keys.length ||
    parts.some((p) => !(typeof p === "string" || typeof p === "number"))
  )
    throw new AdminError("invalidRequest");
  return sql.join(
    m.keys.map((k, i) => sql`${ident(k)}::text = ${String(parts[i])}`),
    sql` AND `,
  );
}
function record(
  model: string,
  values: Record<string, AdminValue>,
): AdminRecord {
  const m = getAdminModel(model);
  const related: AdminRecord["related"] = [];
  for (const [field, target] of Object.entries({
    user_id: "users",
    owner_id: "users",
    avatar_file_id: "stored_files",
    original_file_id: "stored_files",
    file_id: "stored_files",
    track_id: "tracks",
    list_id: "track_lists",
  })) {
    if (
      values[field] &&
      !(model === "deleted_track_uploads" && field === "track_id")
    )
      related.push({
        field,
        model: target,
        id: encodeAdminId([values[field]]),
      });
  }
  return {
    id: encodeAdminId(m.keys.map((k) => values[k])),
    values,
    related,
    selectable: !!m.operation,
  };
}
function projection(model: string) {
  const m = getAdminModel(model);
  const fields: SQL[] = m.fields.map((k) => sql`${ident(k)}`);
  if (model === "track_lists")
    fields.push(
      sql`(SELECT count(*)::int FROM track_list_memberships WHERE list_id=track_lists.id) AS membership_count`,
    );
  if (model === "track_data")
    fields.push(
      sql`ST_NPoints(geometry) AS point_count`,
      sql`jsonb_array_length(samples) AS sample_count`,
    );
  if (model === "track_directional_representations")
    fields.push(sql`ST_AsGeoJSON(geometry)::jsonb AS geometry`);
  if (model === "email_send_limits")
    fields.push(sql`cardinality(attempted_at) AS attempt_count`);
  return sql.join(fields, sql`, `);
}
export async function listAdminRecords(
  db: Pick<Database, "select" | "execute">,
  token: string | undefined,
  model: string,
  params: URLSearchParams,
) {
  await requireAdmin(db, token);
  return readPage(db, model, params);
}
async function readPage(
  db: Pick<Database, "select" | "execute">,
  model: string,
  params: URLSearchParams,
) {
  const m = getAdminModel(model);
  const allowed = ["q", "page", "pageSize", "sort", "direction", ...m.filters];
  for (const k of params.keys())
    if (!allowed.includes(k) || params.getAll(k).length !== 1)
      throw new AdminError("invalidRequest");
  const size = Number(params.get("pageSize") ?? 25),
    requested = Number(params.get("page") ?? 1),
    sort = params.get("sort") ?? "created_at",
    direction = params.get("direction") ?? "desc",
    q = params.get("q") ?? "";
  if (
    ![25, 50, 100].includes(size) ||
    !Number.isSafeInteger(requested) ||
    requested < 1 ||
    !m.fields.some((f) => f === sort) ||
    !["asc", "desc"].includes(direction) ||
    q.length > 200
  )
    throw new AdminError("invalidRequest");
  const clauses: SQL[] = [sql`true`];
  for (const f of m.filters)
    if (params.has(f)) {
      const v = params.get(f)!;
      if (v.length > 200) throw new AdminError("invalidRequest");
      clauses.push(sql`${ident(f)}::text = ${v}`);
    }
  if (q)
    clauses.push(
      sql`concat_ws(' ',${sql.join(
        m.fields.map((f) => sql`${ident(f)}::text`),
        sql`, `,
      )}) ILIKE ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"}`,
    );
  const where = sql.join(clauses, sql` AND `),
    table = ident(model);
  const result = await db.execute(
    sql`SELECT count(*)::int AS total FROM ${table} WHERE ${where}`,
  );
  const total = Number(result.rows[0].total),
    page = Math.min(requested, Math.max(1, Math.ceil(total / size)));
  const rows = await db.execute(
    sql`SELECT ${projection(model)} FROM ${table} WHERE ${where} ORDER BY ${ident(sort)} ${sql.raw(direction)}, ${sql.join(m.keys.map(ident), sql`, `)} LIMIT ${size} OFFSET ${(page - 1) * size}`,
  );
  return {
    rows: rows.rows.map((r) => record(model, r as Record<string, AdminValue>)),
    total,
    page,
    pageSize: size,
  };
}
export async function getAdminRecord(
  db: Pick<Database, "select" | "execute">,
  token: string | undefined,
  model: string,
  id: string,
  params = new URLSearchParams(),
) {
  await requireAdmin(db, token);
  const where = keyWhere(model, id);
  const result = await db.execute(
    sql`SELECT ${projection(model)} FROM ${ident(model)} WHERE ${where}`,
  );
  if (!result.rows.length) throw new AdminError("notFound");
  const row = record(model, result.rows[0] as Record<string, AdminValue>);
  for (const k of params.keys())
    if (!["page", "pageSize"].includes(k) || params.getAll(k).length !== 1)
      throw new AdminError("invalidRequest");
  const page = Number(params.get("page") ?? 1),
    size = Number(params.get("pageSize") ?? 25);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 4000 ||
    ![25, 50, 100].includes(size)
  )
    throw new AdminError("invalidRequest");
  let data: unknown = null;
  if (model === "track_data")
    data = (
      await db.execute(
        sql`SELECT i AS index, ST_AsGeoJSON(ST_PointN(geometry,i+1))::jsonb AS point, samples->i AS sample FROM track_data CROSS JOIN LATERAL generate_series(${(page - 1) * size}, LEAST(jsonb_array_length(samples)-1,${page * size - 1})) i WHERE ${where}`,
      )
    ).rows;
  if (model === "email_send_limits")
    data = (
      await db.execute(
        sql`SELECT unnest(attempted_at[${(page - 1) * size + 1}:${page * size}]) AS attempted_at FROM email_send_limits WHERE ${where}`,
      )
    ).rows;
  return { record: row, data, page, pageSize: size };
}
export async function getAdminOverview(
  db: Pick<Database, "select" | "execute">,
  token: string | undefined,
) {
  await requireAdmin(db, token);
  const cards = [];
  for (const [model, field, values] of [
    ["users", "active", ["true", "false"]],
    ["users", "admin", ["true"]],
    ["users", "email_confirmed", ["true", "false"]],
    ["tracks", "visibility", ["public", "private"]],
    ["stored_files", "status", ["pending", "ready", "deleting"]],
    ["track_lists", "", []],
    ["track_list_memberships", "", []],
  ] as [string, string, string[]][]) {
    for (const value of ["", ...values]) {
      const query = new URLSearchParams(value ? { [field]: value } : {});
      const page = await readPage(db, model, query);
      cards.push({
        model,
        filters: Object.fromEntries(query),
        count: page.total,
      });
    }
  }
  const usage = await db.execute(
    sql`SELECT count(*)::int AS files,coalesce(sum(byte_size+coalesce(avatar_128_bytes,0)+coalesce(avatar_24_bytes,0)),0)::text AS bytes FROM stored_files`,
  );
  return { cards, storage: usage.rows[0] };
}

import "server-only";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database, AuthTransaction } from "../auth/database";
import type { SendEmail, EmailSendResult } from "../email/types";
import { isSupportedLocale } from "../i18n/locales";
import { renderDigestEmail, plain, type DigestEntry } from "./render";

type Db = Pick<Database, "execute" | "transaction">;
type Claim = {
  id: string;
  recipient_id: string;
  delivery_day: string;
  window_start: string;
  window_end: string;
  attempt_id: string;
  attempt_count: number;
};
const daySql = sql`to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD')`;
const endSql = sql`date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
export function getDigestDailyLimit(env: NodeJS.ProcessEnv = process.env) {
  const v = env.DIGEST_EMAIL_DAILY_LIMIT ?? "250";
  if (!/^(0|[1-9]\d*)$/.test(v) || !Number.isSafeInteger(Number(v)))
    throw Error("Invalid digest limit");
  return Number(v);
}
export type DigestCounts = {
  pending: number;
  deferred: number;
  expiredWindows: number;
  accepted: number;
  rejected: number;
  uncertain: number;
  suppressed: number;
  empty: number;
  budgetExhausted: number;
  oldestDueAgeSeconds: number;
};
async function close(
  tx: AuthTransaction,
  c: Pick<Claim, "id" | "recipient_id" | "window_end">,
  state: string,
  code: string,
) {
  await tx.execute(
    sql`UPDATE digest_deliveries SET state=${state},outcome_code=${code},next_attempt_at=NULL,accepted_at=CASE WHEN ${state}='sent' THEN clock_timestamp() ELSE NULL END WHERE id=${c.id}::uuid`,
  );
  await tx.execute(
    sql`UPDATE users SET digest_cursor_at=greatest(digest_cursor_at,${c.window_end}::timestamptz) WHERE id=${c.recipient_id}::uuid`,
  );
}
async function claim(
  db: Db,
  recipient: string,
  limit: number,
  counts: DigestCounts,
): Promise<Claim | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
    await tx.execute(sql`SET LOCAL statement_timeout='8s'`);
    const {
      rows: [u],
    } = await tx.execute<{
      active: boolean;
      email_confirmed: boolean;
      digest_emails_enabled: boolean;
    }>(
      sql`SELECT active,email_confirmed,digest_emails_enabled FROM users WHERE id=${recipient}::uuid FOR UPDATE`,
    );
    if (!u) return null;
    const { rows: stale } = await tx.execute<Claim>(
      sql`SELECT id,recipient_id,window_end::text FROM digest_deliveries WHERE recipient_id=${recipient}::uuid AND state='sending' AND sending_started_at < clock_timestamp()-interval '10 minutes' FOR UPDATE`,
    );
    for (const c of stale) {
      await close(tx, c, "uncertain", "staleSending");
      await tx.execute(
        sql`INSERT INTO digest_dispatch_days(recipient_id,dispatch_day,delivery_id) VALUES(${recipient}::uuid,${daySql}::date,${c.id}::uuid) ON CONFLICT DO NOTHING`,
      );
      counts.uncertain++;
    }
    if (
      (
        await tx.execute(
          sql`SELECT 1 FROM digest_deliveries WHERE recipient_id=${recipient}::uuid AND state='sending'`,
        )
      ).rows.length
    )
      return null;
    // DB time is selected after account/row waits. Keep microseconds in PostgreSQL.
    const {
      rows: [window],
    } = await tx.execute<{
      day: string;
      start: string;
      end: string;
      expired: boolean;
    }>(
      sql`SELECT ${daySql} AS day,${endSql}::text AS end,greatest(coalesce(u.digest_cursor_at,(SELECT min(followed_at) FROM uploader_follows WHERE follower_id=u.id),${endSql}),${endSql}-interval '7 days')::text AS start,coalesce(u.digest_cursor_at,(SELECT min(followed_at) FROM uploader_follows WHERE follower_id=u.id)) < ${endSql}-interval '7 days' AS expired FROM users u WHERE id=${recipient}::uuid`,
    );
    if (window.expired) {
      counts.expiredWindows++;
      await tx.execute(
        sql`UPDATE users SET digest_cursor_at=${window.start}::timestamptz WHERE id=${recipient}::uuid`,
      );
    }
    await tx.execute(
      sql`UPDATE digest_deliveries SET state='superseded',next_attempt_at=NULL,outcome_code='superseded' WHERE recipient_id=${recipient}::uuid AND delivery_day<${window.day}::date AND state IN ('pending','retryable')`,
    );
    await tx.execute(
      sql`INSERT INTO digest_deliveries(recipient_id,delivery_day,window_start,window_end) SELECT ${recipient}::uuid,${window.day}::date,${window.start}::timestamptz,${window.end}::timestamptz WHERE ${window.start}::timestamptz<${window.end}::timestamptz ON CONFLICT DO NOTHING`,
    );
    const {
      rows: [c],
    } = await tx.execute<Claim & { state: string; due: boolean }>(
      sql`SELECT *,delivery_day::text,window_start::text,window_end::text,(next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp()) AS due FROM digest_deliveries WHERE recipient_id=${recipient}::uuid AND delivery_day=${window.day}::date FOR UPDATE`,
    );
    if (!c || !["pending", "retryable"].includes(c.state)) return null;
    if (!u.active || !u.digest_emails_enabled) {
      await close(tx, c, "suppressed", u.active ? "disabled" : "inactive");
      counts.suppressed++;
      return null;
    }
    if (!u.email_confirmed) {
      counts.deferred++;
      return null;
    }
    if (!c.due) {
      counts.pending++;
      return null;
    }
    // Empty windows are progress, not sending attempts. Reuse the final content
    // predicates before quota or durable intent; dispatch still rereads afterward.
    const preflight = await content(tx, c, true);
    if (!preflight?.total) {
      await close(tx, c, "empty", "empty");
      counts.empty++;
      return null;
    }
    // Budget and fence reservation are part of the durable send-intent transaction.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(247192615)`);
    await tx.execute(sql`LOCK TABLE email_send_limits IN ROW EXCLUSIVE MODE`);
    const {
      rows: [clock],
    } = await tx.execute<{ day: string; now: string }>(
      sql`SELECT ${daySql} AS day,clock_timestamp()::text AS now`,
    );
    if (clock.day !== c.delivery_day) {
      counts.pending++;
      return null;
    }
    const {
      rows: [fence],
    } = await tx.execute<{ delivery_id: string | null }>(
      sql`SELECT delivery_id FROM digest_dispatch_days WHERE recipient_id=${recipient}::uuid AND dispatch_day=${clock.day}::date`,
    );
    if (fence && fence.delivery_id !== c.id) {
      counts.pending++;
      return null;
    }
    const key = `digest:daily:${clock.day}`;
    await tx.execute(
      sql`INSERT INTO email_send_limits(key) VALUES(${key}) ON CONFLICT DO NOTHING`,
    );
    const {
      rows: [bucket],
    } = await tx.execute<{ n: number }>(
      sql`SELECT cardinality(attempted_at) AS n FROM email_send_limits WHERE key=${key} FOR UPDATE`,
    );
    const {
      rows: [afterWait],
    } = await tx.execute<{ day: string; now: string }>(
      sql`SELECT ${daySql} AS day,clock_timestamp()::text AS now`,
    );
    if (afterWait.day !== c.delivery_day) {
      counts.pending++;
      return null;
    }
    if (bucket.n >= limit) {
      counts.budgetExhausted++;
      return null;
    }
    await tx.execute(
      sql`UPDATE email_send_limits SET attempted_at=array_append(attempted_at,${afterWait.now}::timestamptz) WHERE key=${key}`,
    );
    await tx.execute(
      sql`INSERT INTO digest_dispatch_days(recipient_id,dispatch_day,delivery_id) VALUES(${recipient}::uuid,${clock.day}::date,${c.id}::uuid) ON CONFLICT DO NOTHING`,
    );
    const {
      rows: [claimed],
    } = await tx.execute<Claim>(
      sql`UPDATE digest_deliveries SET state='sending',attempt_count=attempt_count+1,attempt_id=${randomUUID()}::uuid,sending_started_at=clock_timestamp(),next_attempt_at=NULL,outcome_code=NULL WHERE id=${c.id}::uuid RETURNING *,delivery_day::text,window_start::text,window_end::text`,
    );
    return claimed;
  });
}
// Dispatch uses this snapshot as final authority after all claim/budget waits.
async function content(db: Db, c: Claim, preflight = false) {
  const {
    rows: [row],
  } = await db.execute<{
    active: boolean;
    enabled: boolean;
    confirmed: boolean;
    email: string;
    name: string;
    locale: string | null;
    day: string;
    total: number;
    entries: DigestEntry[];
    uploaders: { id: string; name: string }[];
  }>(sql`
 WITH recipient AS (SELECT * FROM users WHERE id=${c.recipient_id}::uuid AND (${preflight} OR EXISTS(SELECT 1 FROM digest_deliveries WHERE id=${c.id}::uuid AND attempt_id=${c.attempt_id}::uuid AND state='sending'))), eligible AS (
 SELECT t.id,t.owner_id AS "uploaderId",coalesce(nullif(btrim(u.display_name),''),u.first_name||' '||left(u.last_name,1)||'.') AS "displayName",t.name AS title,t.activity,t.distance_meters AS "distanceMeters",t.ascent_meters AS "ascentMeters",t.digest_published_at
 FROM tracks t JOIN users u ON u.id=t.owner_id AND u.active
 JOIN stored_files s ON s.id=t.original_file_id AND s.owner_id=u.id AND s.status='ready' AND s.purpose='gpx'
 JOIN uploader_follows f ON f.uploader_id=u.id AND f.follower_id=${c.recipient_id}::uuid
 CROSS JOIN recipient r
 WHERE t.visibility='public' AND t.digest_published_at>=${c.window_start}::timestamptz AND t.digest_published_at<${c.window_end}::timestamptz AND t.digest_published_at>=f.followed_at AND (r.digest_resume_after IS NULL OR t.digest_published_at>r.digest_resume_after)
 ), bounded AS (SELECT * FROM eligible ORDER BY "uploaderId",digest_published_at,id LIMIT 50), uploaders AS (SELECT DISTINCT "uploaderId" AS id,"displayName" AS name FROM eligible ORDER BY id LIMIT 10)
 SELECT active,digest_emails_enabled AS enabled,email_confirmed AS confirmed,email,first_name AS name,digest_email_locale AS locale,${daySql} AS day,(SELECT count(*)::int FROM eligible) AS total,coalesce((SELECT jsonb_agg(b ORDER BY "uploaderId",digest_published_at,id) FROM bounded b),'[]'::jsonb) AS entries,coalesce((SELECT jsonb_agg(u ORDER BY id) FROM uploaders u),'[]'::jsonb) AS uploaders FROM recipient`);
  return row;
}
async function finalize(
  db: Db,
  c: Claim,
  result: EmailSendResult | { state: "empty" | "suppressed"; code: string },
  counts: DigestCounts,
) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM users WHERE id=${c.recipient_id}::uuid FOR UPDATE`,
    );
    const {
      rows: [live],
    } = await tx.execute(
      sql`SELECT id FROM digest_deliveries WHERE id=${c.id}::uuid AND attempt_id=${c.attempt_id}::uuid AND state='sending' FOR UPDATE`,
    );
    if (!live) return; // Erasure or a stale-attempt closer won authority.
    if (
      !("state" in result) &&
      (result.ok || result.delivery !== "notAttempted")
    ) {
      // A network call spanning midnight may have been accepted on either day.
      // The old sending row excluded concurrent claims until this fence commits.
      await tx.execute(
        sql`INSERT INTO digest_dispatch_days(recipient_id,dispatch_day,delivery_id) VALUES(${c.recipient_id}::uuid,${daySql}::date,${c.id}::uuid) ON CONFLICT DO NOTHING`,
      );
    }
    if ("state" in result) {
      await close(tx, c, result.state, result.code);
      counts[result.state]++;
      return;
    }
    if (result.ok) {
      await close(tx, c, "sent", "accepted");
      counts.accepted++;
      return;
    }
    if (result.delivery === "rejected") {
      counts.rejected++;
      if (result.retryable && c.attempt_count < 3) {
        await tx.execute(
          sql`UPDATE digest_deliveries SET state='retryable',outcome_code='rejected',next_attempt_at=clock_timestamp()+${c.attempt_count === 1 ? "15 minutes" : "60 minutes"}::interval WHERE id=${c.id}::uuid`,
        );
        return;
      }
      await close(
        tx,
        c,
        "failed",
        result.retryable ? "retryExhausted" : "rejected",
      );
      return;
    }
    if (result.delivery === "notAttempted") {
      await close(tx, c, "failed", "notAttempted");
      return;
    }
    await close(tx, c, "uncertain", "unknown");
    counts.uncertain++;
  });
}
export async function processDigests(input: {
  db: Db;
  send: SendEmail;
  origin: string;
  dailyLimit?: number;
  runBudgetMs?: number;
}): Promise<DigestCounts> {
  const { db } = input,
    limit = input.dailyLimit ?? getDigestDailyLimit();
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw Error("Invalid digest limit");
  const origin = new URL(input.origin);
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    !["http:", "https:"].includes(origin.protocol)
  )
    throw Error("Invalid digest origin");
  const deadline =
    performance.now() +
    Math.min(50000, Math.max(0, input.runBudgetMs ?? 50000));
  const counts: DigestCounts = {
    pending: 0,
    deferred: 0,
    expiredWindows: 0,
    accepted: 0,
    rejected: 0,
    uncertain: 0,
    suppressed: 0,
    empty: 0,
    budgetExhausted: 0,
    oldestDueAgeSeconds: 0,
  };
  const seen = new Set<string>();
  const process = async (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const c = await claim(db, id, limit, counts);
    if (!c) return;
    let result:
      EmailSendResult | { state: "empty" | "suppressed"; code: string };
    try {
      const token = randomBytes(32).toString("base64url"),
        hash = createHash("sha256").update(token).digest("hex");
      // Serialize issuance with reenable and erasure, which revoke token authority.
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM users WHERE id=${id}::uuid FOR UPDATE`,
        );
        await tx.execute(
          sql`INSERT INTO digest_opt_out_tokens(recipient_id,token_hash,expires_at) SELECT ${id}::uuid,${hash},clock_timestamp()+interval '90 days' WHERE EXISTS(SELECT 1 FROM users WHERE id=${id}::uuid AND active AND digest_emails_enabled) AND EXISTS(SELECT 1 FROM digest_deliveries WHERE id=${c.id}::uuid AND attempt_id=${c.attempt_id}::uuid AND state='sending')`,
        );
      });
      const row = await content(db, c);
      if (!row || !row.active || !row.enabled || !row.confirmed)
        result = {
          state: "suppressed",
          code: row?.active ? "disabled" : "inactive",
        };
      else if (!row.total) result = { state: "empty", code: "empty" };
      else {
        const message = {
          to: { email: row.email, name: plain(row.name) },
          ...renderDigestEmail({
            locale: isSupportedLocale(row.locale) ? row.locale : "en",
            origin: origin.origin,
            entries: row.entries,
            total: row.total,
            uploaders: row.uploaders,
            token,
          }),
        };
        // Recheck DB time after rendering, immediately before transport; a crossed
        // midnight has no authority to dispatch. Its reservation remains charged.
        const {
          rows: [clock],
        } = await db.execute<{ day: string }>(sql`SELECT ${daySql} AS day`);
        if (clock.day !== c.delivery_day) {
          await db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT id FROM users WHERE id=${id}::uuid FOR UPDATE`,
            );
            await tx.execute(
              sql`UPDATE digest_deliveries SET state='pending',outcome_code=NULL WHERE id=${c.id}::uuid AND attempt_id=${c.attempt_id}::uuid AND state='sending'`,
            );
          });
          counts.pending++;
          return;
        }
        try {
          result = await input.send(message);
        } catch {
          result = { ok: false, reason: "unavailable", delivery: "unknown" };
        }
      }
    } catch {
      result = { ok: false, reason: "unavailable", delivery: "notAttempted" };
    }
    // A failure after dispatch MUST leave sending intent intact. A later run
    // closes it as uncertain; it must never be changed to retryable here.
    await finalize(db, c, result, counts);
  };
  // Reserve the first half for durable enumeration so retry discovery cannot
  // consume every run. Allocate one recipient at a time: advancing a whole
  // unprocessed page would repeatedly skip its tail under short budgets.
  const scanDeadline =
    performance.now() + Math.max(0, deadline - performance.now()) / 2;
  while (performance.now() < scanDeadline) {
    const next = await db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO digest_scheduler_progress(id) VALUES(1) ON CONFLICT DO NOTHING`,
      );
      const {
        rows: [p],
      } = await tx.execute<{ after_recipient_id: string | null }>(
        sql`SELECT after_recipient_id FROM digest_scheduler_progress WHERE id=1 FOR UPDATE`,
      );
      const { rows } = await tx.execute<{ id: string }>(
        sql`SELECT u.id FROM users u WHERE (${p.after_recipient_id}::uuid IS NULL OR u.id>${p.after_recipient_id}::uuid) AND (EXISTS(SELECT 1 FROM uploader_follows f WHERE f.follower_id=u.id) OR EXISTS(SELECT 1 FROM digest_deliveries d WHERE d.recipient_id=u.id AND d.state IN ('pending','retryable','sending'))) ORDER BY u.id LIMIT 1`,
      );
      await tx.execute(
        sql`UPDATE digest_scheduler_progress SET after_recipient_id=${rows[0]?.id ?? null}::uuid WHERE id=1`,
      );
      return rows[0];
    });
    if (!next) break;
    await process(next.id);
  }
  // Discover due retries independently of the account cursor. Deferred accounts
  // and fresh sending intent do not occupy this bounded oldest-first pass.
  if (performance.now() < deadline) {
    const { rows: due } = await db.execute<{ recipient_id: string }>(
      sql`SELECT d.recipient_id FROM digest_deliveries d JOIN users u ON u.id=d.recipient_id WHERE (d.state IN ('pending','retryable') AND u.active AND u.email_confirmed AND u.digest_emails_enabled AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=clock_timestamp()) OR d.state='sending' AND d.sending_started_at<clock_timestamp()-interval '10 minutes') GROUP BY d.recipient_id ORDER BY min(d.window_start),d.recipient_id LIMIT 100`,
    );
    for (const r of due) {
      if (performance.now() >= deadline) break;
      await process(r.recipient_id);
    }
  }
  const {
    rows: [age],
  } = await db.execute<{ age: number }>(
    sql`SELECT coalesce(greatest(0,extract(epoch FROM clock_timestamp()-min(window_end)))::int,0) AS age FROM digest_deliveries WHERE state IN ('pending','retryable','sending')`,
  );
  counts.oldestDueAgeSeconds = age.age;
  return counts;
}

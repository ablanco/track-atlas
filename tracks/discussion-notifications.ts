import "server-only";
import { sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { getEmailConfig, getDiscussionEmailDailyLimit } from "../email/config";
import { reserveDiscussionEmailBudget } from "../email/discussion-budget";
import {
  renderDiscussionEmail,
  type DiscussionNotificationKind,
} from "../email/discussion-templates";
import { sendEmail } from "../email/send";
import type { EmailLocale, SendEmail } from "../email/types";

type Recipient = {
  email: string;
  name: string;
  locale: EmailLocale | null;
  sender: string | null;
  track: string;
  trackId: string;
  commentId: string;
};
async function recipient(
  db: Pick<Database, "execute">,
  kind: DiscussionNotificationKind,
  postId: string,
) {
  const source =
    kind === "comment"
      ? sql`track_comments c JOIN users sender ON sender.id=c.author_id JOIN tracks t ON t.id=c.track_id JOIN users recipient ON recipient.id=t.owner_id WHERE c.id=${postId}::uuid`
      : sql`track_comment_replies r JOIN track_comments c ON c.id=r.comment_id JOIN users sender ON sender.id=r.author_id JOIN tracks t ON t.id=c.track_id JOIN users recipient ON recipient.id=c.author_id WHERE r.id=${postId}::uuid`;
  return (
    await db.execute<Recipient>(sql`SELECT recipient.email,recipient.first_name AS name,recipient.discussion_email_locale AS locale,
    CASE WHEN sender.active THEN coalesce(nullif(btrim(sender.display_name),''),sender.first_name || ' ' || left(sender.last_name,1) || '.') END AS sender,
    t.name AS track,t.id AS "trackId",c.id AS "commentId" FROM ${source}
    AND recipient.active AND recipient.email_confirmed AND recipient.discussion_emails_enabled
    AND recipient.id<>sender.id
    AND (t.visibility='public' OR t.owner_id=recipient.id)
    AND EXISTS(SELECT 1 FROM users owner WHERE owner.id=t.owner_id AND owner.active)
    AND EXISTS(SELECT 1 FROM stored_files f WHERE f.id=t.original_file_id AND f.owner_id=t.owner_id AND f.purpose='gpx' AND f.status='ready')`)
  ).rows[0];
}

/** Called once after commit. No retry, outbox, or delivery errors escape to posting. */
export async function deliverDiscussionNotification({
  db,
  kind,
  postId,
  send = sendEmail,
}: {
  db: Database;
  kind: DiscussionNotificationKind;
  postId: string;
  send?: SendEmail;
}): Promise<"sent" | "skipped" | "failed" | "budgetExhausted"> {
  try {
    if (!(await recipient(db, kind, postId))) return "skipped";
    const config = getEmailConfig();
    if (
      !(await reserveDiscussionEmailBudget(db, getDiscussionEmailDailyLimit()))
    )
      return "budgetExhausted";
    // Budget lock waits may outlive account, preference, email or access changes.
    const current = await recipient(db, kind, postId);
    if (!current) return "skipped";
    const result = await send({
      to: { email: current.email, name: current.name },
      ...renderDiscussionEmail({
        kind,
        locale: current.locale ?? "en",
        sender: current.sender,
        track: current.track,
        origin: config.origin,
        trackId: current.trackId,
        commentId: current.commentId,
      }),
    });
    if (!result.ok) throw Error("Delivery failed");
    return "sent";
  } catch {
    console.error("Discussion email failed", { kind });
    return "failed";
  }
}

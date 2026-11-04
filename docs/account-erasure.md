# Staff-operated permanent account erasure

[Documentation index](README.md) · [Operations](operations.md) · [Erasure architecture](architecture/legal-and-erasure.md#staff-operated-permanent-account-erasure)

`pnpm users:erase <account-uuid> --dry-run` reports account-owned counts and the
referenced storage-location digests, `erasureStartedAt`, and the snapshot
`lastActiveAdmin` blocker without changing the database or touching
storage. After verifying the request, run
`pnpm users:erase <account-uuid> --confirm <same-account-uuid>`.
This is irreversible, unlike reversible account deactivation. There is no public
erasure endpoint or self-service deletion UI.

Staff procedure:

1. Handle the request through the published privacy mailbox. Establish control
   of the **currently registered email** through a reply/challenge sent to that
   address; possession of an account UUID, public track, display name, or a
   forwarded message alone is insufficient. Resolve ambiguous or disputed
   requests before invoking the command. Record verification and the requested
   UUID in the private request correspondence. Do not put correspondence, email
   addresses, tokens, or credentials in application logs or tickets.
2. Use the intended server environment and database, apply migrations, and
   resolve the exact account UUID with a private, parameterized staff database
   lookup. Run the dry run and check the target against the verified request.
   Counts cover owned/authored records; owned-track deletion additionally removes
   **other people's** votes, comments/replies, and list memberships on those
   tracks. Deleting an authored comment on a surviving track also removes its
   attached owner's reply. Surviving lists and unrelated contributions remain.
3. Before first use, deploy these lifecycle-aware writers and cleaners to every
   instance and drain older upload workers. Confirm the UUID explicitly. The command uses `DATABASE_URL` and the ordinary
   `FILE_STORAGE_*` / `B2_*` configuration, loading Next environment files in
   development by default; set `NODE_ENV=production` for production. It refuses
   to remove the last active administrator under the same lock as administrative
   account changes. First establish another active administrator if necessary.
4. Read the result, not just whether the command ran. JSON `status: "pending"`
   means access is withdrawn but erasure is unfinished. `"failed"` means physical
   removals failed and remain retryable. Both exit **2**. `"complete"` exits **0**
   and means physical cleanup succeeded and the final account row was removed;
   only then is the email reusable. A successful dry run also exits **0**.
   Invalid arguments, absent accounts, last-admin refusal, and infrastructure
   errors exit **1** with safe text. Infrastructure errors may follow committed
   withdrawal; inspect with dry run and resume. An absent UUID does not provide
   a historical completion receipt: reconcile it with the private request record.
5. Preserve the cleanup rows and deadlines. Files, including pending reservations,
   old avatars and unassociated photos, retain **at least a 24-hour tombstone**
   from withdrawal (longer existing deadlines are retained). The first invocation
   normally returns pending even if it already removed all visible bytes.
   Re-run after `nextCleanupAt` (the latest remaining deadline), and retry failed
   removals. A command can wait for an in-flight object write; interrupting it
   leaves the operation resumable. Never shorten tombstones, delete bookkeeping
   manually, or declare completion from an empty bucket listing.
6. Each invocation can address the single storage location described by its
   current configuration. `locations` / `unconfiguredLocations` contain persistent
   digests, not credentials or bucket paths. Match them to the deployment's
   storage inventory, rerun with the original local directory or original B2
   endpoint/bucket and adequate credentials, then rerun for each remaining
   location. Renamed/moved directories, missing credentials, inaccessible buckets,
   retained object versions or provider failures require repair and another run;
   the command leaves these rows pending instead of dropping references.
   `pnpm files:cleanup` also retries physical cleanup for its configured location,
   but **does not finalize account erasure**; run `users:erase` again afterwards.
7. Retain shared protection windows. Erasure does not delete `captcha_uses` or
   `email_send_limits` (address HMACs, account-email daily budgets, and separate
   discussion daily budgets). Re-registration must not reset an address allowance
   or today's budget. Expired protections stop affecting admission by time checks;
   their rows are not thereby physically pruned. During coordinated maintenance
   with writers stopped, delete expired CAPTCHA proofs, address buckets whose
   latest attempt is older than one hour, and daily buckets before the current
   UTC day, using the maintenance SQL below.
   Do not rotate the HMAC secret or prune current windows to satisfy one erasure.
   Account-specific discussion events and upload retry identities disappear with
   the final account row after it can no longer authorize any new work.
8. Separately close out the private request correspondence and necessary Brevo
   contact/message or other provider follow-up under the operator's retention
   procedure. This command removes application data and the referenced stored
   originals, derivatives and B2 versions; it cannot retract delivered email or
   downloaded public copies, and does not promise removal of every provider's
   operational, correspondence, logging or backup records. Handle any retained
   copies and deployment backups separately; do not restore an erased account
   or its files from an old backup.

See [erasure verification](testing.md#permanent-account-erasure) for the database
and capture-only browser suites. Tests advance only their own tombstone deadlines;
operators must wait for the real deadlines.

## Expired protection record maintenance

Run this only in a coordinated maintenance window with protection writers stopped:

```sql
DELETE FROM captcha_uses WHERE expires_at <= clock_timestamp();
DELETE FROM email_send_limits
WHERE key LIKE 'address:%'
  AND NOT EXISTS (
    SELECT 1 FROM unnest(attempted_at) AS attempt
    WHERE attempt > clock_timestamp() - interval '1 hour'
  );
DELETE FROM email_send_limits
WHERE (key LIKE 'daily:%' OR key LIKE 'discussion:daily:%')
  AND updated_at < date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
```

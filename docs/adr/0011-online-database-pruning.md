# Online database pruning with protection-aware concurrency

Accepted on 2026-11-06.

Provide an operator command for bounded online pruning of expired sessions,
unusable account links, expired CAPTCHA records, and obsolete email-limit buckets.
Keep logical expiry checks independent of physical cleanup. Preserve upload retry
identities and account-erasure tombstones under ADR-0001 and ADR-0008.

Use one transaction of at most 1,000 deleted rows per table, skip locked candidate
rows, and bound lock and statement waits. Email pruning additionally takes a
`SHARE ROW EXCLUSIVE` table lock because existing senders insert a bucket before
locking and updating it. Row locks alone would allow deletion between those steps.
The brief table lock trades bounded email-writer contention for preserving the
existing request and sending allowances. Daily writers obtain their table lock
before choosing the UTC date so a pruning wait across midnight uses the new day.

CAPTCHA consumption checks database-clock expiry after its unique insert finishes.
A previously verified request waiting on deletion of an expired replay record must
not become a new successful consumption. All instances need these writer changes
and older requests must drain before the first online pruning run.

Scheduling remains an operator responsibility. Report counts without identifiers,
allow safe retries after partial completion, and keep permanent account erasure a
separate verified staff action. This replaces the stopped-writer requirement for
routine pruning; raw maintenance SQL still requires coordinated downtime.

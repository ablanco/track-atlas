# Durable daily digests with conservative uncertainty

Accepted for [#72](https://github.com/ablanco/track-atlas/issues/72), implemented by
#73–#75. Daily digests use PostgreSQL send intent, closed-window progress and
recipient/day fences, with a separate attempt allowance and a host-authenticated
CLI. This differs from [ADR-0006](0006-best-effort-discussion-email-notifications.md),
which continues to govern best-effort discussion emails only.

We prefer a missed digest over intentionally sending a duplicate after an
ambiguous provider result or worker crash. Sending intent is committed before
network I/O; stale intent becomes terminal uncertainty, never a reclaimed lease.
Only confirmed transient nonacceptance retries, at most three charged attempts.
Brevo's documented invalid-request (400) and rate-limit (429) responses are
rejections; only 429 retries. Success requires documented 201 with a bounded
message ID. Network errors, malformed success, unexpected statuses and 5xx remain
unknown even though generic SDK retry guidance includes some of those statuses.
See the [send API](https://developers.brevo.com/reference/send-transac-email) and
[rate-limit documentation](https://developers.brevo.com/docs/api-limits), verified
2026-11-22. Existing callers can continue checking `ok`; unspecified legacy
failure classifications are treated as unknown by the digest processor.

Catch-up is one consolidated message per actual delivery date, covering at most
seven closed UTC days. Up to 50 detail entries summarize the whole qualifying
range, including explicitly announced overflow. Old history is intentionally
expired rather than producing a burst of old-day messages. Independent attempt
budgets preserve account-recovery and discussion capacity. Final eligibility is
read after the claim and quota waits, without holding database locks over provider
I/O; withdrawal after that snapshot cannot recall an in-flight message.

Purpose-bound opt-out links have only digest-disable authority, require explicit
POST confirmation, and survive subsequent digest issuance. A forwarded link can
therefore disable the original recipient's digests, but cannot sign in, confirm an
account, reset a password or erase data. Reenable revokes prior opt-out authority.

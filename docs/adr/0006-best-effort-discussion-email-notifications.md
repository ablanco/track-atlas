# Best-effort discussion emails with a separate sending allowance

Accepted during feature design on 2026-11-02; implemented through discussion
notifications, a separate database-backed sending allowance, and account
preferences in [issue #28](https://github.com/ablanco/track-atlas/issues/28).

New track comments notify the track owner; new owner replies notify the comment
author. Edits and deletions do not notify, and self-notifications are suppressed.
Notifications are attempted once after the post is saved, without automatic
retries. Delivery failure never rolls back a post. This accepts possible missed
notifications rather than introducing an outbox and retry infrastructure for
the first version; failures are recorded for operations without logging post text.

Discussion emails have a separate configurable allowance, initially 250 attempts
per UTC day, so discussion activity cannot consume account-confirmation or
password-recovery capacity. Failed attempts consume the allowance. Exhaustion
skips email delivery while preserving the post.

Email identifies the sender and track and links directly to the comment, without
including discussion text that might later be edited, deleted, or made private.
Send only to active recipients with currently confirmed email, notifications
enabled, and current track access. Skipped notifications are not sent retroactively.
Account settings provide one discussion-email toggle, enabled initially, and an
English/Spanish email-language preference. Initialize the language from the
current site language when that preference is saved; default to English until
a preference exists.

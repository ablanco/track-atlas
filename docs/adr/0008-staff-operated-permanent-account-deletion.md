# Staff-operated permanent account deletion with resumable cleanup

Accepted on 2026-11-03. Implementation is authorized by the approved
[legal-pages design](../legal-pages-design.md).

Email-requested account erasure uses a staff-invoked server command with dry run,
explicit account-ID confirmation, and last-active-administrator protection.
Staff verify control of the registered email before execution. Permanent deletion
removes the user's account, content, contributions, and legal-acceptance evidence
rather than keeping an anonymized account; deleting an authored comment also
removes its attached owner's reply. This accepts loss of discussion context in
exchange for complete removal of the account's contributions. Public document
history remains independently available.

Deletion first withdraws account access and revokes sessions, then completes
retryable storage cleanup and final database removal. In-flight uploads and
storage failures require temporary cleanup bookkeeping, so a pending operation
must not be reported as complete. The email is reusable after completion. Shared
anti-abuse protections keep their existing windows; request correspondence and
provider-side follow-up remain staff responsibilities.

This extends ADR-0002's earlier deferral of permanent deletion with a dedicated
operator command, without adding a public deletion endpoint. ADR-0004 and
ADR-0005 continue to retain votes and discussion during reversible deactivation;
permanent deletion removes them. ADR-0001's protection against delayed upload
retries must remain effective during erasure, until the removed account can no
longer authorize creation and outstanding storage writes are safely handled.

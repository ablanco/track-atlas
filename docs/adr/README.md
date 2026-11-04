# Architecture decisions

[Documentation index](../README.md) · [Glossary](../../GLOSSARY.md)

These records explain accepted choices and their consequences. Read the relevant
record before changing a boundary; current implementation is described in the
[architecture reference](../../ARCHITECTURE.md). Preserve superseded rationale
and link any replacement decision.

| ADR  | Decision                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 0001 | [Retain upload identities after track deletion](0001-retain-deleted-upload-identities.md)                             |
| 0002 | [Administrative access with model-specific operations](0002-administration-access-and-model-boundaries.md)            |
| 0003 | [Preserve track photo originals without sharing them through track access](0003-track-photo-original-access.md)       |
| 0004 | [Retain track votes across visibility and account deactivation](0004-track-vote-retention.md)                         |
| 0005 | [Retain track comments with restricted administrative mutation](0005-track-comment-retention-and-administration.md)   |
| 0006 | [Best-effort discussion emails with a separate sending allowance](0006-best-effort-discussion-email-notifications.md) |
| 0007 | [Versioned legal acceptance for new and existing accounts](0007-versioned-legal-acceptance.md)                        |
| 0008 | [Staff-operated permanent account deletion with resumable cleanup](0008-staff-operated-permanent-account-deletion.md) |

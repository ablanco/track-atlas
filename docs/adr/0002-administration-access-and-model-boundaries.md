# Administrative access with model-specific operations

Accepted on 2026-10-28. Implementation specification:
[GitHub issue #22](https://github.com/ablanco/track-atlas/issues/22).

The planned admin panel permits active, authenticated users with `admin = true`
to administer other users' accounts and data, including private tracks, lists,
and uploaded files. This is an explicit exception to owner-only access through
administration; ownership and ordinary site access remain unchanged. Passwords,
credential hashes, and account-link secrets must never appear in admin responses.

All application models will be discoverable in the sidebar, but operations are
defined per model rather than exposing arbitrary database CRUD. Generated track
data is read-only; security records support purpose-specific operations that
preserve replay protection, email limits, and the retained upload identities
required by ADR-0001. Track and file deletion preserve lifecycle orchestration,
including storage cleanup, rather than deleting database rows directly.

The initial scope includes lists, details, editing, server-side search, sorting,
pagination, relevant filters, and confirmed bulk deletion where supported. It
excludes record creation and administrative change history. Account management
includes profile editing, deactivation/reactivation, and granting/revoking admin
status; permanent account deletion is deferred and password management uses the
existing reset flow. Removing the last active administrator and deleting or
deactivating one's own account must be prevented.

## Accepted capabilities

All models have list and detail pages. Users support profile editing,
deactivation/reactivation, and admin changes. Tracks support editing name,
description, activity, difficulty, visibility, and tags, plus deletion. Lists
support rename and deletion; memberships support removal. Stored files support
eligible deletion through storage cleanup, including clearing a current avatar.
Sessions and outstanding account links support revocation. Tags are edited through
their parent track. Track data, directional representations, CAPTCHA uses, email
limits, upload attempts, and deleted-upload identities are read-only. Ownership,
IDs, timestamps, derived values, and storage bookkeeping are immutable. Admins
can inspect retained data belonging to deactivated accounts.

Editable user profile fields are first name, last name, display name, date of
birth, and email. Email changes clear confirmation, invalidate outstanding
account links, revoke all target-account sessions, and send confirmation to the
new address. Email-confirmed status remains read-only. Administrators cannot
revoke their own admin status or revoke their current session through admin
actions; ordinary logout remains available. Changes to another administrator's
permissions take effect on their next request.

Bulk selection applies only to the current page, clears when the query changes,
and supports page sizes of 25, 50, or 100. Confirmation shows affected records and
deletion consequences. Each bulk operation is one database transaction; physical
file removal can finish later through cleanup. Saves do not detect concurrent
edits: a later save may overwrite an earlier edit.

The localized `/en/admin` and `/es/admin` entry pages show a statistics overview,
with an Overview sidebar entry. They do not open on Users. The account menu exposes
administration only to administrators. The layout uses the reference dashboard's
sidebar/table direction with existing site components, both languages and themes,
and a collapsible mobile sidebar. Details link related records, and returning to
a list preserves filters.

## Overview and presentation

The overview shows current user totals with active/deactivated, admin, and
email-confirmed breakdowns; public/private track totals; pending/ready/deleting
file totals; storage quota usage including reservations; and list/membership
totals. Cards link to corresponding model lists, filtered where applicable.
Historical charts are excluded initially because retained records cannot
reconstruct complete history.

Default list columns are:

| Model            | Columns                                                           |
| ---------------- | ----------------------------------------------------------------- |
| Users            | Name, email, active, admin, email confirmed, created              |
| Tracks           | Name, owner, activity, visibility, distance, created              |
| Stored files     | ID, owner, purpose, status, size, created                         |
| Track lists      | Name, owner, membership count, created                            |
| List memberships | List, track, created                                              |
| Sessions         | User, expiry, created                                             |
| Account links    | User, purpose, expiry, consumed/revoked status                    |
| Other models     | Record/parent identifiers, relevant status or summary, timestamps |

Details expose full safe metadata; large geometry/sample data is summarized and
paginated. Read-only rows have no selection checkbox.

If confirmation delivery fails after an email change, the new address remains
saved and unconfirmed. The UI reports that the email was updated but confirmation
could not be sent. Session and account-link revocation remain effective. The
existing confirmation flow and sending limits govern retries; the old address is
not silently restored.

These decisions were accepted during design; the panel is not yet implemented.
The overall design was confirmed on 2026-10-28; the interview is complete.

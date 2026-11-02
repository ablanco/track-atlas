# Retain track comments with restricted administrative mutation

Accepted during feature design on 2026-11-02; implemented through migration
`0020_track_comments`, the discussion services/UI, and admin controls in
[issue #28](https://github.com/ablanco/track-atlas/issues/28).

Track comments and owner replies follow track visibility, survive visibility
changes, and are permanently removed with the track. Deactivating a commenter
retains their text but replaces their displayed identity with "Deactivated user"
and a generic avatar. Active authors are represented by their current display
name and avatar. This preserves discussion through reversible account and track
changes while withdrawing a deactivated author's displayed identity.

Comment authors and track owners cannot edit or delete posts through the ordinary
site. Administrators can view, edit, and delete comments and owner replies through
the admin panel, an explicit exception to otherwise final posts. Only text is
editable; authors, associations, and original posting timestamps are immutable.
There is no public edit marker or administrative edit history, consistent with
ADR-0002. Administrative access does not grant ordinary-site ownership or reply
rights. Deleting a comment permanently removes its reply; deleting only a reply
allows the owner to reply again. The one-reply limit concerns existing replies,
not the lifetime number of replies.

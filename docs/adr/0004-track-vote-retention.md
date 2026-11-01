# Retain track votes across visibility and account deactivation

Accepted during feature design on 2026-11-01; implemented in migration
`0019_slimy_tigra` and the track vote service.

Track votes survive a track becoming private and count again when it becomes
public. Votes cast by deactivated users remain counted. Track deletion removes
its votes. These rules preserve votes through reversible visibility and account
changes rather than treating those changes as vote withdrawal. Only active,
signed-in users with confirmed email may vote, and only on public tracks owned
by someone else. Administrators may inspect votes but cannot edit them or
override derived popularity.

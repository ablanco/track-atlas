# Retain upload identities after track deletion

Deleting a track removes its content and original GPX, but retains the owner's
upload request ID and the deleted track ID independently of file cleanup. Removing
the completed upload receipt alone would allow delayed creation retries to
recreate a track the owner deliberately deleted. Retaining these minimal
identifiers, without track metadata or GPX content, prevents recreation and makes
deletion retries safe after a lost acknowledgement; a deliberate new upload must
use a new request ID.

With [ADR 0010](0010-import-multiple-gpx-tracks-independently.md), one attempt can
create multiple independent Tracks. Deleting any output blocks creation retries
of that entire attempt, while retaining each deleted Track's minimal identity
and leaving surviving siblings independently accessible and editable.

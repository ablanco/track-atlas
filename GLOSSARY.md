# Track Atlas

Language for tracks and profile images in Track Atlas.

## Language

### Tracks

**Track**:
A user's named and described path, imported from one continuous GPX track segment and classified by activity, difficulty, and tags. Activities may be human-powered or motorized.
_Avoid_: Route (a GPX route is a different input structure)

**Activity type**:
The single outdoor activity a track is intended for, selected by its uploader from a controlled list.
_Avoid_: Activity tag

**Difficulty**:
The uploader's assessment of a track's difficulty for its selected activity, on a scale from 1 (least difficult) to 5 (most difficult). It is not a difficulty rating inferred from the GPX.

**Recorded duration**:
The elapsed time from a track's first recorded point to its last, including stops. It is unavailable when timestamps are incomplete or not strictly increasing.
_Avoid_: Moving time

**Tag**:
A user-created label describing a track, separate from its activity type and difficulty.

**GPX original**:
The uploaded GPX file, retained unchanged as the source of the track's recorded points.
_Avoid_: Simplified representation

**Directional representation**:
A search aid joining the track's start and end through zero or more intermediate points chosen at equal distances along the track. It is not a replacement for the original path on the details map.
_Avoid_: Map simplification

**Public track**:
A track whose details and GPX data can be viewed without signing in.

**Private track**:
A track whose details and GPX data are accessible only to its owner.

### Profile images

**Avatar**:
An optional profile image selected by a user to represent them in the site.
_Avoid_: Profile photo (an avatar need not be a photograph)

**Avatar original**:
The user's uploaded avatar image, retained unchanged rather than used for site display.
_Avoid_: Display image

**Avatar version**:
A display-ready image derived from the avatar original for a particular display size.
_Avoid_: Original, separate avatar

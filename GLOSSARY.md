# Track Atlas

Shared domain language for accounts, uploaded files, tracks, and recorded-track
measurements in Track Atlas. Definitions describe domain concepts, not
implementation mechanisms or feature availability.

## Language

### Accounts and identity

**User**:
A person registered with Track Atlas who holds an account and can own files and tracks. Owner and uploader describe roles of a user, not separate kinds of person.

**Account**:
A user's registered identity, credentials, profile, and access status in Track Atlas. An account can be active or deactivated independently of whether its email is confirmed.

**Administrator**:
A user granted access to administer accounts and site data, including other users' private tracks, lists, and uploaded files. Administrative access does not transfer ownership.

**Active account**:
An account permitted to sign in and use authenticated features. Active status alone does not establish current legal acceptance, email confirmation, or eligibility to upload tracks.

**Deactivated account**:
An account disabled from signing in or using authenticated features, whose tracks are no longer accessible. Its data and email reservation are retained; deactivation is not deletion.
_Avoid_: Deleted account

**Profile**:
The personal information associated with an account, including names, email, date of birth, and optional avatar. It is not a public profile page.

**Account deletion**:
Permanent removal of a user's registered identity and associated account data. It is irreversible and distinct from reversible account deactivation.
_Avoid_: Account deactivation

**Display name**:
An optional name chosen by a user for their displayed identity. When absent, the displayed identity uses the first name and surname initial rather than the full surname.
_Avoid_: Username, unique handle

**Email confirmation**:
Establishment of control over the account's registered email address through its confirmation link. Confirmation is required to create tracks, but not to sign in.
_Avoid_: Account activation, identity verification

**Session**:
A time-limited signed-in relationship with an active account. One account may have multiple sessions; logging out ends only the current session.

**Password change**:
Replacement of a password authorized by a signed-in session. It preserves the current session while ending the account's other sessions and invalidating outstanding password-reset links.

**Password reset**:
Replacement of a password authorized by a password-reset link rather than an existing session. It ends all sessions for the target account, does not confirm email, and does not automatically sign the user in.
_Avoid_: Password change

**Account link**:
An expiring, single-use authorization for one account and one purpose: email confirmation or password reset. Successful use invalidates the account's other outstanding links for that same purpose.
_Avoid_: Login link, session

**Authentication proof**:
A single-use solution to a bot-protection challenge for either signup or login. It is specific to that purpose and does not establish identity or email ownership.
_Avoid_: Email confirmation, authentication credential

### Legal documents

**Terms acceptance**:
A user's explicit agreement to an identified version of Track Atlas's Terms and Conditions. It is distinct from acknowledging the Privacy Policy.

**Privacy acknowledgment**:
A user's explicit confirmation that they have read an identified version of Track Atlas's Privacy Policy. It is not consent to optional processing of personal data.
_Avoid_: Privacy consent

### Account email

**Account email**:
A message carrying an email-confirmation or password-reset link for an account. Acceptance for sending is not proof of delivery, email confirmation, or successful password reset.

**Email request allowance**:
The allowance for requesting account email for a particular address and purpose, including requests for addresses with no active account. It is separate from the shared sending budget, and failed delivery does not restore an admitted request.

**Daily sending budget**:
The application-wide allowance for account-email sending attempts in a UTC day, shared across addresses and both account-link purposes. It counts attempts, not confirmed deliveries.

### Files and profile images

**Uploaded file**:
A user-owned file accepted for an avatar, GPX, or track photo purpose. A file upload alone does not create a Track or make its contents public.

**File owner**:
The user to whom an uploaded file belongs. Owning a file is distinct from being permitted to view a public track backed by that file.

**Pending upload**:
An unfinished file upload with reserved storage allowance. It is not available as a completed file and can expire without becoming one.

**Ready file**:
A completed uploaded file available for its permitted uses. Readiness does not make a file public.

**File pending deletion**:
An uploaded file withdrawn from use whose stored contents are awaiting removal or a removal retry. It continues to count against the owner's storage quota until cleanup finishes.

**Storage quota**:
An account's allowance for uploaded-file count, stored bytes, and simultaneous pending uploads. Avatar versions, unfinished reservations, and files pending deletion contribute to that allowance.

**Avatar**:
An optional profile image selected by a user to represent them in the site. Its current display version may also accompany a track that a viewer is permitted to access.
_Avoid_: Profile photo (an avatar need not be a photograph)

**Avatar original**:
The user's uploaded avatar image, retained unchanged rather than used for site display. It may retain embedded personal or location information and is not shared through track access.
_Avoid_: Display image

**Avatar version**:
A display-ready image derived from the avatar original for a particular display size. It represents the same avatar, not a separate profile image.
_Avoid_: Original, separate avatar

### Tracks and access

**Track photo**:
A photograph uploaded by the track owner to accompany a track, with a position in its gallery and an optional caption. Its display versions follow track visibility; it is distinct from the uploader's avatar.

**Track photo original**:
The uploaded track photograph retained unchanged as the source of its display versions. It may retain personal or location metadata and is accessible only to its owner and administrators acting through administration.

**Track photo version**:
A display-ready image derived from a track photo original for a particular display size and image format. Versions represent the same photograph, not additional track photos.

**Track preview image**:
The image representing a public track when its link is shared: its first gallery photo, or the shared Track Atlas image when the track has no photos. It is distinct from a track photo original.

**Track**:
A user's named and described path, comprising the ordered segments of one GPX track and classified by activity and difficulty, with optional tags. Activities may be human-powered or motorized.
_Avoid_: Route (a GPX route is a different input structure)

**Track owner**:
The user who uploaded and owns a track. Ownership does not imply authorship of the GPX recording or that the user personally traveled the path.
_Avoid_: Recorder, GPX author

**Track vote**:
A user's single current thumbs-up or thumbs-down assessment of a track. The user can withdraw it or change its direction.

**Track popularity**:
The number of thumbs-up votes on a track minus its number of thumbs-down votes. Popularity can be negative.
_Avoid_: Average rating, vote count

**Uploader**:
The track owner in their role as the person who submitted the track to Track Atlas. The identity and avatar shown with a track reflect that user's current profile, not a snapshot taken at upload.
_Avoid_: Recording author

**Collection**:
The tracks owned by one user, including both public and private tracks. Other viewers can see only its public tracks, except administrators acting through administration; tracks owned by other users do not belong to this collection.
_Avoid_: Bookmarks, saved tracks

**Track list**:
A named private grouping of tracks chosen by a user, visible and editable by that user and by administrators acting through administration. A track may belong to multiple lists; membership neither transfers ownership nor grants access to the track.
_Avoid_: Collection

**Activity type**:
The single outdoor activity a track is intended for, selected by its uploader from a controlled list.
_Avoid_: Activity tag

**Difficulty**:
The uploader's assessment of a track's difficulty for its selected activity, on a scale from 1 (least difficult) to 5 (most difficult). It is not a difficulty rating inferred from the GPX.

**Tag**:
An optional user-created label describing a track, separate from its activity type and difficulty. Labels that differ only in case or equivalent Unicode spelling count as the same tag on that track.

**Track visibility**:
The access classification of a track: private or public. Visibility applies to its details, recorded path, measurements, Track GPX download, track photo display versions and captions, and associated uploader display identity/avatar. It does not grant access to track photo originals.

**Public track**:
A track whose details, recorded path, measurements, and uploader display identity/avatar version are viewable without signing in while its owner's account remains active. Downloading its Track GPX requires a signed-in account with current legal acceptance; public visibility does not expose the uploader's private profile or avatar original.

**Private track**:
A track whose details and GPX data are accessible to its signed-in owner while the account remains active, and to administrators acting through administration. Private is the default visibility for a new track.

**Track deletion**:
Permanent removal of a track, its descriptive information, recorded path, measurements, stored Track GPX, and track photos including their originals and display versions. It has no undo and is distinct from making a track private or deactivating its owner's account.

**Track upload attempt**:
One logical submission of track metadata and a GPX file, whose retries refer to the same intended creation of one or more Tracks. A deliberate new submission of the same GPX can create new Tracks; matching file contents alone do not identify an attempt.

### Track comments

**Track comment**:
A text message left by a signed-in user with confirmed email on a track, sharing that track's visibility. It is distinct from the track owner's reply.

**Owner reply**:
The track owner's single text response to a track comment, displayed beneath that comment. An owner reply cannot receive further replies.
_Avoid_: Reply thread, nested conversation

**Comment notification**:
An email notifying a track owner that someone has left a comment on their track.

**Reply notification**:
An email notifying a comment's author that the track owner has replied to their comment.

### Recorded path and representations

**GPX original**:
The unchanged uploaded GPX document, which may contain multiple GPX tracks and information beyond their recorded paths. It is distinct from a standalone GPX prepared for one Track.
_Avoid_: Simplified representation

**Track GPX**:
A downloadable GPX document for one Track, containing its recorded segments without sibling GPX tracks. For a singleton upload it is the byte-exact GPX original. For a multi-track upload it is a standalone document preserving recorded values, names, segments and track-local extensions, while omitting document-wide metadata, waypoints, extensions and sibling tracks.

**GPX track segment**:
One ordered sequence of recorded track points within a GPX track. A segment boundary marks a break in the recorded path, even when adjacent segments share an endpoint.

**Recorded point**:
An ordered position within an imported GPX track segment, with optional recorded elevation and timestamp. Repeated positions remain separate recorded points.
_Avoid_: Waypoint (a separate GPX structure)

**Full track geometry**:
The complete ordered path through all imported recorded positions, preserving segment breaks, repeated positions, and loops. It is the path shown on the details map, not a directional representation.
_Avoid_: Simplified track

**Track sample**:
A measurement associated with a recorded point: cumulative distance, optional elevation, and optional average speed over the preceding interval within its segment. The first sample of each segment has no preceding-interval speed.

**Directional representation**:
A search aid representing each GPX track segment separately through its endpoints and zero or more intermediate points chosen at equal distances along that segment. It preserves segment breaks and does not replace the original path on the details map.
_Avoid_: Map simplification

**Directionless edge**:
A connection between geographically coincident positions in a directional representation, with no travel direction to assign. It is not evidence that the recorded track has zero length.

**Viewport filter**:
A geographic search constraint matching tracks with at least one of the seven sampled vertices of any GPX track segment inside or on the boundary of the viewed map area. It is approximate: a track can cross the area without a sampled vertex inside it.

**Arrow filter**:
A geographic search constraint matching a non-directionless edge of any GPX track segment's six-edge directional representation within the search corridor and within 30 degrees of the drawn arrow's start-to-end direction, following recorded travel order.

**Line filter**:
A geographic search constraint matching a non-directionless edge of any GPX track segment's six-edge directional representation within the search corridor and within 30 degrees of a drawn line in either direction of travel.

**Search corridor**:
The geographic area within a chosen distance of a finite drawn arrow or line, including its endpoints. The distance applies on either side of the drawing and remains unchanged when the map is zoomed.

### Measurements and data quality

**Track length**:
The sum of surface distances between consecutive recorded positions within each segment, including loops and repeated travel. It excludes distances across segment breaks and elevation changes.
_Avoid_: Straight-line distance, three-dimensional distance

**Cumulative distance**:
The sum of within-segment distances from the track's first point to a particular sample, with no distance added across segment breaks. It is the distance axis for elevation and interval-average speed charts.

**Point count**:
The number of recorded points across the imported segments, including repeated positions. It does not count other locations or waypoints in the GPX original.

**Recorded duration**:
The sum of elapsed times from the first to last recorded point of each segment, including stops within segments and excluding gaps between segments. It is unavailable unless every segment has complete, strictly increasing timestamps; timestamps need not increase across segment boundaries.
_Avoid_: Moving time

**Interval-average speed**:
The surface distance between consecutive recorded points within one segment divided by their elapsed time, available only when both timestamps are usable and increasing. Valid intervals can remain available even when the whole track's recorded duration is unavailable.
_Avoid_: Instantaneous speed, whole-track average speed

**Recorded elevation**:
The elevation supplied for a recorded point by the GPX, without smoothing or external elevation enrichment. It may be absent and is not inferred from the basemap or terrain.

**Elevation coverage**:
The completeness of recorded elevation across all points in all of a track's segments: complete, partial, or absent. Partial coverage permits observed extrema and range, but not cumulative ascent or descent.

**Minimum elevation**:
The lowest available recorded elevation on a track. With partial elevation coverage it describes only the observed points, not necessarily the lowest point of the whole path.

**Maximum elevation**:
The highest available recorded elevation on a track. With partial elevation coverage it describes only the observed points, not necessarily the highest point of the whole path.

**Elevation range**:
The difference between a track's highest and lowest recorded elevations, qualified when elevation coverage is partial. It is distinct from cumulative ascent or descent and from the largest continuous climb.
_Avoid_: Maximum elevation change

**Ascent**:
The sum of positive elevation changes between consecutive recorded points within each segment, available only with complete elevation coverage. It excludes changes across segment breaks and uses raw recorded elevations rather than smoothing out recording noise.
_Avoid_: Elevation range, net elevation gain

**Descent**:
The sum of the magnitudes of negative elevation changes between consecutive recorded points within each segment, available only with complete elevation coverage. It excludes changes across segment breaks and is a nonnegative amount, not a signed net change.
_Avoid_: Elevation range, net elevation loss

**Measurement gap**:
A portion of a track's samples or intervals with unavailable elevation or speed. A gap is missing information, not a zero measurement or an inferred connection between known values.

### Track visualization

**Basemap**:
The geographic background beneath the recorded track on the details map. It is separate from the user's recorded path and does not supply the track's elevation measurements.

**Outdoor basemap**:
A basemap prioritizing paths, tracks, and natural land cover beneath the recorded track. It need not include contours or shaded relief and does not establish trail completeness, safe or permitted access, or the track's recorded elevations.

**Elevation chart**:
A view of recorded elevation against cumulative distance, preserving missing-data gaps and visibly marking segment breaks without connecting segments or adding distance. It is not a terrain-derived elevation profile.

**Interval-average speed chart**:
A view of each usable interval's average speed against cumulative distance, with speed constant over that interval and gaps where timing is unusable. It visibly marks segment breaks without connecting segments or adding distance, and does not imply smooth acceleration between recorded points.

**Chart section**:
A navigable portion of a track chart presented when the full series is too large to show at once. Section boundaries do not split the Track or change its measurements.

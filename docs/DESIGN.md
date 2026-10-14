# Track Atlas — Product Design

## 1. Purpose and scope

Track Atlas is a Next.js website for storing, managing, viewing, and discovering
GPX tracks. Its core experience is map-first: users explore tracks by location,
direction, and track characteristics rather than relying only on a text list.

Users can build a private track collection or publish tracks for others to
discover without signing in.

### Goals

- Upload and manage a personal GPX track collection.
- View and compare multiple tracks on an interactive map.
- Find tracks through spatial, directional, and attribute-based filters.
- Discover public tracks and the people who publish them.

### Out of scope

Track Atlas is **not a GPX track editor**. Users can edit a track's description,
tags, and visibility, but not its geometry or recorded points. An external editor,
such as [gpx.studio](https://gpx.studio/), provides a separate editing experience.

This document describes the intended product, not the current implementation.
Delivery phases and technical choices beyond Next.js remain to be defined.

## 2. Users, ownership, and visibility

- **Visitors** can search and view public tracks and public user profiles without
  signing in.
- **Signed-in users** can upload tracks and manage their own collection,
  including both public and private tracks.
- **Track owners** choose whether each track is public or private and can edit
  its details.

Public profiles show only the user's public tracks. A user's private collection
shows only their own tracks, not private tracks belonging to other users.

Only public tracks can be shared. Private tracks are accessible only to their
owner, with no private sharing links or access grants to other users. Owners must
publish a track before sharing it.

Private-track access must be enforced beyond the search interface, including
direct detail-page and download requests.

## 3. Pages and primary flows

| Page | Audience | Purpose |
| --- | --- | --- |
| Home | Everyone | Explain Track Atlas and introduce track discovery and personal collections. |
| Public search | Everyone | Explore public tracks using a map and filters. |
| Public user profile | Everyone | View a user's public tracks on a map. |
| Track details | Everyone for public tracks; owner only for private tracks | View an individual track and its supporting information. |
| My tracks | Signed-in users | Search, view, and manage their own public and private tracks on a map. |
| Upload wizard | Signed-in users | Upload a GPX track and supply its details and visibility. |
| Edit track details | Track owner | Update metadata and visibility without editing the GPX geometry. |
| Signup wizard | New users | Create an account. |
| Settings | Signed-in users | Manage account settings; the specific settings are not yet defined. |

### Discover a track

Open public search, explore an area on the map, refine the results, and open a
track's details. A public profile offers the same discovery experience scoped
to one uploader's public tracks.

### Add and manage a track

Sign up or sign in, upload a GPX file, supply its details, and choose its
visibility. The track becomes part of the owner's collection, where they can
find it again and edit its metadata. Public tracks also appear in public search
and on the owner's public profile.

## 4. Track data and upload processing

Each track has GPX data, an owner, a visibility setting, an uploader-provided
description, and tags. Search also needs derived attributes such as track length
and elevation changes.

On upload, the system generates simplified directional representations to compare
tracks against a search arrow using proximity thresholds and angular tolerances.
The proposed representations include:

- A single vector from the start to the end.
- A two-segment path from the start through the midpoint by track length to the end.
- More detailed paths with three, four, or five intermediate points.

Intermediate points are chosen based on cumulative distance along the track,
rather than timestamps or the number of recorded GPX points. The midpoint is
halfway along the track's length, not halfway between its start and end coordinates.
Multiple intermediate points divide the original track into equal-length
segments. For a track of length `L` with `n` intermediate points, point `i` lies
at cumulative distance `i × L / (n + 1)`, for `i = 1, …, n`. For example, three
intermediate points lie at 25%, 50%, and 75% of the track's length. Equal lengths
refer to distances along the original track, not the straight-line segments of
the simplified representation.

These representations provide the geometry used for proximity and direction
comparisons in directional search. They are search aids, not user-edited
replacements for the uploaded track.

### Tags and attributes

Candidate tag categories include activity, difficulty, and excitement. The tag
taxonomy, allowed values, and whether users can create their own tags are not
yet defined. Length and elevation changes are separate numeric filters.

## 5. Map-first search

Public search and My tracks share the following intended behavior, with results
restricted to the appropriate visibility and ownership scope.

### Viewport filtering

The current map bounding box automatically limits results to tracks that pass
through the visible area, including tracks whose start and end lie outside it.
Simplified representations may help retrieve candidates, but must not silently
redefine what counts as passing through the area.

### Track comparison

Users can show or hide individual result tracks on the map. Multiple tracks
can be visible at the same time for comparison.

### Directional search

Users draw an arrow on the map to find nearby tracks that travel in roughly
that direction. The search compares the arrow against the track's simplified
directional representations, using:

- A **proximity threshold** to determine whether the simplified geometry is near
  the search arrow.
- An **angular tolerance** to determine whether its direction is sufficiently
  aligned with the arrow.

The threshold and tolerance values, how comparisons across representations and
their segments are combined into a match, and result ranking remain to be defined.

### Attribute filtering

Users can narrow results by tags, length, and elevation changes. The meaning of
elevation changes—for example, ascent, descent, or elevation range—must be
specified before implementation.

## 6. Track details

A track's detail page includes:

- An interactive map showing the track.
- The uploader's description.
- A weather forecast for the track's area over the next few days.
- A GPX download action.
- An action to open the track in [gpx.studio](https://gpx.studio/).
- Thumbs-up and thumbs-down actions with their counts.
- A comments section.

The same visibility rules apply to the track's details and GPX data. External
editor integration must account for private tracks rather than assuming a
publicly accessible download URL.

## 7. Open decisions

The following questions need answers before their respective features are built:

- **Delivery scope:** Which features belong in the first release, and which
  follow later?
- **Upload behavior:** What GPX structures, file sizes, and multi-track files are
  supported? How are invalid files and processing failures presented?
- **Visibility:** What is the default for new uploads?
- **Collection management:** Can owners delete tracks, and what happens to
  associated comments and votes when a track is deleted or made private?
- **Search semantics:** What proximity threshold and angular tolerance are used,
  how are comparisons across simplified representations and their segments
  combined and ranked, and how are loops and multi-segment tracks handled?
- **Search interaction:** How do results update as the map moves, how are large
  result sets handled, and do selected tracks remain visible outside the viewport?
- **Metadata:** Which fields are required, what is the tag taxonomy, and how are
  length and elevation values calculated?
- **Community features:** Who can vote or comment, and what moderation and
  duplicate-vote rules apply?
- **External services:** Which map and weather providers are used, how is a
  forecast location chosen for long tracks, and how does opening GPX data in
  gpx.studio work?
- **Accounts and architecture:** What account settings are available, and how
  will authentication, GPX storage, spatial indexing, and upload processing work?

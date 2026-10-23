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

| Page                | Audience                                                  | Purpose                                                                     |
| ------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Home                | Everyone                                                  | Explain Track Atlas and introduce track discovery and personal collections. |
| Public search       | Everyone                                                  | Explore public tracks using a map and filters.                              |
| Public user profile | Everyone                                                  | View a user's public tracks on a map.                                       |
| Track details       | Everyone for public tracks; owner only for private tracks | View an individual track and its supporting information.                    |
| My tracks           | Signed-in users                                           | Search, view, and manage their own public and private tracks on a map.      |
| Upload wizard       | Signed-in users                                           | Upload a GPX track and supply its details and visibility.                   |
| Edit track details  | Track owner                                               | Update metadata and visibility without editing the GPX geometry.            |
| Signup page         | Signed-out visitors                                       | Create an account and sign in, then return to the homepage.                 |
| Settings            | Signed-in users                                           | Manage account settings; the specific settings are not yet defined.         |

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

### Initial explore delivery — agreed decisions

Implementation specification: [GitHub issue #6](https://github.com/ablanco/track-atlas/issues/6).

The shared explore experience serves public search, another user's collection,
and the signed-in owner's collection. A collection contains that user's uploaded
tracks, not bookmarks of tracks belonging to others. Public search includes only
public tracks, even for signed-in owners. Owners see both visibility classes in
their own collection; other viewers see only public tracks. Existing active-account
access restrictions continue to apply.

On desktop, the experience fills the page with a full-width top bar, a left
sidebar, and a map occupying the remaining space. The top bar contains text search
over track titles and tags and optional filters. The sidebar shows a page of up to
**10 tracks**, with pagination at the bottom. Each entry shows the uploader's small
avatar and displayed name, track title, activity, difficulty, and length. All tracks
on that page appear on the map in different colors. Hovering an entry highlights
its track; clicking a map track scrolls to and highlights its sidebar entry.

Filters include multiple activity selections, a shadcn distance range slider,
five difficulty toggles permitting multiple selections, and a single slider for
the maximum permitted elevation range (highest minus lowest recorded elevation).
Selected values within activity or difficulty are alternatives; text and the
different filter categories must all match. No selection means unrestricted.

Results are ordered by newest upload first with a stable tie-breaker; no sorting
control is included initially. Search and filter changes reset pagination to the
first page. Typing updates results after a short debounce, sliders apply on
release, and toggles apply immediately. Search, filters, and page are reflected in
the URL for refresh, sharing, and browser Back navigation.

Text matching uses case- and accent-insensitive substrings. Every query word must
match somewhere in the title or tags; different words may match different fields.
Descriptions, fuzzy matching, and relevance ranking are outside this delivery.

An active elevation-range filter requires complete elevation coverage. Tracks with
partial or absent elevations remain eligible when that filter is inactive. Slider
bounds are derived from tracks accessible in the current scope before applying
other filters and stay stable while filtering. Limits are inclusive; the uppermost
position means no maximum. Numeric inputs accompany sliders for precise values.

On entry and after each result change, including pagination, the map fits the
current page's tracks. Manual pan/zoom never filters results; hover and selection
preserve the camera. The explorer may use dedicated shape-preserving display
simplifications to keep large result sets practical. Directional search
representations are not display simplifications; track details retain the full
recorded path and GPX originals remain unchanged.

Clicking a track selects it until results change. Hover temporarily highlights a
track, restoring the selected highlight on mouse leave. Keyboard focus on an entry
also highlights its path. Clicking overlapping paths offers a chooser of track
titles. Each entry has a matching color marker. Clicking the title opens details;
clicking elsewhere in the entry selects the track without leaving exploration.

Collections identify their owner by displayed name and avatar. The owner's view
defaults to all their tracks and offers All/Public/Private visibility options and
private badges. Editing and deletion are outside the explorer's scope and belong
on track details.

Pagination shows total matching count, current page, and numbered pages. Changing
page resets list scroll. If results shrink, use the last valid page. No matches
offers a clear-filters action; an empty collection has a distinct message. A path
loading failure marks the affected entry and offers retry while retaining the
other results. Basemap failure leaves the list and pagination usable.

Mobile initially shows the list, with a List/Map switch for the same result page
and access to search and filters. Selecting a map track switches to the list and
reveals that entry.

Map-based searching, including viewport and directional filtering, is deferred.
The initial delivery renders every track on the current page, without individual
show/hide controls. The sections below describe later ambitions, not requirements
for this delivery.

Public search uses `/[locale]/tracks`; collections use
`/[locale]/users/[id]/tracks`. My tracks links to the signed-in user's collection.
Uploader names and avatars link to that uploader's collection. The same collection
URL includes private tracks only for its authenticated owner. Other visitors ignore
owner-only visibility options and see public tracks only. Missing or deactivated
users produce not-found pages; active users with no public tracks have an empty
collection state.

The page retains brand, account, language, and theme controls at the top, followed
by search and filters. The list/map fills the remaining viewport without a footer.
Mobile filters open in a panel. The map reuses existing basemap choices, with zoom
and Fit results controls. Basemap selection persists across result changes. A
track keeps its color while it remains on the page; selection adds line width and
an outline. Matching numbered markers on the map and in list entries identify
tracks without relying on color alone.

The new list becomes usable before all its paths have loaded. Paths appear
progressively with visible loading indicators; paths belonging to the previous
result set are removed. Responses from superseded searches are ignored. URL state
contains search, filters, and pagination, not hover, selection, camera, or mobile
List/Map mode. Shared links open a fresh view fitted to their results.

The initial delivery uses metric units: distance in kilometres and elevation range
in metres. Distance controls use 0.1 km increments; elevation controls use 1 m
increments. Filtering compares stored measurements before display rounding.

### Viewport filtering — later

The current map bounding box automatically limits results to tracks that pass
through the visible area, including tracks whose start and end lie outside it.
Simplified representations may help retrieve candidates, but must not silently
redefine what counts as passing through the area.

### Track comparison — later

Users can show or hide individual result tracks on the map. Multiple tracks
can be visible at the same time for comparison.

### Directional search — later

Users draw an arrow on the map to find nearby tracks that travel in roughly
that direction. The search compares the arrow against the track's simplified
directional representations, using:

- A **proximity threshold** to determine whether the simplified geometry is near
  the search arrow.
- An **angular tolerance** to determine whether its direction is sufficiently
  aligned with the arrow.

The threshold and tolerance values, how comparisons across representations and
their segments are combined into a match, and result ranking remain to be defined.

### Additional attribute filtering — later

The initial delivery uses the filters defined above. Additional measurements such
as ascent and descent may be considered separately; they must not be conflated
with elevation range.

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

## 7. Private track lists — confirmed design

The following decisions were accepted during the private-list design interview.
They describe planned behavior, not an implemented feature. The complete design
was confirmed after all sixteen interview decisions were accepted.
Implementation specification: [GitHub issue #13](https://github.com/ablanco/track-atlas/issues/13).

A track list is separate from an uploaded collection. Each list belongs to one
user, and only that user can see or edit it. Active signed-in users may use lists
without confirming their email. Lists may contain other users' public tracks and
their own public or private tracks. Membership references the original track;
it creates no copy, transfers no ownership, and grants no additional access.
A track may belong to multiple lists.

Bookmark buttons appear on explorer entries and track details. Their popover
shows existing lists with checkboxes: checking adds the track and unchecking
removes it. A filled bookmark means the track belongs to at least one list.
The popover also allows creating a list and adding the track to it. Visitors see
the bookmark action too; it prompts sign-in and returns them to the same page,
without automatically saving the track after sign-in.

The user menu includes My lists, leading to a page of that user's lists. Users
can create empty lists there, rename lists, and delete lists after confirmation.
Deleting a list removes only the list and its memberships, never the tracks.
Names are trimmed, contain 1–100 characters, and are unique within a user's lists
ignoring case. The first version has names and tracks only: no descriptions,
nesting, sharing, or manual ordering.

Opening a list uses the shared explorer with search, filters, map interactions,
and ten-track pagination. The list name appears in the sidebar. Empty lists and
filtered results with no matching tracks have distinct messages.

Track access is checked independently of membership on every read. When a saved
track becomes private to another user, or its uploader deactivates their account,
retain the membership but omit the track from results, counts, bounds, and map
data. Do not show unavailable-track placeholders or retained metadata. The track
reappears if access returns. Permanent track deletion removes its memberships.

List tracks are ordered by most recently added first; removing and re-adding a
track moves it to the top. My lists is ordered by most recently created list.
Removing a track from the list currently being browsed requires no confirmation.
After success, refresh results, counts, and bounds, and clamp the page when needed.

My lists uses simple entries showing the name, accessible-track count, and open,
rename, and delete actions. It has no map or track previews; the empty state
offers Create list. List exploration offers All/Public/Private visibility filters
even for lists mixing uploaders. Private results can only be the viewer's own
private tracks, and no filter expands track access.

Routes are `/[locale]/lists` and `/[locale]/lists/[id]`. Signed-out visitors see a
sign-in prompt preserving the destination. A signed-in user requesting another
user's list receives the same not-found response as for a nonexistent list.

The first version allows at most 100 lists per user and 1,000 memberships per
list. Temporarily inaccessible memberships count toward the membership limit.
Enforce limits on the server and explain when an addition is blocked. My lists
uses twenty-list pagination.

The bookmark picker includes a list-name search and a scrollable checkbox list.
It remains open for multiple changes, and Create list stays available when the
search has no matches. Use the same bounded popover on mobile, with keyboard
support, Escape, and outside dismissal. Each existing-list checkbox change saves
individually, with no Apply button.

Creating a list from a track's picker creates the list and adds that track as
one atomic operation: either both succeed or neither does. On failure, preserve
the entered name and show an inline error.

An open list's explorer sidebar also offers Rename, Delete, and navigation back
to My lists. Renaming preserves the current search and filters. Confirmed list
deletion returns to My lists.

## 8. Open decisions

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

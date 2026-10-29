# Homepage redesign

Status: approved and implemented.

## Approved direction

- Replace the current homepage content with a product-focused landing page.
- Take inspiration from the supplied Going reference: large typography, a deep
  navy/teal hero, orange text highlights, green calls to action, and spacious
  alternating sections, using the Track Atlas palette.
- Lead with composed map/search illustrations and interface previews; use
  outdoor photography as supporting atmosphere.
- Make Explore tracks the primary action, with Upload a track clearly visible
  beside it. Repeat both actions near the bottom. Upload should trigger login
  when required.
- Redesign the homepage from hero through footer, including marketing
  navigation. Preserve application navigation and controls on other pages.
- Support mobile layouts, English/Spanish, and light/dark themes.

## Approved content and interactions

- Section order: hero, advanced map search, activity types, upload/manage tracks,
  free and open source, final actions. The hero includes Explore tracks as its
  dominant action and Upload a track alongside it; both repeat at the bottom.
- Use real product benefits rather than testimonials or popularity counts.
- Provide a lightweight interactive search illustration with Viewport, Arrow,
  and Line tabs and illustrative sample tracks. Explain activity, difficulty,
  distance, and elevation-range filters. Try map search opens the real explorer;
  do not embed the full live map on the homepage.
- Group activity links into on foot, cycling, snow, water, horse riding, and
  motorized, showing the supported types and opening the explorer with matching
  activity filters. Ensure the remaining Other type is also discoverable.
- State Free to use. Open source. Browsing needs no account; uploading needs a
  free account. Link to the MIT-licensed GitHub repository. Do not promise free
  forever or unlimited storage.
- Guest Upload opens login with a signup option. Preserve the upload destination
  through login and signup, requiring email confirmation before uploading.
- Use a small amount of licensed outdoor photography, ideally one landscape
  section, and record its source attribution in the repository.

## Verified product constraints

- Public exploration lives at `/tracks`; upload lives at `/tracks/upload`.
- Spatial search supports viewport, directional arrow, and bidirectional line
  filters. These use sampled directional representations, so marketing must not
  promise exact full-path intersection matching.
- Other filters include activity, difficulty, distance, and elevation range.
  Elevation range is distinct from cumulative ascent.
- Sixteen activity types include human-powered and motorized activities.
- Upload requires a confirmed account. Existing modal login preserves the current
  URL; signup currently redirects home rather than continuing an upload.
- The repository is MIT licensed at https://github.com/ablanco/track-atlas.
  No existing hosted-service free-forever commitment was found.
- Existing homepage copy incorrectly describes some implemented features as
  planned; the replacement should describe current capabilities.

## Approved layout and visual behavior

- Homepage header: Track Atlas brand, Map search and Activities section links,
  direct Explore tracks link, and existing account controls. Provide a compact
  mobile menu for section links. Keep language, theme, and GitHub available in
  the redesigned footer. Other application pages retain their navigation.
- Desktop hero: large benefit-led headline and both actions on the left, layered
  map/search preview on the right. Stack the preview below the actions on mobile.
  Highlight a few headline words in orange and use green for the main Explore
  button, choosing readable foregrounds.
- Keep the hero and final action section dark navy/teal in both themes. Use
  off-white content sections in light mode and navy surfaces in dark mode;
  adapt controls, text, and illustrations for contrast.
- Use subtle search-mode and card-hover transitions. No autoplay, parallax, or
  scroll-triggered reveals. Respect reduced-motion preferences.

## Implementation and verification scope

- Implement the approved composition and interactions using shared brand tokens
  and localized English/Spanish copy. Preserve application theme hydration.
- Keep illustrative search data separate from real maps and geographic overlays.
- Preserve upload intent safely through authentication and email-confirmation
  gating, without allowing arbitrary external redirect destinations.
- Verify mobile/desktop layouts, both languages and themes, keyboard access,
  reduced motion, contrast, and homepage CTA destinations.
- Verify guest login/signup continuation, signed-in upload access, and
  unconfirmed-account behavior using development-only data and captured email.
- Run lint, TypeScript, production build, and relevant homepage/authentication
  unit, database, and browser suites. Report pre-existing or new failures.
- Update architecture documentation for the implemented homepage and auth flow.

## Approval

The complete plan was confirmed before implementation.

## Verification results

- `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`, changed-file formatting,
  and `git diff --check` pass.
- All 19 HTTP/localization checks, 152 authentication unit tests, and 128
  authentication/database tests pass.
- All 87 selected browser scenarios pass across the main run and targeted
  reruns. Coverage includes English/Spanish, mobile/desktop, light/dark,
  keyboard-operated search tabs, reduced motion, native language navigation,
  saved/system themes and pre-hydration behavior, login/signup, captured email
  confirmation, single-use token rejection, CAPTCHA rejection/replay, and
  activity links entering the explorer and returning with Back.
- Browser and database mutations used fresh migrated temporary development
  databases and private captured email; temporary databases were removed.
- An initial new-test pool lifecycle failure was corrected by using the same
  serial suite configuration as the existing authentication browser suites.
  An existing recovery test timed out during the parallel run and passed its
  isolated rerun. No checks remain failing.
- Desktop and mobile screenshots were inspected, including both themes and the
  locally hosted landscape image. Measured text contrast is at least 4.58:1 for
  sampled controls/body copy, and 3.95:1 for the large orange hero headline.
- Path-dependent header/footer markup initially caused hydration mismatches on
  navigation to upload. Stable shells and scoped CSS resolved them. Selectors
  exclude pages hidden by Next's retained-page navigation, preserving application
  chrome and Back navigation. The footer now renders before JavaScript, fixing
  the previously failing no-JavaScript theme-switch check.

## Photograph update

The project owner replaced the stock landscape with their own Pyrenees photo.
The original remains unchanged; 960 × 640 and 1920 × 1280 JPEG/WebP/AVIF
versions serve through a native responsive picture element. The old stock photo
and its credit were removed. Copyright remains with the photographer, separate
from the code's MIT license; see `public/images/ATTRIBUTION.md`.

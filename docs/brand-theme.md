# Track Atlas brand theme

Status: approved and implemented.

## Agreed scope

- Apply shared brand theme tokens throughout the application, including
  authentication, tracks, lists, and administration.
- Support both light and dark themes. Use the exact brand colors as anchors;
  lighter and darker variants are permitted for readable text and controls.
- Replace the top-bar icon with `logos/track-atlas-mark.svg`, retaining the
  existing Track Atlas wordmark. This custom brand artwork is distinct from
  the Phosphor icons used for application controls.
- Preserve the current theme preference and hydration behavior.

## Brand palette

| Color            | Value     | Supplied role          |
| ---------------- | --------- | ---------------------- |
| Deep Navy        | `#073B53` | Primary, text          |
| Atlas Green      | `#168568` | Secondary              |
| Deep Teal        | `#0D5F66` | Supporting brand color |
| Forest Teal      | `#137B69` | Supporting brand color |
| Adventure Orange | `#F36B2B` | Accent, map pin        |
| Warm Off-White   | `#F7F8F4` | Background             |
| White            | `#FFFFFF` | Surface, map track     |

## Color application

- Use navy for primary actions, green for secondary treatments, and restrained
  orange for brand accents and selected highlights. Routine menu hover and
  selection surfaces use subtle green/teal tints rather than solid orange.
- Choose readable foreground colors and theme variants rather than assuming
  white text works on every brand color. Light mode uses the supplied warm
  off-white background, white surfaces, and navy text. Dark mode uses navy-tinted
  backgrounds and light text, with adjusted green/orange where needed.
- Preserve real geographic basemaps, recorded-path colors and outlines, and
  the explorer's ten stable categorical colors and numbered markers. The
  supplied white map track and orange map pin describe branding and illustration
  in this change, not a replacement of geographic overlay colors.
- Separate data colors from action colors: use green for recorded elevation,
  orange for interval-average speed, and distinguishable brand-derived chart
  colors in administration. Adjust brightness for dark mode.
- Recolor the decorative homepage map using navy, green, teal, orange, and
  off-white, with theme variants that distinguish land, water, contours, and
  routes.

## Verification

- Lint, TypeScript (`tsc --noEmit`), production build, and changed-file
  formatting checks passed.
- Text and action color pairs exceed 4.5:1 contrast in both themes. Input
  boundaries and elevation/speed chart strokes exceed 3:1 against their surfaces.
- Browser checks ran against a freshly migrated, isolated development database
  with capture email. Of 35 selected checks, 34 passed: English/Spanish desktop
  and mobile homepages, administration, account menus, mobile settings,
  elevation/speed charts, saved/system preferences, and pre-hydration startup.
  The no-JavaScript footer test failed because the streamed footer was absent;
  the footer's Suspense boundaries are unchanged by this theme change.
- HTTP/localization checks passed 18 of 19 cases. The remaining catalog check's
  existing namespace allowlist omits Admin, ExploreSpatial, Sidebar, and Toast.
  No translation catalogs changed in this work.
- A stale development test cache initially served the previous neutral UI
  palette. Clearing the generated test build restored the updated stylesheet.
- Architecture documentation now describes the implemented theme and logo.

# Existing UI migration to shadcn/ui

## Agreed scope

Adopt the installed Base UI Vega preset and neutral palette across all existing
pages and controls while preserving layouts, content, and user flows. Keep
Phosphor icons, English/Spanish translations, locale-aware links, semantic HTML,
and the map illustration's separate palette. CAPTCHA remains its own widget.

Use shadcn buttons, fields, inputs, alerts, avatars, dialogs, menus, and a theme
switch wherever applicable. Replace custom focus trapping and menu navigation
with Base UI behavior. A small non-modal menu adapter preserves Tab dismissal
when pointer focus remains outside the popup or on portal guards; Base UI owns
arrow-key navigation, positioning, focus restoration, and other dismissal.
Preserve password visibility, validation associations,
error focus, pending/disabled states, dismissal restrictions during submissions,
focus restoration, and scroll position. Language navigation remains links.

Unify the generated Vega theme with the existing data-theme provider and retain
the next-themes hydration patch, system preference, persisted preference, and
pre-hydration styling. Remove conflicting legacy UI tokens and styling rather
than maintain two design systems.

## Approved repository workflow setup

Configure GitHub Issues via `gh`, standard triage labels, and single-context domain
documentation in `docs/agents/`, linked from `AGENTS.md`. The root glossary remains
domain language only; ADRs are created lazily when a decision warrants one.

## Verification

The agreed primary test seam is the rendered browser UI: neutral light/dark
colors, hydration, persistence, locale navigation, keyboard and focus behavior,
responsive forms, dialogs, menus, and full account flows. Existing unit and
migrated development-database tests cover unchanged server behavior. Automated
email delivery must remain capture-only. Run lint, TypeScript, build, unit,
database, HTTP, and browser suites; report any exclusions or failures.

Review the migration against d14ce07eac4a275af600aec179039408c28d0aba along
Standards (AGENTS.md and architecture) and Spec (this document) axes. Work on
master, without creating branches or worktrees.

## Verification results

- Lint, TypeScript no-emit, production build, formatting, and whitespace checks pass.
- 203 unit tests, 157 database/storage integration tests, 19 HTTP tests, and 119
  Chromium tests pass. Browser tests use private capture delivery and local storage.
- Visual checks cover a light desktop homepage, dark Spanish mobile signup, and a
  dark login dialog at the intermediate 600px viewport.

### Standards review

No documented-standard violations found. Fixed the reported competing startup
scripts by isolating saved-theme tests; reused the shared color assertions rather
than duplicating them.

### Spec review

Restored the previous 448px dialog width cap at intermediate viewport sizes and
added a regression test. Retained only the small Tab-dismissal adapter needed to
preserve non-modal menu behavior; Base UI owns the remaining menu machinery.
Workflow documentation was separately approved during scope clarification.

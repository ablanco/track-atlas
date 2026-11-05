# Routing, rendering, and presentation

[Architecture overview](../../ARCHITECTURE.md) · [Documentation index](../README.md)

## Routing and rendering

- `/en` and `/es` render the homepage; `/en/signup` and `/es/signup` render signup.
  The homepage hero includes a prominent localized Explore tracks link to the
  public explorer, available regardless of session state.
- `/en/settings` and `/es/settings` render account settings for authenticated users;
  guests redirect to the localized homepage. Settings metadata excludes indexing.
- `/en/confirm-email`, `/es/confirm-email`, `/en/reset-password`, and
  `/es/reset-password` inspect single-use account links. They do not require an
  existing session; the token supplies authority for the corresponding mutation.
  The proxy adds no-referrer, private/no-store, and noindex/nofollow headers.
- `i18n/routing.ts` uses always-prefixed locales and English as the default.
  `proxy.ts` negotiates unprefixed routes such as `/signup`, excluding API,
  framework, and file paths. Unsupported language prefixes are rejected by the
  locale layout instead of becoming nested locale redirects.
- `i18n/navigation.ts` supplies locale-aware links/navigation. The language
  switcher uses the shared shadcn select with a decorative Phosphor flag and
  native language names. Options come from the supported locales in
  `i18n/routing.ts`, with exhaustive display names in `i18n/languages.ts`.
  Selection navigates immediately, retaining the pathname and existing query
  policies, saving the locale preference, and preserving the theme. Account-link
  selectors retain only a single valid token and do not prefetch destinations.
- `app/[locale]/layout.tsx` is the root layout. It validates the locale, declares
  static locale parameters, loads Geist fonts through `next/font`, and provides
  the shared navigation, theme provider, and translation provider.
- Pages provide localized metadata and language alternates. Translation loading
  uses `next/root-params` and the request configuration in `i18n/request.ts`.

With `cacheComponents` enabled, public shells can be prerendered while
request-specific content streams under Suspense. Homepage Explore/Upload links
are available regardless of session state. Signup's `GuestForm` calls `await connection()` before
authentication and calculating today's UTC date. Signed-in visitors see an
already-signed-in notice and homepage link, or continue to upload when the fixed
upload intent is present, not the signup form; lookup failures
show an unavailable message rather than a registration form. The header auth
control also reads the session at request time under its own Suspense boundary;
failed lookups show unavailable/retry feedback, not a false guest state.
Session-dependent output must not enter a shared public cache.
Settings also calls `connection()` within its Suspense boundary before reading
the cookie and profile. Lookup failures show an unavailable alert without private
fields/forms. Only first/last/display name, email, confirmation status, date of birth, and the
optional avatar file ID reach the settings client. Date of birth remains a date-only `YYYY-MM-DD` string and is
displayed in a read-only date input without timezone conversion.

## Presentation and browser state

The shared header contains the brand, explorer navigation, and account controls.
Below 640px, the explorer link shows only its compass icon while retaining its
localized accessible name; larger screens also show the label. It has no tooltip.
On mobile, the authenticated menu trigger shows only the avatar; desktop also
shows the username and dropdown caret. Missing or failed avatar images fall back
to the first and last name initials. The button retains the full accessible name.
Language navigation, GitHub, and the theme switch live in a shared page footer.
Public, user-collection, and private-list explorer pages hide the footer to
reserve the remaining height for their map and independently scrolling results.
The homepage adds marketing section links and uses a brand footer with language,
theme, and GitHub controls.

`components/ui/` contains the shadcn/ui Base UI Vega primitives used throughout
existing pages: buttons, inputs, fields, alerts, avatars, dialogs, dropdown menus,
and the theme switch. Forms retain React actions and existing server validation;
no client form-state library is introduced. Field errors are associated with inputs
via `aria-describedby`; a focused form-level alert owns error announcements.
CAPTCHA remains the ALTCHA widget, with colors mapped to Vega tokens. Ordinary
page structure and locale navigation retain semantic HTML. File inputs share a
semantic-border vertical divider between the native file chooser button and the
filename, including the avatar and Track upload pickers.

`app/globals.css` owns the Track Atlas brand light/dark semantic colors and radius
scale. Navy, green, teal, orange, off-white, and white anchors feed readable
light and navy-tinted dark treatments; routine hover surfaces use subtle teal
tints, while orange highlights remain restrained. Elevation and speed have
independent green/orange chart tokens, with brand-derived administration series.
`components/brand-mark.tsx` renders the approved compact SVG artwork inline in
the header, preserving its geometry with brand-token fills and a theme-aware
outline; application controls continue to use Phosphor icons. See
[brand theme](../brand-theme.md) for the agreed color roles. The
Tailwind dark variant follows `data-theme`, matching the existing provider rather
than introducing a second class-based theme. `styles/tokens.css` retains spacing,
typography and content width; `styles/themes.css` supplies the map
illustration palette and stable recorded-path overlay tokens. Components use semantic colors, including `foreground` for
body text and `primary` for actions. Global styles include visible keyboard focus
and reduced-motion handling. `components.json` configures the Base UI Vega preset
and Phosphor icons; generated icon imports must still follow the per-icon import
convention.

`next-themes` applies `data-theme` to the document and stores the preference under
`track-atlas-theme` in local storage; the default follows the system. The theme
control is a keyboard-accessible sun/moon switch: checked means dark, and clicking
saves the opposite of the resolved theme as an explicit light/dark preference.
It follows live system changes until an explicit preference is saved; there is no
system option in the control. It stays disabled until hydration, with CSS positioning
the active indicator from `data-theme` even before hydration. The pnpm
patch in `patches/next-themes@0.4.6.patch` retains the startup script for SSR and
hydration but prevents remounting it on client navigation. Preserve and recheck
this behavior when upgrading the dependency.

Icons use individual Phosphor imports appropriate to Server or Client Components.
All password fields use `components/password-input.tsx`: initially masked inputs
using shadcn `InputGroupInput` with a localized `InputGroupButton` inside an
inline-end `InputGroupAddon`, using Phosphor Eye/EyeClosed icons. The input group
owns the shared border, focus ring, and invalid styling; the visibility button
does not overlap the editable input.
Visibility is local to each field; toggling preserves the value, form attributes,
and validation associations without submitting the form. Disabled inputs (including
settings fieldsets) also disable their toggle. Reset forms clear passwords by name
so revealed fields are cleared too.
The signup form uses React `useActionState`, pending-submit feedback, field
errors, and a focused form-level alert after errors. ALTCHA loads after hydration,
uses a native checkbox and local Spanish translations, inherits theme colors,
and resets after an unsuccessful submission. JavaScript is required for signup
verification. `types/altcha.d.ts` covers the upstream Spanish JS/declaration
filename mismatch.

The header login trigger is disabled until hydration. Login and settings
confirmations compose shadcn `Dialog` and `DialogContent` directly from
`components/ui/dialog.tsx`, without an additional modal adapter. Base UI supplies
the portal, overlay, background isolation, scroll lock, focus trapping and
restoration. Callers select initial email/Cancel focus and final trigger focus,
and cancel all dismissal paths while pending. `DialogContent` provides shared
sizing, scroll bounds, and a localized Phosphor close button, disabled through
`closeButtonProps` during pending actions. Closing discards the form/password/proof. Pending login also
disables signup navigation. Unique input IDs and scoped widget lookups allow the
modal to coexist with signup. Confirmation dialogs restore their connected
trigger without scrolling. Destructive controls use Vega's `destructive` token.
Background signup status uses the implicit live-region semantics of `role=status`
without redundant `aria-live`: this avoids the dialog hide-others behavior
mutating individual streamed form descendants before they hydrate.

### Homepage and upload entry

The homepage is a localized marketing page with a dark brand hero, an
illustrative interactive Viewport/Arrow/Line search demo, grouped links for all
supported activity types, GPX ownership benefits, and free-use/MIT open-source
messaging. The final call-to-action section displays the full detailed logo from
`logos/vector-simple.svg`, served as a cleaned SVG asset to the left of the text, on a light circular
background for contrast. The logo and centered text form a centered desktop group;
the logo is hidden on mobile. Its map preview uses sample tracks and makes no network map requests;
real basemaps and explorer overlays retain their existing behavior. A locally
hosted, project-owner photograph of the Pyrenees uses a native `<picture>` with
AVIF/WebP sources and a JPEG fallback, each in 960px and 1920px widths. The
below-fold image loads lazily; the original is not used by the homepage. Ownership
and derivative encoding details are recorded in `public/images/ATTRIBUTION.md`.
The header uses shadcn’s Base UI Navigation Menu for the explorer link, with a
decorative Phosphor compass icon alongside its localized label.
Account controls remain alongside the menu.
Site icons derive from the simplified artwork in `app/favicon2.svg`. Next.js
file-based metadata serves its unchanged copy at `app/icon.svg`, a transparent
16/32/48px `app/favicon.ico`, and an opaque white 180px `app/apple-icon.png`
across both locales.
The hero strip links to the GPX, map search, activities, and open-source sections
on the landing page. The homepage keeps its navy header background and light text
while using the same shared header spacing and responsive layout as other pages.
Scoped CSS selects the homepage colors, keeping the header shell static.
The footer also keeps a stable server-rendered shell; scoped CSS selects its
homepage composition and hides it on pages marked as explorers. Other pages retain their
application navigation. A stable `display: contents` shell around page content
keeps Base UI overlay markers off page elements that are still hydrating; header
and footer composition selectors look through this shell. CSS Modules use
Next's native handling, excluded from the global Tailwind loader rule.

Homepage Explore links open the public explorer; Upload links open
`/tracks/upload?login=1`, where guests see the existing login dialog with a
signup option. Login refreshes upload eligibility on that page. Signup accepts
only the exact `intent=upload` marker and redirects to upload after registration;
all other values retain the normal home destination. Locale switching preserves
signup/upload query parameters. A one-day, HttpOnly, SameSite=Lax cookie records
this fixed upload intent after successful login/signup so a matching signed-in
user's confirmation result can offer Continue to upload. It contains no token
or user identity and never authorizes upload or a redirect to user-supplied URLs.
Unconfirmed accounts see the confirmation notice, rate-limited resend control,
and a confirmation recheck button backed by a session-authorized Server Action.
An unconfirmed result shows a localized toast; confirmation refreshes the upload
form, including after confirmation in another tab. Existing server-side confirmation, CAPTCHA,
session, and upload authorization requirements remain enforced.

The approved design and verification scope live in `docs/homepage-redesign.md`.

## Search discovery and link previews

Indexing is disabled unless `SEO_INDEXING_ENABLED=true`. The localized layout
excludes pages by default; only homepages and anonymously eligible public Track
details opt in. Query-bearing versions use noindex and a query-free canonical.
The proxy independently emits matching robot directives while retaining existing
private/no-store and no-referrer protections. Utility pages remain excluded;
robots.txt permits their crawling in enabled deployments so noindex can be read.

`tracks/public.ts` is a session-free, minimal public projection shared by Track
metadata, header decisions and sitemap eligibility. Its query requires public
visibility, an active owner, and a ready GPX owned by that owner. No owner or
administrator session can broaden this authority. Track metadata is resolved at
request time; React memoization lasts only for that request. Database errors fail
closed. Ordinary detail/content and image authorization remain independent.

Homepages and eligible Tracks have absolute canonical and reciprocal en/es links,
Open Graph locale/alternate-locale and Twitter summary-large-image metadata.
URLs use validated `APP_ORIGIN`, never request headers or email credentials.
Track titles preserve user-written names; descriptions collapse whitespace and
truncate at 200 Unicode code points with an ellipsis. Visible descriptions remain
unchanged. JSON-LD describes a WebSite or WebPage and actual displayed text,
without invented ratings, geography or route claims. JSON serialization escapes
`<` to prevent user text terminating the script element.

The preview is the current first ready gallery photo's large JPEG display URL;
no original or overlaid photo is used. The existing endpoint reauthorizes each
read and retains private/no-store. Photo-less Tracks and homepages share the
branded 1200×630 JPEG composed from the attributed homepage photograph using
`scripts/generate-seo-preview.mjs`. Visibility changes, deletion and owner
deactivation stop subsequent public retrieval; external caches cannot be recalled.

Robots and sitemap use request-time execution. Disabled deployments advertise no
sitemap and return an empty URL set, while allowing preview/framework resources.
Enabled sitemaps list only query-free localized homepages and eligible Tracks
with language alternatives. Authority failures return an error rather than a
partially authoritative sitemap. Search engine inclusion and social presentation
remain decisions of those external services; structured data promises no rich
result eligibility.

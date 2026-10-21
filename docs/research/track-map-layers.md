# Research: Track Atlas basemap and layer options

## Subsequent decision

The initial follow-up introduced Street/Outdoor switching using OpenTopoMap.
The owner then approved replacing that raster Outdoor option with a custom
OpenFreeMap vector style prioritizing paths/tracks and natural land cover, without
contours or hillshade. OpenTopoMap was subsequently restored as a separate
Topographic choice alongside the custom Outdoors style. Street remains the
default; satellite imagery stays deferred.
The comparison below is historical research, not a current implementation status.
See [no-account follow-up](no-account-map-layers.md) for the newer permission and
compatibility evidence, and `ARCHITECTURE.md` for implemented behavior.

## Summary

OpenFreeMap already fits the existing 2D street map and offers light/dark alternatives without a key, but the reviewed official documentation does **not** establish a hosted satellite, contour, or elevation service. Outdoor/topographic cartography and satellite imagery can use the existing MapLibre/react-map-gl renderer; true 3D terrain is a separate feature requiring elevation data and interaction changes. No provider is selected and no implementation is proposed for immediate execution.

Evidence labels: **Direct** = official documentation or repository source; **Interpretation** = engineering assessment, not a provider promise. Prices/terms describe the fetched pages, not a contractual guarantee.

## Baseline implementation (direct repository evidence)

Captured before the details-layout and wheel-zoom changes. The implementation
now enables plain wheel zoom while retaining two-finger touch panning; see
`ARCHITECTURE.md` for current behavior. Outdoor/satellite remain deferred under
the no-account/no-key constraint.
Read `AGENTS.md`, `README.md`, `ARCHITECTURE.md` (including Interactive original-point map), and `components/track-map-renderer.tsx`.

- Pinned MapLibre GL JS 5.24.0 / react-map-gl 8.1.3; `mapStyle="https://tiles.openfreemap.org/styles/liberty"` in both UI themes. No theme-driven map replacement today.
- The recorded track is an independent GeoJSON source with two line layers (outline and foreground), tolerance zero, and start/end DOM markers. Preserve all original positions and authorization; basemap changes need not modify GPX processing or persisted geometry.
- Expanded attribution, `no-referrer` provider requests, zoom/fit/fullscreen buttons, `scrollZoom={false}`, cooperative gestures, disabled rotation/pitch and `maxPitch={0}`.
- Current provider failure causes the map section's failure UI, while details/charts/downloads remain available. Additional optional layer failures would need separate consideration.

## Findings

### 1. Basemap comparison

**Support: Direct for capabilities; Interpretation for relative effort/usefulness. Confidence: high, except Dark readiness and untested compatibility noted below.**

| Option                            | Verified capability                                                                                                                     | Access and relative integration effort                                                                                                | Decision relevance / limitation                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenFreeMap Liberty / Bright      | Hosted vector street styles; Liberty is current default.                                                                                | No account/key; low effort to expose a `mapStyle` choice.                                                                             | Street orientation and familiar context; not evidence of contours or satellite.                                                                  |
| OpenFreeMap Positron (light)      | Hosted clean style; official style README says POIs removed and some highway labels delayed to higher zooms.                            | Same provider; low effort.                                                                                                            | Less visual competition with a track, but less outdoor detail.                                                                                   |
| OpenFreeMap Dark                  | Official style repository documents `/styles/dark`, but says Dark is incomplete and otherwise unmodified from upstream (fonts changed). | Same provider; low mechanical effort, additional visual acceptance testing.                                                           | Available is not equivalent to equal maturity with Liberty. Not listed in the fetched Quick Start's customization list.                          |
| MapTiler Outdoor / Topo, kept 2D  | Official product page explicitly documents contours (metres/feet), hill shading, trails and outdoor POIs.                               | Account/API key, plan/attribution/CSP review; moderate effort using a hosted style JSON. No renderer replacement inherently required. | A focused way to obtain topographic context without implementing 3D. Verify actual selected style/version and region before commitment.          |
| MapTiler Satellite Plain / Hybrid | Imagery backdrop; Hybrid adds labels, roads and borders.                                                                                | Same provider/account requirements; moderate effort as style selection, or more composition work if sourcing raster tiles directly.   | Shows real-world land cover; does not itself supply contours or change elevation geometry. Imagery age/resolution varies; validate target areas. |

Sources: [OpenFreeMap Quick Start](https://openfreemap.org/quick_start/), [official style README](https://github.com/hyperknot/openfreemap-styles/blob/main/README.md), [MapTiler Outdoor/Topo](https://www.maptiler.com/maps/outdoor-topo/), [Satellite Plain/Hybrid](https://www.maptiler.com/maps/satellite/), [Maps API](https://docs.maptiler.com/cloud/api/maps/), [react-map-gl Map](https://visgl.github.io/react-map-gl/docs/api-reference/maplibre/map).

### 2. Basemap, overlays, and 3D are independent choices

**Support: Direct API semantics; Interpretation for application impact. Confidence: high.**

- **Basemap:** the background cartography, commonly a style JSON containing multiple sources/layers. Outdoor or satellite can replace a street basemap; a style is not necessarily one tile layer.
- **Overlays:** the recorded track already is one. Contour linework needs a contour dataset/source (typically vector tiles, with line/label layers); selecting a different road color does not generate contours. Hillshade is visual relief shading and can remain entirely 2D. A MapLibre hillshade layer uses elevation data; a provider can also bake shading into rendered tiles.
- **True 3D terrain:** a terrain configuration references an elevation source (`raster-dem`) and optional exaggeration, deforming the map surface. Satellite images and contour strokes alone are not a DEM. MapLibre's example explicitly separates hillshade layers from terrain configuration.
- **Application inference:** a convincing interactive 3D mode would need a licensed DEM, terrain configuration, pitch controls/limits, marker/path/fit behavior and performance testing. Current zero-pitch/rotation restrictions are deliberately 2D. Terrain is not GPX elevation enrichment and must not change recorded analytics.

Sources: [MapLibre terrain specification](https://maplibre.org/maplibre-style-spec/terrain/), [official 3D example](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/), [layer specification](https://maplibre.org/maplibre-style-spec/layers/). The live example currently targets newer MapLibre than the repository; its demo endpoints are not evidence of production usage rights or service guarantees.

### 3. Public/commercial use, costs, and attribution

**Support: Direct. Confidence: high for quoted page text; medium for future account-specific availability.**

**OpenFreeMap:** homepage explicitly allows commercial use, no registration/API key/cookies, no online map-view/request cap, and no SLA or personalized support. Terms provide service as-is and permit discontinuation. This is not unrestricted bulk downloading: offline downloads are capped at 3,000 tiles or 50 MB per download, at most four parallel requests, with an identifying User-Agent; larger use requires contact. Attribution is required: retain source-provided OpenMapTiles/OpenStreetMap credits; OpenFreeMap's own name is appreciated but the homepage says optional. The existing expanded attribution control is appropriate.

Sources: [homepage and attribution](https://openfreemap.org/), [terms](https://openfreemap.org/tos/).

**MapTiler:** the fetched pricing page describes **Free** as testing/PoC/prototyping/personal/non-commercial, with 100k API requests/month; **Flex** starts at **US$30/month**, includes 500k API requests/month, and lists extra API requests at US$0.15/1k, excluding VAT. Do not promise commercial production on Free without confirming contractual eligibility. Free stops at quota; Flex bills overage and permits spending limits. Crucially, the page says third-party renderers are billed by tile API requests: keeping MapLibre does **not** automatically get the unlimited interactions of MapTiler SDK map-session billing.

MapTiler requires linked text attribution and, for Free, a linked MapTiler logo in addition to MapLibre's automatic text attribution. Preserve any additional dataset/imagery credits in the actual style/source; check [copyright](https://www.maptiler.com/copyright/). A provider-logo requirement needs reconciliation with this repository's Phosphor-only icon/no-downloaded-logo convention rather than silently copying the provider's SVG example.

Sources: [pricing](https://www.maptiler.com/cloud/pricing/), [attribution guide](https://docs.maptiler.com/guides/map-design/attribution/add-attribution/).

### 4. Privacy and key handling

**Support: Direct policies/key documentation plus explicitly labeled inference. Confidence: high.**

- OpenFreeMap's policy covers embedded tile use: no IP in ordinary access logs, but error logs may contain IP/request URLs (seven days), and security incidents may enable IP logging for up to 30 days. Cloudflare may process requests. No cookies/accounts is **not** no network disclosure.
- MapTiler requires an account and valid API key. Its policy explicitly permits IP security checks for embedded-map end users for up to two months. Do not generalize its website cookie policy into a claim that map-tile requests install analytics cookies; that was not verified.
- **Inference:** direct requests to either provider reveal visitor IP, timing, and requested map area through tile coordinates. Extra contour/DEM providers create extra recipients. The track's full GeoJSON is not automatically uploaded, but the viewed area can reveal sensitive location context. Keep no-referrer and avoid track IDs, account data, GPX URLs or geometry in provider requests.
- A browser map key is observable, not a server secret. MapTiler recommends Allowed HTTP origins, separate deployment keys, rotation and usage monitoring; paid-key abuse can incur charges. Origin restrictions and `no-referrer` are different mechanisms; test actual browser requests without weakening privacy by assumption.
- **Inference:** self-hosting removes the external map recipient if all tiles/styles/glyphs/sprites/DEM are hosted locally, but adds storage, updates, bandwidth and operational responsibilities. OpenFreeMap documents self-hosting; satellite self-hosting requires separate imagery rights, not just MIT renderer/server code.

Sources: [OpenFreeMap privacy](https://openfreemap.org/privacy/), [MapTiler privacy](https://www.maptiler.com/privacy-policy/), [MapTiler key guide](https://docs.maptiler.com/guides/developer/credentials/api-key/), [OpenFreeMap self-hosting](https://openfreemap.org/quick_start/).

### 5. Wheel zoom is a separate interview decision

**Support: Direct API documentation and current component. Confidence: high.**

| `scrollZoom`    | `cooperativeGestures` | Expected desktop wheel behavior                                                                                |
| --------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| false (current) | true (current)        | No wheel zoom, including Ctrl/Cmd-wheel; buttons still zoom.                                                   |
| true            | true                  | Ctrl/Cmd-wheel zoom; plain wheel preserves page scrolling. Cooperative touch interaction requires two fingers. |
| true            | false                 | Plain wheel zooms over map; greater risk of trapping page-scroll intent.                                       |

Enabling `scrollZoom` alone does **not** produce plain-wheel zoom while cooperation remains enabled. If wheel zoom changes, review localized Windows/Mac/mobile help (currently all mapped to one translation), page scrolling, touch and fullscreen behavior. No gesture behavior was changed or browser-tested during research.

Sources: [MapLibre MapOptions](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/), [ScrollZoomHandler](https://maplibre.org/maplibre-gl-js/docs/API/classes/ScrollZoomHandler/), [react-map-gl constructor-option support](https://visgl.github.io/react-map-gl/docs/api-reference/maplibre/map).

## Integration assessment (researcher inference)

Use the existing `mapStyle` prop for style changes; react-map-gl documents style diffing and warns against imperative `setStyle` conflicting with React bindings. Preserve/revalidate track sources, line ordering above imagery/relief, markers, camera/fit state and full geometry during style reloads. Review attribution, all asset origins/CSP, referrer behavior, optional-layer failure isolation, both themes/languages and live provider rendering. Style switching is lower effort than compositing separate contour/hillshade datasets; 3D adds the most interaction/testing work. These are relative estimates, not measured timings or a guarantee that every new provider style works unchanged with pinned MapLibre 5.24.

## Contradictions and validation limits

- Search summaries claimed MapTiler Free allows commercial projects. The fetched primary pricing page instead calls Free personal/non-commercial. The primary page takes precedence for this brief; confirm terms/account entitlement before production.
- OpenFreeMap Dark is discoverable in the official repository but described there as incomplete, unlike the polished/default-style implication a generic list could suggest.
- `source_check` was run for decision-critical pricing/use/privacy/gesture claims. It retrieved sources but reported automated semantic validation unavailable; the primary passages were manually inspected instead. It is not an independent legal/compliance attestation.
- Live official documentation can differ from pinned package behavior and can change. No implementation or provider quality benchmark was performed.

## Missing evidence / most useful next steps

Before implementation, interview for: street/light/dark versus outdoor versus imagery priorities; whether contours/hillshade suffice without 3D; public/commercial deployment and budget; privacy/self-hosting preference; plain-wheel versus modifier-wheel versus current buttons-only.

After those answers only: verify chosen plan/terms and source-specific attribution, selected style compatibility, imagery age/resolution or contour/DEM coverage in representative regions, origin-key behavior with no-referrer, and realistic usage/performance. No hosted OpenFreeMap satellite/contour/DEM entitlement was established; no alternative free terrain/imagery endpoint is recommended by implication.

## Sources kept / deprioritized

Kept: official OpenFreeMap service/terms/privacy/style repository, official MapTiler product/API/pricing/key/privacy/attribution pages, MapLibre and react-map-gl references linked above. These directly establish capabilities, conditions and integration mechanisms.

Deprioritized: generated search summaries (not evidence; commercial-use error noted), third-party surveys/benchmarks (unnecessary for this bounded comparison), demo tile endpoints (not production-service terms). A guessed MapTiler MapLibre examples URL returned 404; used the official Maps API and react-map-gl references instead.

## Scope and verification

Research-only; no application/config changes, commits, pushes, or application tests. No Next.js issue or feedback candidate arose.

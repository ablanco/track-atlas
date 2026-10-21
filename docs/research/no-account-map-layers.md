# Research: No-account worldwide Outdoor and labeled Satellite basemaps

## Current implementation note

This is historical provider research. After the OpenTopoMap implementation, the
owner approved a custom vector Outdoor style over OpenFreeMap instead. The current
application now keeps both: Outdoors emphasizes paths/tracks and natural land
cover without contours or shaded relief, while Topographic restores OpenTopoMap
raster tiles alongside it. Satellite stays deferred.
See `ARCHITECTURE.md` and `tracks/outdoor-style.ts` for the current behavior.

## Summary

**A worldwide, detailed Outdoor + labeled Satellite production setup cannot yet be recommended without a provider account.** OpenTopoMap is a credible no-account outdoor candidate with explicit embedding permission, but volunteer hosting has capacity/availability risks. EOX offers genuinely permitted no-account satellite overview imagery—including commercially reusable 2016 imagery—but its 10 m resolution, coverage gaps and age are not a substitute for detailed aerial imagery; anonymous Esri tile access does not establish an operator's license entitlement.

**Checked context:** primary pages and service metadata were fetched during this research run. The execution environment did not expose a trustworthy calendar date, so none is invented here. The fetched OpenTopoMap notice is dated 5 January 2026; EOX's current license summary refers to June 2026. Recheck live terms before selection. **Direct** means fetched primary text/metadata; **Interpretation** means engineering/legal-risk assessment, not a provider promise. Research only, not legal advice or acceptance of any contract.

Read: `AGENTS.md`, `GLOSSARY.md`, `docs/research/track-map-layers.md`, and relevant README/architecture context. Existing Street uses OpenFreeMap/MapLibre; full track geometry is an independent overlay and must stay separate from basemap/elevation data. The researcher returned a session artifact; the parent saved this brief in `docs/research/no-account-map-layers.md`.

## Findings

### 1. OpenTopoMap: actionable no-account Outdoor candidate, conditional operational recommendation

**Claim:** Explicitly allowed for web/app embedding without registration/key, including a commercially reusable map license; not an unlimited or guaranteed tile service. **Sources:** [official About/use/FAQ](https://opentopomap.org/about), [official live page source](https://opentopomap.org/). **Support:** direct; operational assessment interpretation. **Confidence:** high on permission text; medium on production suitability.

Decision-critical passages (German; translations below):

- Web/app FAQ: “Dies ist jederzeit gerne möglich, sofern unser Server z.B. durch Massendownloads nicht zu stark beansprucht wird.” Translation: embedding is welcome provided the server is not overloaded, for example by mass downloads.
- “Außerdem kann keinerlei Ausfallsicherheit garantiert werden.” Translation: no availability guarantee can be given. A short notification about use is appreciated, not presented as a registration requirement.
- Commercial-use FAQ: “Die Lizenz CC-BY-SA der Online-Karte erlaubt deren kommerzielle Nutzung.” The page links CC BY-SA **3.0**, requires attribution and share-alike for the map; it does not require making the entire application open source. Classification of modified/combined exported maps needs separate review.
- Current notice: “We updated our render server to a smaller vServer on 05.01.2026. If there are performance issues, you can select the backup server tiles.” Vector migration is described as forthcoming, not a verified stable replacement service.

**Cartography/coverage:** OSM-based topographic raster with contours/relief, footpaths (including SAC difficulty symbols), tracks, huts, peaks, springs and other outdoor POIs in its legend. This is outdoor cartography, **not** proof of complete marked hiking/cycling-route relations, legal access, safe navigation or uniformly complete worldwide trails. Coverage follows OSM and elevation inputs; polar/high-latitude relief completeness was not verified. Worldwide ambition does not establish identical detail everywhere.

**Zoom/endpoints:** the About page advertises `https://{a|b|c}.tile.opentopomap.org/{z}/{x}/{y}.png`. More current live HTML uses `https://tile.opentopomap.org/{z}/{x}/{y}.png`, min/max zoom **1–17**, and `https://backup.opentopomap.org/{z}/{x}/{y}.png`, **1–15**. These are observed official client settings, not a coverage/SLA guarantee; backup cannot preserve z17 detail. Do not silently substitute a third-party mirror or assume old/new hostnames share identical uptime. Raster labels are baked in and cannot be restyled or independently localized. Overzoom adds no detail.

**Attribution:** retain linked OpenStreetMap contributors, DEM sources, OpenTopoMap and CC BY-SA 3.0. About lists SRTM; the live main-layer attribution additionally credits **Sonny**, with linked SRTM/Viewfinderpanoramas. Use the actual chosen layer's current credit, not the older shorter text alone.

**Service policy:** avoid bulk/prefetch/offline downloads, honor caching, and keep request volume modest. No numerical request quota or promised fair-use capacity was found. Public/open-source/commercial status alone does not waive overload restrictions. Contact maintainers before material public traffic; no contact was made during research.

### 2. Esri World Imagery: anonymously readable does not mean generally entitled

**Claim:** Do not ship the legacy anonymous endpoint as a license-free detailed Satellite solution. **Sources:** [World Imagery item JSON](https://www.arcgis.com/sharing/rest/content/items/10df2279f9684e4a9f6a7f08febac2a9?f=pjson), [service metadata](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=pjson), [Esri website/service terms](https://www.esri.com/en-us/legal/terms/web-site-service), [current imagery-label tile API](https://developers.arcgis.com/rest/static-basemap-tiles/arcgis-imagery-labels-tile-get/). **Support:** direct text; reject-for-now recommendation interpretation. **Confidence:** high that unrestricted permission is not established; medium on exact legacy eligibility.

- Legacy raster pattern is `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`. Metadata is publicly readable. This establishes technical discovery only; no map tiles or private tracks were uploaded/tested.
- The actual item says: **“This work is licensed under the Esri Master License Agreement.”** General website terms §2.2 allow internal/noncommercial external use with attribution, define noncommercial narrowly (no income promotion/commercial advantage), reserve Esri's classification discretion, and §2.5 preserves third-party imagery restrictions. That is not an unrestricted grant to any public app, and this general page cannot override the item's specific agreement.
- Current static imagery-label API explicitly says tokens “must be created from an ArcGIS Location Platform account” with `premium:user:staticbasemaptiles`; authentication is required via token or header. **Anonymous end users of an account-backed public map are not the same as an operator with no account.** Current authenticated service documentation also does not, by itself, prove every old endpoint is forbidden.
- Resolution is compelling: service metadata advertises worldwide lower-resolution imagery and meter/submeter imagery in many areas, with variable source/age. Cache declares levels 0–23, but that is **not** global native z23 detail. Item metadata describes high-resolution imagery typically within 3–5 years for much of the world, not a universal freshness guarantee.
- World Imagery itself is unlabeled. A reference/labels service needs its own entitlement and attribution. Do not assume legacy World Boundaries and Places or newer labels are licensed merely because they load. Current service credits include **Esri, Vantor, Earthstar Geographics, and the GIS User Community**; inspect actual geographic source attribution rather than copying an old DigitalGlobe credit list.

**Exact blocker:** applicable Master License/legacy subscription entitlement and label-layer rights for Track Atlas were not established. Esri's linked usage-summary PDF failed extraction (tool PDF dependency missing). Obtain readable current terms or written provider confirmation before any production selection. No contract, signup or permissions request was undertaken.

### 3. EOX: strongest permitted no-account imagery option, but overview-quality

**Claim:** EOX explicitly permits direct hosted endpoints; **2016** imagery has a commercially reusable license, whereas recent imagery is noncommercial unless separately licensed. **Sources:** [pricing/service invitation](https://cloudless.eox.at/pricing), [EOX Maps hosting conditions](https://maps.eox.at/), [live WMTS capabilities](https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml), [product introduction](https://cloudless.eox.at/documentation/introduction), [coverage](https://cloudless.eox.at/documentation/source-platform-description), [license summary](https://cloudless.eox.at/documentation/license), [binding commercial license](https://cloudless.eox.at/license-legal/). **Support:** direct; fitness assessment interpretation. **Confidence:** high on year-specific rights/resolution, medium on hosted integration readiness.

Important primary passages:

- Pricing: “Feel free to use the provided service endpoints (WMS or WMTS) directly in your application.” It specifies noncommercial **2018–2025 CC BY-NC-SA 4.0**, versus **2016 CC BY 4.0**.
- Capabilities independently identify `s2cloudless_3857` as 2016 and explicitly link **CC BY 4.0**. Newer `s2cloudless-2024_3857` links **CC BY-NC-SA 4.0**. This is stronger evidence than extrapolating Sentinel's open raw-data license to EOX's processed product.
- EOX Maps: “Just feel free to use them,” with link-back and proper attribution; “Content and availability may change without notice.” Its Heavy load section explicitly says it has begun **rate limiting**, resulting in HTTP errors and redirects; dedicated SLA hosting is offered separately. No numerical quota is promised.

**Suitability:** nominal **10 m** Sentinel-2 cloudless annual mosaics show land cover/landscape context, not small trails, narrow roads or detailed aerial inspection (**researcher inference** from pixel size). 2016 is visibly an old dataset; recent years do not eliminate the resolution limitation. Official coverage excludes poles and some small ocean islands; “global” is not uninterrupted planetary imagery. Neither increasing map zoom nor compositing labels creates missing photographic detail. The WMTS's generic zoom pyramid should not be advertised as native imagery resolution.

**Labels/integration:** capabilities include EPSG:3857/GoogleMapsCompatible imagery and transparent `overlay_3857`, `overlay_bright_3857`, and related base-overlay variants for place/road/border context. EOX's own page describes these overlays separately from backgrounds. A prospective 2016 + bright-labels composition is therefore credible, not yet tested: retain both imagery and overlay credits. Some capabilities ResourceURLs use **HTTP** despite HTTPS capabilities; use only verified HTTPS equivalents in a future browser test, not mixed content. Check tile matrix size/zoom against the selected layer rather than assuming XYZ values.

**Attribution:** current requested imagery string is “EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)” with appropriate links/year, plus EOX Maps link and overlay OSM/EOX/MapServer credits as supplied. Do not apply 2016 permission to later years. Noncommercial cannot be inferred from an open-source code license or a publicly accessible website. Commercial license requires ordering/payment and carries restricted-redistribution conditions; no such agreement was entered.

### 4. NASA GIBS: legitimate public imagery service, wrong default product for detailed tracks

**Claim:** GIBS is designed for public web-client visualizations without ordinary account credentials, but the reviewed global natural-color products are scientific/overview imagery, not a high-resolution trail basemap. **Sources:** [introduction/use guidance](https://nasa-gibs.github.io/gibs-api-docs/), [access basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/), [catalog](https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/), [library examples/resolution table](https://nasa-gibs.github.io/gibs-api-docs/map-library-usage/). **Support:** direct for documented access/resolution; suitability interpretation. **Confidence:** high on overview mismatch, medium on selected-layer reuse conditions (no layer selected).

Official docs invite integrating standardized public WMTS/WMS visualizations and show credential-free URLs. NASA promotes full/open data sharing and asks for: “We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).” Do not confuse imagery access with downloading original science files from services requiring Earthdata Login.

The documented MODIS true-color example is **250 m**, Web Mercator matrix `GoogleMapsCompatible_Level9`; resolution tables also include finer matrix classes, which do not prove every layer contains finer native data. Daily scenes may have clouds/no-data and are not necessarily a seamless cloudless annual mosaic. Not every GIBS layer is natural color or global. No reviewed source established a cloud-free worldwide meter-scale basemap. Layer-specific source rights/acknowledgements must be checked; NASA's general sharing guidance is not a blanket license for every third-party contribution. No contractual SLA or numerical production quota was established. Search summaries suggested a million-tile threshold, but fetched current pages did not substantiate it, so no threshold is relied on.

EPSG:3857 WMTS tiles can fit a MapLibre raster source after checking tile size/matrix/date/maxzoom. EPSG:4326 and polar grids are not drop-in Web Mercator XYZ. Separate licensed labels would still be needed. GIBS is worth an explicitly named Earth-observation overview feature, not the requested detailed Satellite default.

### 5. Other credible paths, without an exhaustive endpoint list

**Claim:** No reviewed alternative removes all rights, detail, coverage and operation blockers. **Sources:** [EOX Maps](https://maps.eox.at/), [OpenTopoMap source/style](https://github.com/der-stefan/OpenTopoMap), [existing OpenFreeMap service](https://openfreemap.org/). **Support:** interpretation based on scoped evidence. **Confidence:** medium; not a claim that no such service can exist.

- **EOX Terrain/Terrain Light + overlays:** explicitly embeddable global relief/context maps, but reviewed documentation does not establish a detailed outdoor trail/contour product equivalent to OpenTopoMap. Same demo hosting/rate-limit limitations.
- **Self-hosting OpenTopoMap/OSM-derived outdoor cartography:** avoids a tile-provider account and offers control, but introduces rendering, elevation-source licensing, storage, bandwidth and updates. Self-hosted Sentinel-derived imagery can be open-license overview imagery; it does not create free meter-scale worldwide photography. “No account” is not “no infrastructure cost.”
- Keep **OpenFreeMap Street** as current baseline. Its public no-account entitlement is already documented in the prior research; it is not evidence of a hosted satellite/contour offering.
- Regional public orthophoto services may be excellent locally but cannot fulfill the worldwide requirement alone. Google/Bing/other copied public URLs, demo URLs and third-party proxy lists were not treated as permission evidence.

## Cross-cutting integration and privacy assessment

**Support:** researcher interpretation; no browser/network-header test was performed.

MapLibre can use a 2D raster background and separate transparent labels beneath the existing recorded-path layers. No renderer replacement, GPX upload or 3D terrain is necessary. Switching styles must preserve full original geometry, track visibility authorization, markers/camera and attribution; isolate optional basemap failure from details/charts. Labels need legibility above imagery while the recorded track remains foremost. OpenTopoMap already has baked labels; satellite generally does not.

**CORS is a release gate, not assumed:** Leaflet image embedding and readable metadata do not prove WebGL texture requests succeed cross-origin. Validate selected HTTPS tiles/labels, CORS headers, redirects, tile size, matrix ordering, max native zoom and CSP using synthetic public coordinates. No header audit or MapLibre render was performed here. NASA/EOX document browser-oriented services, but this is not a per-endpoint compatibility attestation.

Preserve **no-referrer** on styles, raster/vector tiles, labels, glyphs and sprites. No fetched OpenTopoMap/EOX/GIBS guidance required a Referer, but absence of a prohibition is not tested anonymous/no-referrer compatibility. Do not weaken privacy to bypass restrictions or introduce a proxy to conceal disallowed use. Referrer-based account-key restrictions require explicit testing if an account provider is later chosen; Origin and Referer are different headers.

Direct third-party tile requests disclose visitor IP, timing and viewed area encoded in tile coordinates—even without GPX bytes, IDs or account details being sent. Imagery/label composition may add recipients and double request demand. No claims are made about provider IP retention/cookies where policies were not inspected. Publish accurate map-provider disclosures; use local geometry and do not upload private GPX for evaluation. Self-hosting helps only if **all** map assets are self-hosted with valid rights.

## Account-provider fallback comparison (not an authorization to buy)

| Candidate                                            | Why revisit if accounts become acceptable                                                                                                     | Blockers/conditions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MapTiler Outdoor/Topo + Satellite Hybrid**         | One provider explicitly documents contours, hillshade, trails/outdoor POIs and labeled imagery. Existing MapLibre can remain.                 | Account/key. [Current pricing](https://www.maptiler.com/cloud/pricing/) says Free is testing/PoC/personal/noncommercial; **Flex US$30/month**, 500k API requests/month, extra **US$0.15/1k**, excluding VAT. Third-party SDK usage is tile-request billed, not unlimited SDK map sessions. Free 100k requests/month pauses at quota; Flex automatic overage with configurable spending limit. Verify selected imagery coverage/age/native resolution, exact attribution/logo obligations and origin restrictions before commitment. |
| **ArcGIS Location Platform imagery + labels**        | Detailed worldwide imagery and a documented current label API; account-backed auth/entitlement route rather than relying on legacy anonymity. | Account/token/privileges, terms and dataset attribution; not a validated combined outdoor offering here. Current plan costs/quotas were **not** verified; do not assume free production or cheaper than MapTiler.                                                                                                                                                                                                                                                                                                                   |
| **EOX commercial recent mosaic / dedicated service** | Clear provider route for recent-year commercial rights and/or reliable hosting.                                                               | Quote/agreement rather than assumed free use. Still nominal 10 m and nonpolar land coverage, so does not resolve the detailed Satellite requirement.                                                                                                                                                                                                                                                                                                                                                                                |

MapTiler capabilities sources: [Outdoor/Topo](https://www.maptiler.com/maps/outdoor-topo/), [Satellite Plain/Hybrid](https://www.maptiler.com/maps/satellite/). Prices are fetched-page observations, not a quote or acceptance.

## Recommendation and next decisions

1. **Keep Street; conditionally shortlist OpenTopoMap for Outdoor.** Before implementation, confirm expected load fits volunteer hosting, accept no SLA and reduced-detail backup, verify no-referrer/CORS and representative outdoor coverage. No mass downloads/offline mode.
2. **Do not recommend anonymous Esri World Imagery for release without entitlement clarification.** Public reachability is insufficient, especially for potentially commercial use and separate labels.
3. Offer a decision, not a silent downgrade: **accept “Satellite overview (2016, 10 m)”** using EOX CC BY imagery + permitted labels (with stated gaps/rate limits), **defer Satellite**, or **authorize account-provider evaluation** with an explicit budget/overage ceiling. Recent EOX NC imagery requires affirmatively established noncommercial eligibility. A complete detailed worldwide no-account setup remains unverified.
4. If detail is mandatory, revisit MapTiler first as the most direct combined outdoor/hybrid option, compare licensed Esri imagery only if worthwhile, and validate synthetic locations across Europe, the Americas, Africa, Asia, Oceania and high latitudes. No provider signup, spending or contracts without owner approval.

## Contradictions and missing evidence

- OpenTopoMap availability: current About says downsized server plus planned migration; do not repeat older shutdown/EOL claims as current fact. About and live HTML differ on tile host/DEM credits; live main and backup have different zoom limits.
- EOX's generic license summary says noncommercial use broadly, but current pricing **and live capabilities specifically preserve CC BY 4.0 for 2016**. The summary also simplifies sublicensing; the binding commercial license contains a conditional product-use sublicense grant. Do not treat the summary as the binding agreement or conflate years.
- Esri general noncommercial website permission, item Master License and modern account-based APIs are different evidence, not interchangeable. Legacy no-account operator entitlement remains unresolved.
- No visual/detail benchmark, current tile CORS/Referer headers, uptime sampling, numeric fair-use allowances, load modeling or precise global relief completeness was verified. Polar “worldwide” expectations need explicit definition; Web Mercator itself excludes poles.
- Two `source_check` calls returned passages but reported automated semantic assessment unavailable. Important claims were manually checked in fetched primary passages/JSON/XML instead. Esri usage-summary PDF extraction failed; no independent legal attestation is claimed.

## Sources kept / rejected

**Kept:** linked official OpenTopoMap permission/FAQ/live HTML, EOX service/pricing/license/WMTS metadata, NASA GIBS API documentation, Esri item/service/legal/API documentation, and MapTiler current pricing/product pages. These distinguish actual hosting permission from data rights and establish the relevant limitations.

**Rejected/deprioritized:** search-generated summaries (discovery only, especially Esri “generally yes” and NASA numerical quota assertions); OSM wiki zoom claims once official HTML was retrieved; third-party endpoint lists, libraries and anecdotal status claims; guessed URLs returning 404; Esri summary PDF unavailable to extraction. No endpoint's mere reachability was used as a permission grant.

## Follow-up: Outdoor-first integration probe

The owner selected **Outdoor first**, leaving satellite deferred. The parent
rechecked OpenTopoMap's official About page and live client HTML, then performed
a small public-coordinate compatibility probe (not a load or uptime test).

- Four individual main-server PNG tiles at zoom 12 returned HTTP 200 in the
  Pyrenees, Colorado Rockies, Himalaya, and New Zealand. Each returned
  `Access-Control-Allow-Origin: *`, `image/png`, and a seven-day cache lifetime,
  without redirects. This is spot coverage evidence, not worldwide completeness.
- The actual pinned MapLibre GL JS 5.24.0 rendered one real HTTPS raster tile in
  Chromium from a temporary local test page. It reached loaded/tiles-loaded state
  without map or page errors. The request had an Origin but **no Referer**, and
  sent no account data or GPX. Only that tile was requested in the browser probe.
- The browser probe deliberately bounded the source to one zoom-12 tile and
  overzoomed it to check texture rendering with minimal provider traffic. Its
  screenshot is therefore **not** evidence of native high-zoom quality.
- Visual inspection of the original spot tiles confirmed contour and shaded-relief
  rendering. Trails and labels vary by location; these samples do not certify
  route completeness, accessibility, safety, imagery freshness, or polar coverage.
- Live HTML still declares main zoom 1–17 and backup zoom 1–15, and credits
  OpenStreetMap, SRTM/Viewfinderpanoramas, Sonny, OpenTopoMap, and CC BY-SA 3.0.
  The production implementation must use linked credits rather than the temporary
  probe's abbreviated attribution text.

Temporary artifacts: `/tmp/track-atlas-outdoor-validation/tile-probes.json`,
`browser-probe.json`, `maplibre-outdoor.png`, and four regional PNG tiles. These
are local evaluation artifacts, not application assets or committed fixtures.
No private track was accessed or supplied to a provider.

**Proposed next slice:** retain Street as the default and add an explicit Outdoor
choice backed by OpenTopoMap. Preserve full recorded geometry, camera, markers,
gestures, and theme behavior on switching. Keep a way back to Street if Outdoor
fails, expose accurate attribution/provider privacy information, and do not add
bulk/offline/prefetch requests. Satellite remains deferred. Acceptance of the
volunteer service's capacity/no-SLA limitations is still required before release;
contact maintainers before material public traffic. No application implementation
has been performed in this probe.

## Subsequent implementation approval

After reviewing the Outdoor-first probe, the owner approved implementing
Street/Outdoor switching under the documented hosting limitations. The application
now includes that selector, linked credits, localized provider/privacy guidance,
and recoverable Outdoor tile failures/timeouts; satellite remains deferred.
See `ARCHITECTURE.md` and `README.md` for behavior and verification commands.
The research findings above remain the evidence and limitations behind that choice.

## Scope/verification

The original research phase involved public documentation and metadata requests
only: no signup, contract acceptance, commits, pushes, private GPX uploads or
application tests. The follow-up probe and separately approved implementation are
described above. Implementation verification passed lint, TypeScript, production
build, 33 track unit tests, 59 deterministic track browser tests, and a separate
opt-in real-provider Street/Outdoor switching test. Localized light/dark desktop
and mobile screenshots were inspected. No Next.js feedback candidate arose.

Remaining risks include changing provider terms, volunteer-service capacity and
coverage, and the absence of a selected detailed worldwide satellite provider.
The integration probes establish compatibility, not an availability guarantee or
legal attestation.

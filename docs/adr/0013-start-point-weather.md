# 0013: Weather at the recorded start point

Accepted 2026-11-25, issue #61, before implementation.

Use MET Norway Locationforecast compact, with seven upcoming days sampled at
six-hour UTC intervals. Display local dates/times in the start point's IANA zone,
resolved offline from coordinate polygons. Temperature is °C, wind km/h, and
precipitation mm with its actual one- or six-hour accumulation period labeled.
The reference is the first recorded point of the first segment, independent of
recording date, viewport and viewer. Place weather below map/analytics in its own
Suspense boundary.

Authorize each Track read before resolving its location. No public weather API is
needed. Only truncated coordinates (four decimals) leave the server; never send
GPX, metadata, account identifiers or cookies. Attribute MET Norway and CC BY 4.0.
Cache by coordinate for at least three hours, honoring later Expires, coalescing
concurrent lookups and using If-Modified-Since on refresh. Bound cache size and
provider admission per Node process; deployments with multiple instances need a
shared upstream limiter. Timeout after five seconds. Failure, quota exhaustion,
missing or expired data displays localized unavailable feedback, never stale data.

Test at the agreed forecast service/HTTP transport, authorized Track read/DB, and
rendered details widget seams. Synthetic provider responses and controlled clocks
must prevent automated requests to MET Norway. Cover all six languages, themes,
mobile layout and page usability after failure.

Provider research: [data model](https://docs.api.met.no/doc/locationforecast/datamodel.html),
[FAQ](https://docs.api.met.no/doc/locationforecast/FAQ),
[terms](https://docs.api.met.no/doc/TermsOfService.html). Free commercial use,
no SLA, global resolution approximately 9 km. Forecasts describe the start point,
not conditions along the entire path.

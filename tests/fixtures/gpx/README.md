# Multi-track GPX acceptance fixtures

These synthetic GPX 1.0/1.1 documents contain no personal recording. They carry
identical recorded data in their respective version namespaces: two Tracks with
two ordered segments each, repeated/shared endpoints, local backward/overlapping
timestamps, complete and partial elevation coverage, local namespace shadows,
QName values split across CDATA, and document-wide metadata/waypoints/extensions.

Parser/worker and real HTTP/database download acceptance share these fixtures.
Expected geometry, elevations and measurements are literal known answers in the
parser tests; download tests also check verbatim selected subtrees and singleton
byte preservation. Invalid-later, route, Unicode and generated cap/over-cap cases
remain in the adjacent parser/worker/service/browser suites to avoid large static
fixtures or duplicating existing acceptance.

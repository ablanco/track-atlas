/* eslint-disable @typescript-eslint/no-require-imports -- Shared native worker asset. */
"use strict";
const { Geodesic } = require("geographiclib-geodesic");
const { scanGpx } = require("./gpx-document.cjs");
function failure(code = "invalidFile", segment) {
  throw Object.assign(new Error(code), {
    code,
    ...(segment === undefined ? {} : { segment }),
  });
}

function derive({ coordinates, segmentStarts, elevations, times, segments }) {
  let distanceMeters = 0;
  const samples = [
    { distanceMeters: 0, elevationMeters: elevations[0], speedMps: null },
  ];
  let completeTiming = true;
  let durationSeconds = 0;
  let ascentMeters = 0;
  let descentMeters = 0;
  let minElevationMeters = null;
  let maxElevationMeters = null;
  let elevationSampleCount = 0;
  for (const elevation of elevations) {
    if (elevation === null) continue;
    elevationSampleCount++;
    minElevationMeters =
      minElevationMeters === null
        ? elevation
        : Math.min(minElevationMeters, elevation);
    maxElevationMeters =
      maxElevationMeters === null
        ? elevation
        : Math.max(maxElevationMeters, elevation);
  }
  const representations = [];
  for (const [segmentIndex, start] of segmentStarts.entries()) {
    const end = segmentStarts[segmentIndex + 1] ?? coordinates.length;
    const offset = distanceMeters;
    if (start > 0)
      samples.push({
        distanceMeters,
        elevationMeters: elevations[start],
        speedMps: null,
      });
    let segmentDistance = 0;
    const localDistances = [0];
    if (times[start] === null) completeTiming = false;
    for (let i = start + 1; i < end; i++) {
      const [lon1, lat1] = coordinates[i - 1];
      const [lon2, lat2] = coordinates[i];
      const edge = Geodesic.WGS84.Inverse(lat1, lon1, lat2, lon2).s12;
      segmentDistance += edge;
      localDistances.push(segmentDistance);
      distanceMeters = offset + segmentDistance;
      const usableInterval =
        times[i - 1] !== null && times[i] !== null && times[i] > times[i - 1];
      if (!usableInterval) completeTiming = false;
      samples.push({
        distanceMeters,
        elevationMeters: elevations[i],
        speedMps: usableInterval
          ? edge / ((times[i] - times[i - 1]) / 1000)
          : null,
      });
      if (elevations[i] !== null && elevations[i - 1] !== null) {
        const delta = elevations[i] - elevations[i - 1];
        ascentMeters += Math.max(delta, 0);
        descentMeters += Math.max(-delta, 0);
        if (!Number.isFinite(ascentMeters) || !Number.isFinite(descentMeters))
          failure("invalidSegment", segmentIndex + 1);
      }
    }
    if (!(segmentDistance > 0) || !Number.isFinite(distanceMeters))
      failure("invalidSegment", segmentIndex + 1);
    representations.push(
      ...[0, 1, 3, 4, 5].map((intermediateCount) => {
        const positions = [coordinates[start]];
        let edgeIndex = start + 1;
        for (let i = 1; i <= intermediateCount; i++) {
          const target = (segmentDistance * i) / (intermediateCount + 1);
          while (localDistances[edgeIndex - start] < target) edgeIndex++;
          if (localDistances[edgeIndex - start] === target) {
            positions.push(coordinates[edgeIndex]);
            continue;
          }
          const [lon1, lat1] = coordinates[edgeIndex - 1];
          const [lon2, lat2] = coordinates[edgeIndex];
          const inverse = Geodesic.WGS84.Inverse(lat1, lon1, lat2, lon2);
          const position = Geodesic.WGS84.Direct(
            lat1,
            lon1,
            inverse.azi1,
            target - localDistances[edgeIndex - start - 1],
          );
          positions.push([position.lon2, position.lat2]);
        }
        positions.push(coordinates[end - 1]);
        return {
          segmentIndex,
          intermediateCount,
          geometry: { type: "LineString", coordinates: positions },
          directionlessEdges: positions.slice(1).map(([lon, lat], i) => {
            const [previousLon, previousLat] = positions[i];
            // The inverse handles equivalent dateline longitudes and polar positions.
            return (
              Geodesic.WGS84.Inverse(previousLat, previousLon, lat, lon).s12 ===
              0
            );
          }),
        };
      }),
    );
    durationSeconds += (times[end - 1] - times[start]) / 1000;
  }
  return {
    version: 2,
    representations,
    geometry: {
      type: "MultiLineString",
      coordinates: segmentStarts.map((start, index) =>
        coordinates.slice(start, segmentStarts[index + 1]),
      ),
    },
    segmentStarts,
    segmentCount: segments,
    pointCount: coordinates.length,
    distanceMeters,
    samples,
    durationSeconds: completeTiming ? durationSeconds : null,
    ascentMeters:
      elevationSampleCount === coordinates.length ? ascentMeters : null,
    descentMeters:
      elevationSampleCount === coordinates.length ? descentMeters : null,
    minElevationMeters,
    maxElevationMeters,
    elevationSampleCount,
  };
}

function parseGpx(bytes) {
  const document = scanGpx(bytes);
  if (document.tracks.length !== 1) failure("unsupportedStructure");
  return derive(document.tracks[0]);
}
function escapeAttribute(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;")
    .replace(/\t/g, "&#9;");
}
function parseGpxDocument(bytes) {
  const document = scanGpx(bytes);
  const root = document.root;
  // Namespace bindings are inherited by the verbatim selected subtree. Never copy
  // arbitrary root attributes, metadata or siblings into an isolated download.
  return {
    tracks: document.tracks.map((track, trackIndex) => {
      try {
        const bindings = Object.values(root.attributes)
          .filter(
            (attribute) => attribute.uri === "http://www.w3.org/2000/xmlns/",
          )
          .filter((attribute) => {
            const prefix = attribute.name === "xmlns" ? "" : attribute.local;
            return prefix === root.prefix || track.prefixes.has(prefix);
          })
          .map(
            (attribute) =>
              ` ${attribute.name}="${escapeAttribute(attribute.value)}"`,
          )
          .join("");
        const opening = `<${root.name}${bindings} version="${root.attributes.version.value}" creator="Track Atlas">`;
        return {
          trackIndex,
          data: derive(track),
          gpx:
            document.tracks.length === 1
              ? Uint8Array.from(bytes)
              : new TextEncoder().encode(
                  opening + track.xml + `</${root.name}>`,
                ),
        };
      } catch (error) {
        error.track = trackIndex + 1;
        throw error;
      }
    }),
  };
}
function parseGpxWaypoints(bytes) {
  const document = scanGpx(bytes, true);
  return document.tracks.length === 1 ? document.waypoints : [];
}
module.exports = { parseGpx, parseGpxDocument, parseGpxWaypoints };

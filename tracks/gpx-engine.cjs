/* eslint-disable @typescript-eslint/no-require-imports -- Native Node worker asset must run without a bundler or TS loader. */
"use strict";
// Plain JavaScript is intentional: the bounded worker runs this exact asset in
// Node, including when its caller was compiled by Next/Turbopack.
const { SaxesParser } = require("saxes");
const { Geodesic } = require("geographiclib-geodesic");

function failure(code = "invalidFile") {
  throw Object.assign(new Error(code), { code });
}

function decimal(value) {
  if (
    typeof value !== "string" ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
  )
    failure();
  const number = Number(value);
  if (!Number.isFinite(number)) failure();
  return number;
}

function timestamp(value) {
  // No timezone inference, invalid-calendar normalization, leap-second guesses,
  // or implementation-dependent Date.parse formats.
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const [, y, m, d, h, min, sec, zone] = match;
  const year = Number(y),
    month = Number(m),
    day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day >
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ||
    Number(h) > 23 ||
    Number(min) > 59 ||
    Number(sec) > 59
  )
    return null;
  if (
    zone !== "Z" &&
    (Number(zone.slice(1, 3)) > 14 ||
      Number(zone.slice(4)) > 59 ||
      (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))
  )
    return null;
  const result = Date.parse(value.trim());
  return Number.isFinite(result) ? result : null;
}

function parseGpx(bytes) {
  if (bytes.byteLength > 10 * 1024 * 1024) failure("tooLarge");
  if (!bytes.byteLength) failure();
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const coordinates = [];
  const elevations = [];
  const times = [];
  let current = null;
  let scalar = null;
  const parser = new SaxesParser({ xmlns: true });
  const stack = [];
  let namespace;
  let tracks = 0;
  let segments = 0;
  let elements = 0;
  parser.on("xmldecl", ({ encoding }) => {
    if (encoding && encoding.toLowerCase() !== "utf-8") failure();
  });
  parser.on("doctype", () => failure());
  parser.on("processinginstruction", () => failure());
  parser.on("error", () => failure());
  parser.on("opentag", (tag) => {
    if (++elements > 500_000 || stack.length >= 64) failure();
    const parent = stack.at(-1);
    if (scalar) failure();
    stack.push(tag);
    if (stack.length === 1) {
      const version = tag.attributes.version?.value;
      if (
        tag.local !== "gpx" ||
        !["1.0", "1.1"].includes(version) ||
        tag.uri !==
          `http://www.topografix.com/GPX/${version?.replace(".", "/")}`
      )
        failure();
      namespace = tag.uri;
      return;
    }
    if (tag.uri !== namespace) return;
    if (tag.local === "rte" || tag.local === "rtept")
      failure("unsupportedStructure");
    // Ignore informational subtrees, including same-namespace lookalikes, but
    // never silently discard a misplaced position in the actual track tree.
    if (
      stack
        .slice(1, -1)
        .some(
          (ancestor) =>
            ancestor.uri === namespace &&
            ["extensions", "metadata", "wpt"].includes(ancestor.local),
        )
    )
      return;
    if (tag.local === "trk" && stack.length !== 2)
      failure("unsupportedStructure");
    if (
      tag.local === "trkseg" &&
      !(
        stack.length === 3 &&
        parent.uri === namespace &&
        parent.local === "trk"
      )
    )
      failure("unsupportedStructure");
    if (
      tag.local === "trkpt" &&
      !(
        stack.length === 4 &&
        stack[1].uri === namespace &&
        stack[1].local === "trk" &&
        parent.uri === namespace &&
        parent.local === "trkseg"
      )
    )
      failure("unsupportedStructure");
    if (stack.length === 2 && tag.local === "trk") {
      if (++tracks > 1) failure("unsupportedStructure");
    }
    if (
      stack.length === 3 &&
      parent.uri === namespace &&
      parent.local === "trk" &&
      tag.local === "trkseg"
    ) {
      if (++segments > 1) failure("unsupportedStructure");
    }
    if (
      stack.length === 4 &&
      stack[1].uri === namespace &&
      stack[1].local === "trk" &&
      parent.uri === namespace &&
      parent.local === "trkseg" &&
      tag.local === "trkpt"
    ) {
      if (coordinates.length === 100_000) failure("tooManyPoints");
      const lat = decimal(tag.attributes.lat?.value);
      const lon = decimal(tag.attributes.lon?.value);
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) failure();
      coordinates.push([lon, lat]);
      current = { elevation: null, time: null, seen: new Set() };
    }
    if (current && stack.length === 5 && ["ele", "time"].includes(tag.local)) {
      if (current.seen.has(tag.local)) failure();
      current.seen.add(tag.local);
      scalar = { kind: tag.local, text: "" };
    }
  });
  const text = (value) => {
    if (scalar) scalar.text += value;
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    if (scalar && stack.length === 5) {
      if (scalar.kind === "ele") current.elevation = decimal(scalar.text);
      else current.time = timestamp(scalar.text);
      scalar = null;
    }
    if (current && stack.length === 4) {
      elevations.push(current.elevation);
      times.push(current.time);
      current = null;
    }
    stack.pop();
  });
  parser.write(xml).close();
  if (tracks !== 1 || segments !== 1) failure("unsupportedStructure");
  if (coordinates.length < 2) failure("unsupportedStructure");
  let distanceMeters = 0;
  const samples = [
    { distanceMeters: 0, elevationMeters: elevations[0], speedMps: null },
  ];
  let completeTiming = times[0] !== null;
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
  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i - 1];
    const [lon2, lat2] = coordinates[i];
    const edge = Geodesic.WGS84.Inverse(lat1, lon1, lat2, lon2).s12;
    distanceMeters += edge;
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
        failure();
    }
  }
  if (!(distanceMeters > 0) || !Number.isFinite(distanceMeters)) failure();
  const representations = [0, 1, 3, 4, 5].map((intermediateCount) => {
    const positions = [coordinates[0]];
    let edgeIndex = 1;
    for (let i = 1; i <= intermediateCount; i++) {
      const target = (distanceMeters * i) / (intermediateCount + 1);
      while (samples[edgeIndex].distanceMeters < target) edgeIndex++;
      if (samples[edgeIndex].distanceMeters === target) {
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
        target - samples[edgeIndex - 1].distanceMeters,
      );
      positions.push([position.lon2, position.lat2]);
    }
    positions.push(coordinates.at(-1));
    return {
      intermediateCount,
      geometry: { type: "LineString", coordinates: positions },
      directionlessEdges: positions.slice(1).map(([lon, lat], i) => {
        const [previousLon, previousLat] = positions[i];
        // The inverse handles equivalent dateline longitudes and polar positions.
        return (
          Geodesic.WGS84.Inverse(previousLat, previousLon, lat, lon).s12 === 0
        );
      }),
    };
  });
  return {
    version: 1,
    representations,
    geometry: { type: "LineString", coordinates },
    pointCount: coordinates.length,
    distanceMeters,
    samples,
    durationSeconds: completeTiming ? (times.at(-1) - times[0]) / 1000 : null,
    ascentMeters:
      elevationSampleCount === coordinates.length ? ascentMeters : null,
    descentMeters:
      elevationSampleCount === coordinates.length ? descentMeters : null,
    minElevationMeters,
    maxElevationMeters,
    elevationSampleCount,
  };
}
module.exports = { parseGpx };

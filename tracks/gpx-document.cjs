/* eslint-disable @typescript-eslint/no-require-imports -- Native Node worker asset must run without a bundler or TS loader. */
"use strict";
// Plain JavaScript is intentional: the bounded worker runs this exact asset in
// Node, including when its caller was compiled by Next/Turbopack.
const { SaxesParser } = require("saxes");
const GPX_LIMITS = Object.freeze({
  bytes: 10 * 1024 * 1024,
  tracks: 100,
  segments: 100,
  points: 100_000,
  elements: 500_000,
  depth: 64,
});
// XML Namespaces 1.0 NCName characters, matching the XML parser's accepted
// prefixes (including combining marks and supplementary-plane characters).
const ncNameStart =
  "A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const qNamePrefix = new RegExp(
  `[${ncNameStart}][${ncNameStart}.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040-]*:`,
  "gu",
);

function failure(code = "invalidFile", segment) {
  throw Object.assign(new Error(code), {
    code,
    ...(segment === undefined ? {} : { segment }),
  });
}

function decimal(value, segment) {
  if (
    typeof value !== "string" ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
  )
    failure("invalidSegment", segment);
  const number = Number(value);
  if (!Number.isFinite(number)) failure("invalidSegment", segment);
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

function scanGpx(bytes) {
  if (bytes.byteLength > GPX_LIMITS.bytes) failure("tooLarge");
  if (!bytes.byteLength) failure();
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let coordinates = [];
  let segmentStarts = [];
  let elevations = [];
  let times = [];
  let current = null;
  let scalar = null;
  const parser = new SaxesParser({ xmlns: true });
  const stack = [];
  let namespace;
  const results = [];
  let tracks = 0;
  let totalPoints = 0;
  let totalSegments = 0;
  let trackStart;
  let tagStart;
  let root;
  let prefixes = new Set();
  const rememberPrefix = (prefix) => {
    // Declarations inside the selected subtree travel with it verbatim. Only
    // bindings actually inherited from the document root must be supplied.
    if (stack.slice(1).some((tag) => Object.hasOwn(tag.ns, prefix))) return;
    if (Object.hasOwn(root.ns, prefix)) prefixes.add(prefix);
  };
  const rememberQNames = (value) => {
    for (const match of value.matchAll(qNamePrefix))
      rememberPrefix(match[0].slice(0, -1));
  };
  // SAX can split one logical text value at CDATA boundaries. Resolve QName
  // bindings from the complete adjacent text while its namespace scope is live.
  let textChunks = [];
  const flushText = () => {
    if (textChunks.length) rememberQNames(textChunks.join(""));
    textChunks = [];
  };
  parser.on("opentagstart", () => {
    tagStart = xml.lastIndexOf("<", parser.position - 1);
  });
  let segments = 0;
  let elements = 0;
  parser.on("xmldecl", ({ encoding }) => {
    if (encoding && encoding.toLowerCase() !== "utf-8") failure();
  });
  parser.on("doctype", () => failure());
  parser.on("processinginstruction", () => failure());
  parser.on("error", () => failure());
  parser.on("opentag", (tag) => {
    flushText();
    if (++elements > GPX_LIMITS.elements || stack.length >= GPX_LIMITS.depth)
      failure();
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
      root = tag;
      return;
    }
    if (stack[1]?.uri === namespace && stack[1]?.local === "trk") {
      if (stack.length === 2) prefixes = new Set();
      rememberPrefix(tag.prefix);
      for (const attribute of Object.values(tag.attributes)) {
        if (attribute.uri === "http://www.w3.org/2000/xmlns/") continue;
        if (attribute.prefix) rememberPrefix(attribute.prefix);
        rememberQNames(attribute.value);
      }
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
      if (++tracks > GPX_LIMITS.tracks) failure("tooManyTracks");
      coordinates = [];
      segmentStarts = [];
      elevations = [];
      times = [];
      segments = 0;
      trackStart = tagStart;
    }
    if (
      stack.length === 3 &&
      parent.uri === namespace &&
      parent.local === "trk" &&
      tag.local === "trkseg"
    ) {
      segments++;
      if (++totalSegments > GPX_LIMITS.segments) failure("tooManySegments");
      segmentStarts.push(coordinates.length);
    }
    if (
      stack.length === 4 &&
      stack[1].uri === namespace &&
      stack[1].local === "trk" &&
      parent.uri === namespace &&
      parent.local === "trkseg" &&
      tag.local === "trkpt"
    ) {
      if (++totalPoints > GPX_LIMITS.points) failure("tooManyPoints");
      const lat = decimal(tag.attributes.lat?.value, segments);
      const lon = decimal(tag.attributes.lon?.value, segments);
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180)
        failure("invalidSegment", segments);
      coordinates.push([lon, lat]);
      current = { elevation: null, time: null, seen: new Set() };
    }
    if (current && stack.length === 5 && ["ele", "time"].includes(tag.local)) {
      if (current.seen.has(tag.local)) failure("invalidSegment", segments);
      current.seen.add(tag.local);
      scalar = { kind: tag.local, text: "" };
    }
  });
  const text = (value) => {
    if (scalar) scalar.text += value;
    if (stack[1]?.uri === namespace && stack[1]?.local === "trk")
      textChunks.push(value);
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    flushText();
    if (scalar && stack.length === 5) {
      if (scalar.kind === "ele")
        current.elevation = decimal(scalar.text, segments);
      else current.time = timestamp(scalar.text);
      scalar = null;
    }
    if (current && stack.length === 4) {
      elevations.push(current.elevation);
      times.push(current.time);
      current = null;
    }
    const closing = stack.at(-1);
    if (
      stack.length === 3 &&
      closing.uri === namespace &&
      closing.local === "trkseg" &&
      coordinates.length - segmentStarts.at(-1) < 2
    )
      failure("invalidSegment", segments);
    if (
      stack.length === 2 &&
      closing.uri === namespace &&
      closing.local === "trk"
    ) {
      if (segments === 0) failure("unsupportedStructure");
      results.push({
        coordinates,
        segmentStarts,
        elevations,
        times,
        segments,
        xml: xml.slice(trackStart, parser.position),
        prefixes,
      });
    }
    stack.pop();
  });
  try {
    parser.write(xml).close();
    if (!tracks) failure("unsupportedStructure");
  } catch (error) {
    if (
      tracks >= 1 &&
      tracks <= GPX_LIMITS.tracks &&
      stack[1]?.uri === namespace &&
      stack[1]?.local === "trk"
    )
      error.track = tracks;
    throw error;
  }
  return { tracks: results, root };
}

module.exports = { scanGpx, GPX_LIMITS };

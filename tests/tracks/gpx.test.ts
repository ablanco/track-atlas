import assert from "node:assert/strict";
import test from "node:test";
import { parseGpx, processGpx } from "../../tracks/gpx";
import { TrackError } from "../../tracks/validation";

function gpx(points: string, version = "1.1") {
  return Buffer.from(
    `<gpx xmlns="http://www.topografix.com/GPX/${version.replace(".", "/")}" version="${version}"><trk><trkseg>${points}</trkseg></trk></gpx>`,
  );
}
const point = (lon: number, lat = 0, data = "") =>
  `<trkpt lat="${lat}" lon="${lon}">${data}</trkpt>`;

test("bounded worker exposes the same complete result and safe typed errors", async () => {
  const bytes = gpx(point(0) + point(1));
  assert.deepEqual(await processGpx(bytes), parseGpx(bytes));
  await assert.rejects(
    processGpx(Buffer.from("<bad/>")),
    (error: unknown) =>
      error instanceof TrackError && error.code === "invalidFile",
  );
  assert.throws(
    () => parseGpx(Buffer.from([0xff])),
    (error: unknown) =>
      error instanceof TrackError && error.code === "invalidFile",
  );
  await assert.rejects(
    processGpx(Buffer.alloc(10 * 1024 * 1024 + 1)),
    (error: unknown) =>
      error instanceof TrackError && error.code === "tooLarge",
  );
});

test("derives exactly five equal-distance Directional representations", () => {
  const result = parseGpx(gpx(point(0) + point(1) + point(6)));
  assert.equal(result.version, 1);
  assert.deepEqual(
    result.representations.map((r) => r.intermediateCount),
    [0, 1, 3, 4, 5],
  );
  for (const variant of result.representations) {
    assert.equal(
      variant.geometry.coordinates.length,
      variant.intermediateCount + 2,
    );
    assert.deepEqual(variant.geometry.coordinates[0], [0, 0]);
    assert.deepEqual(variant.geometry.coordinates.at(-1), [6, 0]);
    variant.geometry.coordinates.forEach(([lon, lat], i) => {
      assert.ok(
        Math.abs(lon - (i * 6) / (variant.intermediateCount + 1)) < 1e-10,
      );
      assert.ok(Math.abs(lat) < 1e-10);
    });
    assert.deepEqual(
      variant.directionlessEdges,
      Array(variant.intermediateCount + 1).fill(false),
    );
  }
});

test("preserves every position and measures an equatorial WGS84 degree", () => {
  const result = parseGpx(gpx(point(0) + point(0) + point(1)));
  assert.deepEqual(result.geometry.coordinates, [
    [0, 0],
    [0, 0],
    [1, 0],
  ]);
  assert.equal(result.pointCount, 3);
  assert.ok(Math.abs(result.distanceMeters - 111319.49079327357) < 0.000001);
});

test("extracts only the one GPX segment and rejects unsupported or hostile XML", () => {
  const good = gpx(point(0) + point(1)).toString();
  for (const xml of [
    good.replace("</trk>", "<trkseg/></trk>"),
    good.replace("</gpx>", "<trk/></gpx>"),
    good.replace("</gpx>", "<rte/></gpx>"),
    good.replace('lat="0"', 'lat="NaN"'),
    good.replace('lon="0"', 'lon="181"'),
    good.replace("<gpx", '<!DOCTYPE gpx [<!ENTITY x "boom">]><gpx'),
    good.replace("<gpx", '<?xml-stylesheet href="https://example.test"?><gpx'),
    good.replace("<gpx", '<?xml version="1.0" encoding="ISO-8859-1"?><gpx'),
    good.replace("GPX/1/1", "not-gpx"),
    good.replace("</gpx>", ""),
    good.replace("<trk>", `<trk>${"<x>".repeat(65)}${"</x>".repeat(65)}`),
  ])
    assert.throws(() => parseGpx(Buffer.from(xml)));
  assert.throws(() =>
    parseGpx(Buffer.concat([Buffer.from([0xff]), Buffer.from(good)])),
  );
  const decorated = good.replace(
    "<trk>",
    '<metadata xmlns:f="urn:foreign"><f:trkpt lat="50" lon="70"/></metadata><trk>',
  );
  assert.deepEqual(parseGpx(Buffer.from(decorated)).geometry.coordinates, [
    [0, 0],
    [1, 0],
  ]);
});

test("rejects misplaced core positions instead of silently losing geometry", () => {
  const base = gpx(point(0) + point(1)).toString();
  for (const extra of ['<trkpt lat="1" lon="2"/>', "<trkseg/>", "<trk/>"]) {
    const xml = base.replace(
      "</trkseg>",
      `<unexpected>${extra}</unexpected></trkseg>`,
    );
    assert.throws(
      () => parseGpx(Buffer.from(xml)),
      (error: unknown) =>
        error instanceof TrackError && error.code === "unsupportedStructure",
    );
  }
});

test("supports GPX 1.0/1.1 and prefixed namespaces without extension telemetry", () => {
  for (const version of ["1.0", "1.1"]) {
    const xml = gpx(
      point(
        0,
        0,
        '<extensions><ele>999</ele><time>2024-01-01T00:00:00Z</time><trkpt lat="5" lon="5"/></extensions>',
      ) + point(1),
      version,
    ).toString();
    const prefixed = xml
      .replace(
        /<(\/?)(gpx|trk|trkseg|trkpt|extensions|ele|time)(?=[\s/>])/g,
        "<$1g:$2",
      )
      .replace("xmlns=", "xmlns:g=");
    const parsed = parseGpx(Buffer.from(prefixed));
    assert.deepEqual(parsed.geometry.coordinates, [
      [0, 0],
      [1, 0],
    ]);
    assert.equal(parsed.elevationSampleCount, 0);
    assert.equal(parsed.ascentMeters, null);
    assert.equal(parsed.minElevationMeters, null);
    assert.equal(parsed.maxElevationMeters, null);
    assert.equal(parsed.durationSeconds, null);
  }
  const foreign = gpx(
    point(0, 0, '<x:ele xmlns:x="urn:telemetry">999</x:ele>') + point(1),
  );
  assert.equal(parseGpx(foreign).elevationSampleCount, 0);
});

test("interpolates through the dateline and over the pole using WGS84", () => {
  const crossing = parseGpx(gpx(point(179) + point(-179)));
  assert.ok(Math.abs(crossing.distanceMeters - 222638.98158654713) < 1e-6);
  const [lon, lat] = crossing.representations[1].geometry.coordinates[1];
  assert.equal(Math.abs(lon), 180);
  assert.equal(lat, 0);
  const polar = parseGpx(gpx(point(-90, 80) + point(90, 80)));
  // Independent WGS84 meridian-radius integration of the 80°→90° arc, twice.
  assert.ok(Math.abs(polar.distanceMeters - 2233651.7147517395) < 1e-5);
  assert.equal(polar.representations[1].geometry.coordinates[1][1], 90);
});

test("nonzero microscopic edges are not silently classified as directionless", () => {
  const result = parseGpx(
    gpx('<trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.00000000000001"/>'),
  );
  assert.ok(result.distanceMeters > 0);
  assert.deepEqual(result.representations[0].directionlessEdges, [false]);
});

test("loops and duplicate boundary positions retain directionless representations", () => {
  const result = parseGpx(
    gpx(
      point(0) +
        point(0) +
        point(1) +
        point(2) +
        point(2) +
        point(1) +
        point(0),
    ),
  );
  assert.equal(result.pointCount, 7);
  assert.deepEqual(result.representations[0].directionlessEdges, [true]);
  assert.deepEqual(result.representations[1].geometry.coordinates, [
    [0, 0],
    [2, 0],
    [0, 0],
  ]);
  const exact = parseGpx(gpx(point(0) + point(1) + point(1) + point(2)));
  assert.deepEqual(exact.representations[1].geometry.coordinates, [
    [0, 0],
    [1, 0],
    [2, 0],
  ]);
  for (const bytes of [
    gpx(point(0)),
    gpx(point(0) + point(0)),
    gpx(point(-180) + point(180)),
    gpx(point(-90, 90) + point(90, 90)),
  ]) {
    assert.throws(() => parseGpx(bytes), TrackError);
  }
});

test("rejects malformed numerics, entities, shadow attributes and nested scalar markup", () => {
  for (const value of [
    "NaN",
    "Infinity",
    "1e2",
    "0x10",
    "",
    "1 2",
    "91",
    "-91",
    "1".repeat(310),
  ]) {
    assert.throws(
      () => parseGpx(gpx(`<trkpt lat="${value}" lon="0"/>` + point(1))),
      TrackError,
    );
  }
  for (const data of [
    "<ele>NaN</ele>",
    "<ele>Infinity</ele>",
    "<ele/>",
    "<ele>1</ele><ele>2</ele>",
    "<time>bad</time><time>bad</time>",
    "<ele><x>1</x></ele>",
    "<ele>&unknown;</ele>",
  ]) {
    assert.throws(
      () => parseGpx(gpx(point(0, 0, data) + point(1))),
      TrackError,
    );
  }
  assert.throws(
    () =>
      parseGpx(gpx('<trkpt xmlns:x="urn:x" x:lat="0" lon="0"/>' + point(1))),
    TrackError,
  );
  assert.throws(
    () =>
      parseGpx(
        gpx(
          point(0, 0, `<ele>${"9".repeat(308)}</ele>`) +
            point(1, 0, `<ele>-${"9".repeat(308)}</ele>`),
        ),
      ),
    TrackError,
  );
  const plain = gpx(point(0) + point(1)).toString();
  for (const prefix of [
    '<!DOCTYPE gpx SYSTEM "file:///etc/passwd">',
    '<!DOCTYPE gpx [<!ENTITY x SYSTEM "https://example.test/">]>',
  ]) {
    assert.throws(() => parseGpx(Buffer.from(prefix + plain)), TrackError);
  }
});

test("unusable or non-increasing timestamps cause local speed gaps, never geometry rejection", () => {
  for (const unusable of [
    "",
    "2024-01-01T00:00:00",
    "2024-02-30T00:00:00Z",
    "2023-02-29T00:00:00Z",
    "2024-01-01T24:00:00Z",
    "2024-01-01T00:00:60Z",
    "2024-01-01T00:00:00+15:00",
    "2024-01-01T00:00:00Z",
    "2023-12-31T23:59:59Z",
  ]) {
    const result = parseGpx(
      gpx(
        point(0, 0, "<time>2024-01-01T00:00:00Z</time>") +
          point(1, 0, `<time>${unusable}</time>`) +
          point(2, 0, "<time>2024-01-01T00:00:20Z</time>"),
      ),
    );
    assert.equal(result.durationSeconds, null);
    assert.equal(result.samples[1].speedMps, null);
    assert.equal(result.pointCount, 3);
  }
  const localRecovery = parseGpx(
    gpx(
      point(0) +
        point(1, 0, "<time>2024-01-01T00:00:10Z</time>") +
        point(2, 0, "<time>2024-01-01T00:00:20Z</time>"),
    ),
  );
  assert.equal(localRecovery.durationSeconds, null);
  assert.ok(
    Math.abs(localRecovery.samples[2].speedMps! - 11131.949079327357) < 1e-8,
  );
  const zones = parseGpx(
    gpx(
      point(0, 0, "<time>2024-02-29T01:00:00+01:00</time>") +
        point(1, 0, "<time>2024-02-29T00:00:10Z</time>"),
    ),
  );
  assert.equal(zones.durationSeconds, 10);
});

test("records duration including stops, raw elevation deltas, and sample gaps", () => {
  const result = parseGpx(
    gpx(
      point(0, 0, "<ele>10</ele><time>2024-01-01T00:00:00Z</time>") +
        point(0, 0, "<ele>25</ele><time>2024-01-01T00:00:10Z</time>") +
        point(1, 0, "<ele>20</ele><time>2024-01-01T00:00:20Z</time>"),
    ),
  );
  assert.equal(result.durationSeconds, 20);
  assert.equal(result.ascentMeters, 15);
  assert.equal(result.descentMeters, 5);
  assert.equal(result.minElevationMeters, 10);
  assert.equal(result.maxElevationMeters, 25);
  assert.equal(result.elevationSampleCount, 3);
  assert.deepEqual(
    result.samples.map((s) => s.speedMps),
    [null, 0, 11131.949079327357],
  );
  const partial = parseGpx(
    gpx(
      point(0, 0, "<ele>10</ele><time>2024-01-01T00:00:00Z</time>") +
        point(1) +
        point(2, 0, "<ele>20</ele><time>2024-01-01T00:00:20Z</time>"),
    ),
  );
  assert.equal(partial.durationSeconds, null);
  assert.equal(partial.ascentMeters, null);
  assert.equal(partial.descentMeters, null);
  assert.equal(partial.elevationSampleCount, 2);
  assert.equal(partial.minElevationMeters, 10);
  assert.deepEqual(
    partial.samples.map((s) => s.elevationMeters),
    [10, null, 20],
  );
  assert.deepEqual(
    partial.samples.map((s) => s.speedMps),
    [null, null, null],
  );
});

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import {
  previewGpxUpload,
  generateTrackTitles,
} from "../../tracks/gpx-preview";
import { TrackError } from "../../tracks/validation";
import {
  parseGpx,
  processGpx,
  parseGpxDocument,
  processGpxDocument,
} from "../../tracks/gpx";

const segment =
  '<trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/></trkseg>';
const document = (...tracks: string[]) =>
  Buffer.from(
    `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">${tracks.join("")}</gpx>`,
  );
const track = (body = segment) => `<trk>${body}</trk>`;

test("one bounded parse derives ordered independent Tracks and standalone downloads", async () => {
  const bytes = document(track(), track(segment + segment));
  const result = parseGpxDocument(bytes);
  assert.equal(result.tracks.length, 2);
  assert.deepEqual(
    result.tracks.map((t) => [
      t.trackIndex,
      t.data.segmentCount,
      t.data.pointCount,
    ]),
    [
      [0, 1, 2],
      [1, 2, 4],
    ],
  );
  for (const output of result.tracks) {
    assert.deepEqual(parseGpx(Buffer.from(output.gpx)), output.data);
    assert.equal(output.data.samples[0].distanceMeters, 0);
    assert.equal(output.data.samples[0].speedMps, null);
  }
  assert.deepEqual(await processGpxDocument(bytes), result);
});

test("singleton keeps exact uploaded bytes; multi-track keeps verbatim selected XML and namespaces only", () => {
  for (const version of ["1.0", "1.1"]) {
    const selected = `<g:trk><g:name><![CDATA[á & 😀]]></g:name>${segment.replaceAll("<", "<g:").replaceAll("<g:/", "</g:")}<g:extensions><x:data x:value="42">secret-local</x:data></g:extensions></g:trk>`;
    const bytes = Buffer.from(
      `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n<g:gpx xmlns:g="http://www.topografix.com/GPX/${version.replace(".", "/")}" xmlns:x="urn:telemetry" version="${version}" creator="private-global"><g:metadata>secret-global</g:metadata><g:wpt lat="1" lon="1"/>${selected}<g:trk>${segment.replaceAll("<", "<g:").replaceAll("<g:/", "</g:")}</g:trk><g:extensions>secret-global</g:extensions></g:gpx>`,
    );
    const result = parseGpxDocument(bytes);
    const first = Buffer.from(result.tracks[0].gpx).toString();
    const second = Buffer.from(result.tracks[1].gpx).toString();
    assert.ok(first.includes(selected));
    assert.ok(
      !first.includes("secret-global") &&
        !first.includes("private-global") &&
        !first.includes("wpt"),
    );
    assert.ok(!second.includes("secret-local"));
    assert.deepEqual(
      parseGpx(Buffer.from(result.tracks[0].gpx)),
      result.tracks[0].data,
    );
    assert.deepEqual(
      parseGpxDocument(Buffer.from(first)).tracks[0].gpx,
      new Uint8Array(Buffer.from(first)),
    );
    const singleton = Buffer.from(
      `\uFEFF<?xml version="1.0"?>\r\n<gpx xmlns="http://www.topografix.com/GPX/${version.replace(".", "/")}" version="${version}"><metadata>keep me</metadata>${track()}</gpx>`,
    );
    assert.deepEqual(
      parseGpxDocument(singleton).tracks[0].gpx,
      new Uint8Array(singleton),
    );
  }
});

test("invalid later Tracks reject all with one-based Track and local segment ordinals", async () => {
  const invalids = [
    { body: track(""), code: "unsupportedStructure", segment: undefined },
    { body: track(segment + "<trkseg/>"), code: "invalidSegment", segment: 2 },
    {
      body: track('<trkseg><trkpt lat="bad" lon="0"/></trkseg>'),
      code: "invalidSegment",
      segment: 1,
    },
    {
      body: track(
        '<trkseg><trkpt lat="0" lon="1"/><trkpt lat="0" lon="1"/></trkseg>',
      ),
      code: "invalidSegment",
      segment: 1,
    },
  ];
  for (const invalid of invalids) {
    for (const read of [parseGpxDocument, processGpxDocument]) {
      await assert.rejects(
        async () => read(document(track(), invalid.body)),
        (error: unknown) => {
          assert.ok(error instanceof TrackError);
          assert.deepEqual(
            [error.code, error.track, error.segment],
            [invalid.code, 2, invalid.segment],
          );
          return true;
        },
      );
    }
  }
});

test("browser preview shares ordered count and Unicode-safe numbered title rules", () => {
  assert.deepEqual(
    previewGpxUpload(document(track(), track()), "Mountain trip"),
    {
      trackCount: 2,
      titles: ["Mountain trip 1", "Mountain trip 2"],
      firstPhotoTrackIndex: 0,
    },
  );
  assert.deepEqual(generateTrackTitles("  Walk 😀  ", 1), ["  Walk 😀  "]);
  const titles = generateTrackTitles("😀".repeat(200), 100);
  assert.equal(titles[0], "😀".repeat(198) + " 1");
  assert.equal(titles[99], "😀".repeat(196) + " 100");
  assert.deepEqual(previewGpxUpload(document(track()), "Walk").titles, [
    "Walk",
  ]);
  for (const count of [0, 101, NaN, 1.5])
    assert.throws(() => generateTrackTitles("Walk", count));
});

test("upload-wide track, segment, point, byte, depth and element ceilings reject without truncation", () => {
  const atCap = document(...Array(100).fill(track()));
  assert.equal(parseGpxDocument(atCap).tracks.length, 100);
  const bad = [
    [document(...Array(101).fill(track())), "tooManyTracks"],
    [
      document(track(segment.repeat(99)), track(segment.repeat(2))),
      "tooManySegments",
    ],
    [
      document(
        track(segment),
        track(`<trkseg>${'<trkpt lat="0" lon="0"/>'.repeat(99_999)}</trkseg>`),
      ),
      "tooManyPoints",
    ],
    [Buffer.alloc(10 * 1024 * 1024 + 1), "tooLarge"],
    [
      document(
        track(),
        "<extensions>" + "<x>".repeat(64) + "</x>".repeat(64) + "</extensions>",
      ),
      "invalidFile",
    ],
    [
      document(
        track(),
        "<extensions>" + "<x/>".repeat(500_000) + "</extensions>",
      ),
      "invalidFile",
    ],
    [document(track(), "<rte/>"), "unsupportedStructure"],
    [document('<wpt lat="0" lon="0"/>'), "unsupportedStructure"],
  ] as const;
  for (const [bytes, code] of bad) {
    for (const read of [
      parseGpxDocument,
      (bytes: Uint8Array) => previewGpxUpload(bytes, "Walk"),
    ])
      assert.throws(
        () => read(bytes),
        (error: unknown) => error instanceof TrackError && error.code === code,
      );
  }
  const padding = Buffer.alloc(10 * 1024 * 1024 - atCap.length, " ");
  assert.equal(
    parseGpxDocument(Buffer.concat([atCap, padding])).tracks.length,
    100,
  );
});

test("document and legacy workers share admission and release capacity", async () => {
  const bytes = document(track(), track());
  const first = processGpxDocument(bytes);
  const second = processGpx(document(track()));
  await assert.rejects(
    processGpxDocument(bytes),
    (error: unknown) =>
      error instanceof TrackError && error.code === "processingTimeout",
  );
  assert.equal((await first).tracks.length, 2);
  assert.equal((await second).pointCount, 2);
  assert.equal((await processGpxDocument(bytes)).tracks.length, 2);
});

test("XML depth and element limits accept their exact upload-wide boundaries", () => {
  assert.equal(
    parseGpxDocument(
      document(
        track(),
        "<extensions>" + "<x>".repeat(62) + "</x>".repeat(62) + "</extensions>",
      ),
    ).tracks.length,
    1,
  );
  assert.equal(
    parseGpxDocument(
      document(
        track(),
        "<extensions>" + "<x/>".repeat(499_994) + "</extensions>",
      ),
    ).tracks.length,
    1,
  );
});

test("global XML failures do not falsely identify the last completed Track", () => {
  assert.throws(
    () => parseGpxDocument(document(track(), "<rte/>")),
    (error: unknown) => {
      assert.ok(error instanceof TrackError);
      assert.equal(error.code, "unsupportedStructure");
      assert.equal(error.track, undefined);
      return true;
    },
  );
});

test("standalone output omits unused document-wide namespace bindings", () => {
  const bytes = Buffer.from(
    `<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:private="urn:sibling-only" version="1.1">${track()}${track("<extensions><private:data/></extensions>" + segment)}</gpx>`,
  );
  const result = parseGpxDocument(bytes);
  assert.ok(
    !Buffer.from(result.tracks[0].gpx).toString().includes("urn:sibling-only"),
  );
  assert.ok(
    Buffer.from(result.tracks[1].gpx)
      .toString()
      .includes('xmlns:private="urn:sibling-only"'),
  );
});

test("isolated namespaces respect local shadows and decoded QName extension values", () => {
  const bytes = Buffer.from(
    `<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:x="urn:private-global" xmlns:q="urn:qname" version="1.1">${track('<extensions xmlns:x="urn:local"><x:data type="q&#58;sample">q:reading</x:data></extensions>' + segment)}${track()}</gpx>`,
  );
  const output = Buffer.from(parseGpxDocument(bytes).tracks[0].gpx).toString();
  assert.ok(!output.includes("urn:private-global"));
  assert.ok(output.includes('xmlns:x="urn:local"'));
  assert.ok(output.includes('xmlns:q="urn:qname"'));
  assert.equal(parseGpx(Buffer.from(output)).pointCount, 2);
});

test("standalone downloads preserve QName extension values split across XML text and CDATA", async () => {
  const bytes = Buffer.from(
    `<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:q="urn:recorded-sensor" version="1.1">${track("<extensions><value>q<![CDATA[:reading]]></value></extensions>" + segment)}${track()}</gpx>`,
  );
  const result = await processGpxDocument(bytes);
  const xml = Buffer.from(result.tracks[0].gpx).toString();
  assert.ok(xml.includes('xmlns:q="urn:recorded-sensor"'));
  assert.ok(xml.includes("<value>q<![CDATA[:reading]]></value>"));
  assert.ok(
    !Buffer.from(result.tracks[1].gpx)
      .toString()
      .includes("urn:recorded-sensor"),
  );
  assert.deepEqual(parseGpx(Buffer.from(xml)), result.tracks[0].data);
});

for (const version of ["1.0", "1.1"]) {
  test(`GPX ${version} recorded values, local measurements and verbatim subtrees survive standalone worker downloads`, async () => {
    const bytes = await readFile(
      new URL(`../fixtures/gpx/multi-track-${version}.gpx`, import.meta.url),
    );
    const source = bytes.toString();
    const result = await processGpxDocument(bytes);
    assert.equal(result.tracks.length, 2);
    const [first, second] = result.tracks;
    assert.deepEqual(first.data.geometry.coordinates, [
      [
        [-3, 40],
        [-3, 40],
        [-3.001, 40.001],
      ],
      [
        [-3.001, 40.001],
        [-3.002, 40.002],
      ],
    ]);
    assert.deepEqual(second.data.geometry.coordinates, [
      [
        [1, 1],
        [1.01, 1],
      ],
      [
        [2, 2],
        [2.01, 2],
      ],
    ]);
    assert.deepEqual(first.data.segmentStarts, [0, 3]);
    assert.deepEqual(second.data.segmentStarts, [0, 2]);
    assert.deepEqual(
      first.data.samples.map((s) => s.elevationMeters),
      [10, 12, 20, 1000, 1010],
    );
    assert.deepEqual(
      second.data.samples.map((s) => s.elevationMeters),
      [100, null, -5, 5],
    );
    assert.equal(first.data.durationSeconds, 180);
    assert.equal(first.data.ascentMeters, 20);
    assert.equal(first.data.descentMeters, 0);
    assert.equal(first.data.samples[1].speedMps, 0);
    assert.equal(second.data.durationSeconds, 60);
    assert.equal(second.data.ascentMeters, null);
    assert.equal(second.data.descentMeters, null);
    const subtrees = source.match(/<trk>[\s\S]*?<\/trk>/g)!;
    for (const [index, output] of result.tracks.entries()) {
      const xml = Buffer.from(output.gpx).toString();
      assert.ok(xml.includes(subtrees[index]));
      assert.ok(!xml.includes(subtrees[1 - index]));
      assert.ok(!xml.includes("global-private"));
      assert.deepEqual(parseGpx(Buffer.from(output.gpx)), output.data);
      for (const start of output.data.segmentStarts) {
        assert.equal(output.data.samples[start].speedMps, null);
        if (start)
          assert.equal(
            output.data.samples[start].distanceMeters,
            output.data.samples[start - 1].distanceMeters,
          );
      }
      // The download, uploaded as a singleton, remains byte-exact including XML spelling.
      assert.deepEqual(
        (await processGpxDocument(output.gpx)).tracks[0].gpx,
        output.gpx,
      );
    }
  });
}

import symbols from "../fixtures/gpx/poi-symbols.json";
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGpxWaypoints,
  processGpxWaypoints,
  processGpx,
  processGpxDocument,
} from "../../tracks/gpx";
import { TrackError } from "../../tracks/validation";

const path =
  '<trk><trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.01" lon="-3.01"/></trkseg></trk>';
const document = (body: string, version = "1.1") =>
  Buffer.from(
    `<gpx xmlns="http://www.topografix.com/GPX/${version.replace(".", "/")}" version="${version}">${body}</gpx>`,
  );

test("retained singleton waypoints preserve order, decoded plain text and off-path positions", async () => {
  for (const version of ["1.0", "1.1"]) {
    const bytes = document(
      '<wpt lat="40" lon="-3"><name> Spring <![CDATA[& shade]]></name><desc>&lt;img src="https://example.test"&gt;\nwater</desc></wpt><wpt lat="0" lon="180"><name>  </name></wpt>' +
        path,
      version,
    );
    const expected = [
      {
        position: [-3, 40],
        name: "Spring & shade",
        description: '<img src="https://example.test">\nwater',
        category: "generic",
      },
      { position: [180, 0], name: "", description: "", category: "generic" },
    ];
    assert.deepEqual(parseGpxWaypoints(bytes), expected);
    assert.deepEqual(await processGpxWaypoints(bytes), expected);
  }
});

test("invalid standalone coordinates are skipped while malformed XML and resource limits still reject", async () => {
  const invalid = [
    'lat="NaN" lon="0"',
    'lat="91" lon="0"',
    'lat="0" lon="181"',
    'lat="" lon="0"',
    'lon="0"',
    'lat="0"',
    'lat="1e1" lon="0"',
  ];
  const bytes = document(
    invalid.map((attrs) => `<wpt ${attrs}><name>skip</name></wpt>`).join("") +
      '<wpt lat="-90" lon="-180"/>' +
      path,
  );
  assert.deepEqual(await processGpxWaypoints(bytes), [
    { position: [-180, -90], name: "", description: "", category: "generic" },
  ]);
  for (const read of [parseGpxWaypoints, processGpxWaypoints]) {
    for (const bad of [
      document('<wpt lat="0" lon="0">' + path),
      document("<!DOCTYPE gpx>" + path),
      document(
        "<extensions>" +
          "<x>".repeat(64) +
          "</x>".repeat(64) +
          "</extensions>" +
          path,
      ),
      Buffer.alloc(10 * 1024 * 1024 + 1),
    ])
      await assert.rejects(async () => read(bad));
    assert.deepEqual(await read(document(path)), []);
    assert.deepEqual(
      await read(document('<wpt lat="0" lon="0"/>' + path + path)),
      [],
    );
  }
});

test("waypoint extraction keeps all entries within existing input limits and does not truncate metadata", async () => {
  const description = "water & shade ".repeat(10_000);
  const bytes = document(
    '<wpt lat="0" lon="0"><name>First</name><desc>' +
      description.replaceAll("&", "&amp;") +
      "</desc></wpt>" +
      '<wpt lat="1" lon="2"/>'.repeat(100_000) +
      path,
  );
  const result = await processGpxWaypoints(bytes);
  assert.equal(result.length, 100_001);
  assert.equal(result[0].description, description.trim());
  assert.deepEqual(result.at(-1), {
    position: [2, 1],
    name: "",
    description: "",
    category: "generic",
  });
});

test("read-time extraction shares upload worker admission and releases capacity", async () => {
  const first = processGpxWaypoints(document(path));
  const second = processGpxDocument(document(path));
  await assert.rejects(
    processGpx(document(path)),
    (error) =>
      error instanceof TrackError && error.code === "processingTimeout",
  );
  assert.deepEqual(await first, []);
  assert.equal((await second).tracks.length, 1);
  assert.deepEqual(await processGpxWaypoints(document(path)), []);
});

test("retained GPX category metadata resolves through the same parser and bounded worker", async () => {
  const bytes = document(
    '<wpt lat="40" lon="-3"><type>  DRINKING_\tWATER </type></wpt>' +
      '<wpt lat="40" lon="-3.001"><sym>Shelter</sym></wpt>' +
      '<wpt lat="40" lon="-3.002"><sym>Scenic Area</sym></wpt>' +
      '<wpt lat="40" lon="-3.003"><type>Parking</type></wpt>' +
      '<wpt lat="40" lon="-3.004"><sym>Restaurant</sym></wpt>' +
      path,
  );
  const expected = ["drinkingWater", "shelter", "viewpoint", "parking", "food"];
  assert.deepEqual(
    parseGpxWaypoints(bytes).map((w) => w.category),
    expected,
  );
  assert.deepEqual(
    (await processGpxWaypoints(bytes)).map((w) => w.category),
    expected,
  );
});

test("category precedence is type then symbol then exact Garmin categories, skipping unknown values", async () => {
  const extension = (
    value: string,
    uri = "http://www.garmin.com/xmlschemas/GpxExtensions/v3",
  ) =>
    `<extensions><g:WaypointExtension xmlns:g="${uri}"><g:Categories><g:Category>${value}</g:Category></g:Categories></g:WaypointExtension></extensions>`;
  const values = [
    "<type>food</type><sym>Shelter</sym>" + extension("Parking"),
    "<sym>Shelter</sym><type>food</type>",
    "<type>unknown</type><sym>Parking Area</sym>" + extension("Food"),
    "<type> </type><sym>unknown</sym>" + extension("Viewpoint"),
    extension("unknown") + extension("Drinking-Water"),
    extension("Shelter", "urn:untrusted"),
    "<extensions><type>food</type><sym>Shelter</sym></extensions>",
    "<type><b/>food</type>",
    "<type>constructor</type><sym>toString</sym>",
    "<type>https://example.test/food.svg</type><sym>&lt;svg&gt;food&lt;/svg&gt;</sym>",
    "<type>food/restaurant</type>",
    "<type>food</type><type>parking</type>",
    "",
  ];
  for (const version of ["1.0", "1.1"]) {
    const bytes = document(
      values.map((value) => `<wpt lat="0" lon="0">${value}</wpt>`).join("") +
        path,
      version,
    );
    const expected = [
      "food",
      "food",
      "parking",
      "viewpoint",
      "drinkingWater",
      "generic",
      "generic",
      "generic",
      "generic",
      "generic",
      "generic",
      "food",
      "generic",
    ];
    assert.deepEqual(
      parseGpxWaypoints(bytes).map((w) => w.category),
      expected,
    );
    assert.deepEqual(
      (await processGpxWaypoints(bytes)).map((w) => w.category),
      expected,
    );
  }
});

test("expanded source symbols resolve in GPX 1.0/1.1 core and Garmin fields", async () => {
  for (const version of ["1.0", "1.1"]) {
    for (const field of ["type", "sym", "extension"]) {
      const body = symbols
        .map(({ source }, index) => {
          const value = `  ${source.toUpperCase().replaceAll(" ", "_- ")}  `;
          const metadata =
            field === "extension"
              ? `<extensions><g:WaypointExtension xmlns:g="http://www.garmin.com/xmlschemas/GpxExtensions/v3"><g:Categories><g:Category>${value}</g:Category></g:Categories></g:WaypointExtension></extensions>`
              : `<${field}>${value}</${field}>`;
          return `<wpt lat="40" lon="-3"><name>Symbol ${index}</name>${metadata}</wpt>`;
        })
        .join("");
      const bytes = document(body + path, version);
      const expected = symbols.map(({ category }) => category);
      assert.deepEqual(
        parseGpxWaypoints(bytes).map((w) => w.category),
        expected,
      );
      assert.deepEqual(
        (await processGpxWaypoints(bytes)).map((w) => w.category),
        expected,
      );
    }
  }
});

test("water sources, campsites and cars retain meanings separate from drinking water, shelter and parking", () => {
  const values = [
    "Water Source",
    "Drinking Water",
    "Campground",
    "Shelter",
    "Car",
    "Parking Area",
    "water",
    "water source unsafe",
    "hotel.svg",
  ];
  const bytes = document(
    values
      .map((value) => `<wpt lat="40" lon="-3"><sym>${value}</sym></wpt>`)
      .join("") + path,
  );
  assert.deepEqual(
    parseGpxWaypoints(bytes).map((w) => w.category),
    [
      "waterSource",
      "drinkingWater",
      "campsite",
      "shelter",
      "car",
      "parking",
      "generic",
      "generic",
      "generic",
    ],
  );
});

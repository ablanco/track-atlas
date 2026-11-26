import assert from "node:assert/strict";
import { test } from "node:test";
import { createForecastService } from "../../weather/forecast";

const now = Date.parse("2026-11-25T00:00:00Z");
const geometry = {
  type: "MultiLineString" as const,
  coordinates: [
    [
      [139.6917, 35.6895],
      [0, 0],
      [139.6917, 35.6895],
    ],
    [
      [-3, 40],
      [-4, 41],
    ],
  ] as [number, number][][],
};
function payload() {
  return {
    properties: {
      meta: {
        updated_at: "2026-11-24T23:00:00Z",
        units: {
          air_temperature: "celsius",
          wind_speed: "m/s",
          precipitation_amount: "mm",
        },
      },
      timeseries: [0, 6, 12, 144, 150].map((hours) => ({
        time: new Date(now + hours * 3600000).toISOString(),
        data: {
          instant: { details: { air_temperature: 12, wind_speed: 5 } },
          next_6_hours: {
            summary: { symbol_code: "rain_day" },
            details: { precipitation_amount: 2.5 },
          },
        },
      })),
    },
  };
}
test("forecast uses recorded start and current horizon, offline local timezone and metric units", async () => {
  const service = createForecastService({
    now: () => now,
    fetch: async (url, init) => {
      assert.equal(
        String(url),
        "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=35.6895&lon=139.6917",
      );
      assert.match(
        new Headers(init?.headers).get("user-agent")!,
        /github.com\/ablanco\/track-atlas/,
      );
      return Response.json(payload());
    },
  });
  const result = await service(geometry);
  assert.ok(result);
  assert.equal(result.timeZone, "Asia/Tokyo");
  assert.equal(result.periods.length, 3);
  assert.deepEqual(result.periods[0], {
    time: "2026-11-25T00:00:00.000Z",
    temperature: 12,
    wind: 18,
    precipitation: 2.5,
    periodHours: 6,
    condition: "rain",
  });
  assert.equal(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: result.timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(result.periods[0].time)),
    "09",
  );
});
test("coalesces coordinates, honors later expiry and conditionally refreshes without serving stale failures", async () => {
  let clock = now,
    calls = 0;
  const service = createForecastService({
    now: () => clock,
    fetch: async (_url, init) => {
      calls++;
      if (calls === 1)
        return Response.json(payload(), {
          headers: {
            expires: new Date(now + 4 * 3600000).toUTCString(),
            "last-modified": new Date(now - 3600000).toUTCString(),
          },
        });
      assert.equal(
        new Headers(init?.headers).get("if-modified-since"),
        "Tue, 24 Nov 2026 23:00:00 GMT",
      );
      if (calls === 2) return new Response(null, { status: 304 });
      return new Response(null, { status: 503 });
    },
  });
  const [a, b] = await Promise.all([service(geometry), service(geometry)]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  clock += 3 * 3600000;
  assert.ok(await service(geometry));
  assert.equal(calls, 1);
  clock += 3600000;
  assert.equal(
    (await service(geometry))?.periods[0].time,
    "2026-11-25T06:00:00.000Z",
  );
  assert.equal(calls, 2);
  clock += 3 * 3600000;
  assert.equal(await service(geometry), null);
  assert.equal(await service(geometry), null);
  assert.equal(calls, 3);
});
for (const failure of [
  "timeout",
  "quota",
  "invalid",
  "stale",
  "empty",
] as const)
  test(`forecast fails closed for ${failure}`, async () => {
    const service = createForecastService({
      now: () => now,
      fetch: async (_url, init) => {
        assert.ok(init?.signal);
        if (failure === "timeout")
          throw new DOMException("timeout", "TimeoutError");
        if (failure === "quota") return new Response(null, { status: 429 });
        if (failure === "invalid") return new Response("broken JSON");
        const body = payload();
        if (failure === "stale")
          body.properties.meta.updated_at = "2026-11-20T00:00:00Z";
        if (failure === "empty") body.properties.timeseries = [];
        return Response.json(body);
      },
    });
    assert.equal(await service(geometry), null);
  });
test("partial values stay missing, one-hour precipitation is labeled and timezone observes DST", async () => {
  const body = payload();
  const row = body.properties.timeseries[0];
  const data = row.data as unknown as Record<string, unknown>;
  data.instant = { details: { air_temperature: 0 } };
  delete data.next_6_hours;
  data.next_1_hours = {
    summary: { symbol_code: "sleet_night" },
    details: { precipitation_amount: 0 },
  };
  const service = createForecastService({
    now: () => now,
    fetch: async () => Response.json(body),
  });
  const result = await service({
    type: "MultiLineString",
    coordinates: [
      [
        [-3.7, 40.4],
        [0, 0],
      ],
    ],
  });
  assert.equal(result?.timeZone, "Europe/Madrid");
  assert.deepEqual(result?.periods[0], {
    time: "2026-11-25T00:00:00.000Z",
    temperature: 0,
    wind: null,
    precipitation: 0,
    periodHours: 1,
    condition: "sleet",
  });
  const format = (time: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: result!.timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(time));
  assert.equal(format("2026-03-29T00:00:00Z"), "01");
  assert.equal(format("2026-03-29T01:00:00Z"), "03");
});
test("invalid or absent start never falls through to a later segment or requests provider", async () => {
  const service = createForecastService({
    fetch: async () => {
      throw Error("must not request");
    },
  });
  assert.equal(
    await service({
      type: "MultiLineString",
      coordinates: [
        [],
        [
          [0, 0],
          [1, 1],
        ],
      ],
    }),
    null,
  );
  assert.equal(
    await service({
      type: "MultiLineString",
      coordinates: [
        [
          [200, 0],
          [1, 1],
        ],
      ],
    }),
    null,
  );
});
test("coordinate truncation coalesces cache while a different coordinate cannot reuse another result", async () => {
  let calls = 0,
    clock = now;
  const service = createForecastService({
    now: () => clock,
    fetch: async (url) => {
      calls++;
      assert.match(String(url), /lat=40.1234&lon=-3.1234/);
      return Response.json(payload());
    },
  });
  const at = (lon: number) => ({
    type: "MultiLineString" as const,
    coordinates: [
      [
        [lon, 40.123456],
        [0, 0],
      ],
    ] as [number, number][][],
  });
  assert.ok(await service(at(-3.123456)));
  assert.ok(await service(at(-3.123499)));
  assert.equal(calls, 1);
  assert.equal(await service(at(2)), null); // ten/sec admission, no cross-coordinate fallback
  clock += 100;
});
test("a future timestamp with no usable weather fields is unavailable", async () => {
  const service = createForecastService({
    now: () => now,
    fetch: async () =>
      Response.json({
        properties: {
          meta: { updated_at: "2026-11-25T00:00:00Z" },
          timeseries: [{ time: "2026-11-25T06:00:00Z", data: {} }],
        },
      }),
  });
  assert.equal(await service(geometry), null);
});
test("cache admits at most 512 unexpired coordinates and reclaims an expired slot", async () => {
  let clock = now,
    calls = 0;
  const service = createForecastService({
    now: () => clock,
    fetch: async () => {
      calls++;
      return Response.json(payload());
    },
  });
  for (let i = 0; i < 512; i++) {
    assert.ok(
      await service({
        type: "MultiLineString",
        coordinates: [
          [
            [-170 + i * 0.5, 35],
            [0, 0],
          ],
        ],
      }),
    );
    clock += 100;
  }
  const extra = {
    type: "MultiLineString" as const,
    coordinates: [
      [
        [100, 35],
        [0, 0],
      ],
    ] as [number, number][][],
  };
  assert.equal(await service(extra), null);
  assert.equal(calls, 512);
  clock += 4 * 3600000;
  assert.ok(await service(extra));
  assert.equal(calls, 513);
});
test("provider Retry-After pauses all coordinates without leaking a cached forecast", async () => {
  let clock = now,
    calls = 0;
  const service = createForecastService({
    now: () => clock,
    fetch: async () => {
      calls++;
      return new Response(null, {
        status: 429,
        headers: { "retry-after": "120" },
      });
    },
  });
  assert.equal(await service(geometry), null);
  clock += 60000;
  assert.equal(
    await service({
      type: "MultiLineString",
      coordinates: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    }),
    null,
  );
  assert.equal(calls, 1);
  clock += 60000;
  assert.equal(
    await service({
      type: "MultiLineString",
      coordinates: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    }),
    null,
  );
  assert.equal(calls, 2);
});
test("malformed duplicate and out-of-order provider timestamps cannot create duplicate forecast cards", async () => {
  const body = payload();
  body.properties.timeseries.reverse();
  body.properties.timeseries.push(body.properties.timeseries[2]);
  const service = createForecastService({
    now: () => now,
    fetch: async () => Response.json(body),
  });
  assert.deepEqual(
    (await service(geometry))?.periods.map((period) => period.time),
    [
      "2026-11-25T00:00:00.000Z",
      "2026-11-25T06:00:00.000Z",
      "2026-11-25T12:00:00.000Z",
    ],
  );
});
test(
  "a hung provider is aborted at the configured transport deadline",
  { timeout: 10000 },
  async () => {
    const keepAlive = setTimeout(() => {}, 9000);
    let aborted = false;
    try {
      const service = createForecastService({
        now: () => now,
        fetch: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init!.signal!.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(init!.signal!.reason);
              },
              { once: true },
            );
          }),
      });
      assert.equal(await service(geometry), null);
      assert.equal(aborted, true);
    } finally {
      clearTimeout(keepAlive);
    }
  },
);
for (const [symbol, label] of [
  ["clearsky_day", "clear"],
  ["partlycloudy_night", "cloudy"],
  ["snow", "snow"],
  ["fog", "fog"],
  ["heavyrainandthunder", "thunder"],
  ["unrecognized", "unknown"],
])
  test(`provider condition ${symbol} has understandable fallback/category`, async () => {
    const body = payload();
    body.properties.timeseries[0].data.next_6_hours.summary.symbol_code =
      symbol;
    const service = createForecastService({
      now: () => now,
      fetch: async () => Response.json(body),
    });
    assert.equal((await service(geometry))?.periods[0].condition, label);
  });

test("forecast ends on the fifth day after local today across daylight saving time", async () => {
  const clock = Date.parse("2026-03-28T22:30:00Z"); // March 28 in Madrid
  const data = payload();
  data.properties.meta.updated_at = new Date(clock).toISOString();
  const sample = data.properties.timeseries[0];
  data.properties.timeseries = [
    "2026-04-02T18:00:00Z",
    "2026-04-03T00:00:00Z",
  ].map((time) => ({ ...sample, time }));
  const service = createForecastService({
    now: () => clock,
    fetch: async () => Response.json(data),
  });
  const result = await service({
    type: "MultiLineString",
    coordinates: [
      [
        [-3, 40],
        [-4, 41],
      ],
    ],
  });
  assert.ok(result);
  assert.equal(result.timeZone, "Europe/Madrid");
  assert.deepEqual(
    result.periods.map((period) => period.time),
    ["2026-04-02T18:00:00.000Z"],
  );
});

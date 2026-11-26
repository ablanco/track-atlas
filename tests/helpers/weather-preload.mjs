// Process-only HTTP boundary fixture for the managed browser harness. Never
// imported by application code; all MET requests in this harness stay local.
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (url.hostname !== "api.met.no") return original(input, init);
  // A distinct synthetic start point exercises failure without a runtime bypass.
  if (url.searchParams.get("lat") === "41")
    return new Response(null, { status: 503 });
  const now = Date.now();
  const start = Math.ceil(now / 21600000) * 21600000;
  return Response.json(
    {
      properties: {
        meta: {
          updated_at: new Date(now).toISOString(),
          units: {
            air_temperature: "celsius",
            wind_speed: "m/s",
            precipitation_amount: "mm",
          },
        },
        timeseries: Array.from({ length: 28 }, (_, i) => ({
          time: new Date(start + i * 21600000).toISOString(),
          data: {
            instant: {
              details: {
                air_temperature: 12,
                ...(i === 1 ? {} : { wind_speed: 5 }),
              },
            },
            next_6_hours: {
              summary: { symbol_code: "rain_day" },
              details: { precipitation_amount: 2.5 },
            },
          },
        })),
      },
    },
    { headers: { expires: new Date(now + 10800000).toUTCString() } },
  );
};

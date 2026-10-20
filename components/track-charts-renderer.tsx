"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import type { ChartPoint } from "@/tracks/chart-data";

export type TrackChart = {
  key: string;
  name: string;
  unavailable: string;
  sectionUnavailable: string;
  missingValue: string;
  distanceAxis: string;
  distanceUnit: string;
  valueAxis: string;
  unit: string;
  color: string;
  points: ChartPoint[];
  downsampled: boolean;
  downsampledNotice: string;
  previous: string;
  next: string;
  sectionLabel: string;
};

// Repeated gaps cannot be removed safely. Show large envelopes in navigable
// overlapping sections rather than creating an unbounded chart/SVG workload.
const sectionSize = 1600;
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function Chart({ chart, locale }: { chart: TrackChart; locale: string }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const headingId = useId();
  const [section, setSection] = useState(0);
  const sections = Math.max(
    1,
    Math.ceil((chart.points.length - 1) / (sectionSize - 1)),
  );
  const offset = section * (sectionSize - 1);
  const points = chart.points.slice(offset, offset + sectionSize);
  const available = points.some((point) => point.value !== null);
  const recordingAvailable = chart.points.some((point) => point.value !== null);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const fullNumber = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 3,
  });
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <h3 id={headingId} className="font-medium">
        {chart.name}
      </h3>
      {!available ? (
        <p className="text-sm text-muted-foreground">
          {recordingAvailable ? chart.sectionUnavailable : chart.unavailable}
        </p>
      ) : (
        <ChartContainer
          role="group"
          aria-label={`${chart.name}. ${chart.distanceAxis} (${chart.distanceUnit}); ${chart.valueAxis} (${chart.unit}).`}
          config={{ value: { label: chart.valueAxis, color: chart.color } }}
          className="h-72 w-full min-w-0 [&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-ring"
        >
          <LineChart
            data={points}
            accessibilityLayer={ready}
            margin={{ top: 8, right: 16, bottom: 24, left: 8 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="distanceMeters"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(value: number) => number.format(value / 1000)}
              tickLine={false}
              axisLine={false}
              minTickGap={20}
              label={{
                value: `${chart.distanceAxis} (${chart.distanceUnit})`,
                position: "insideBottom",
                offset: -20,
                fill: "var(--muted-foreground)",
              }}
            />
            <YAxis
              type="number"
              width={64}
              tickFormatter={(value: number) => number.format(value)}
              tickLine={false}
              axisLine={false}
              label={{
                value: `${chart.valueAxis} (${chart.unit})`,
                angle: -90,
                position: "insideLeft",
                fill: "var(--muted-foreground)",
              }}
            />
            <ChartTooltip
              filterNull={false}
              content={
                <ChartTooltipContent
                  role="status"
                  aria-live="polite"
                  labelFormatter={(_, payload) =>
                    `${chart.distanceAxis}: ${fullNumber.format(Number(payload[0]?.payload.distanceMeters) / 1000)} ${chart.distanceUnit}`
                  }
                  formatter={(value) => (
                    <span>
                      {chart.valueAxis}:{" "}
                      {value === null
                        ? chart.missingValue
                        : number.format(Number(value))}{" "}
                      {chart.unit}
                    </span>
                  )}
                />
              }
            />
            <Line
              type="linear"
              dataKey="value"
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={({ cx, cy, index }) => {
                if (
                  index === undefined ||
                  points[index]?.value === null ||
                  (points.length > 100 &&
                    points[index - 1]?.value != null &&
                    points[index + 1]?.value != null)
                )
                  return null;
                return (
                  <circle cx={cx} cy={cy} r={2} fill="var(--color-value)" />
                );
              }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      )}
      {sections > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!ready || section === 0}
            onClick={() => setSection((current) => current - 1)}
          >
            {chart.previous}
          </Button>
          <p role="status" className="text-sm tabular-nums">
            {chart.sectionLabel} {number.format(section + 1)} /{" "}
            {number.format(sections)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!ready || section + 1 === sections}
            onClick={() => setSection((current) => current + 1)}
          >
            {chart.next}
          </Button>
        </div>
      )}
      {chart.downsampled && (
        <p className="text-sm text-muted-foreground">
          {chart.downsampledNotice}
        </p>
      )}
    </section>
  );
}

export function TrackChartsRenderer({
  charts,
  locale,
}: {
  charts: TrackChart[];
  locale: string;
}) {
  return (
    <div className="min-w-0 space-y-8">
      {charts.map((chart) => (
        <Chart key={chart.key} chart={chart} locale={locale} />
      ))}
    </div>
  );
}

"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { AdminOverviewDay } from "@/admin/types";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

export function AdminOverviewCharts({ days }: { days: AdminOverviewDay[] }) {
  const t = useTranslations("Admin.charts");
  const locale = useLocale();
  const id = useId();
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const fullDate = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const number = new Intl.NumberFormat(locale);

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      {(["activeUsers", "publicTracks"] as const).map((metric, index) => (
        <section
          key={metric}
          aria-labelledby={`${id}-${metric}`}
          className="min-w-0 space-y-4 rounded-xl border bg-card p-5 shadow-sm"
        >
          <div className="space-y-2">
            <h2 id={`${id}-${metric}`} className="text-lg font-semibold">
              {t(metric)}
            </h2>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
          <ChartContainer
            role="group"
            aria-label={`${t(metric)}. ${t("date")}; ${t("count")}.`}
            config={{
              [metric]: {
                label: t(metric),
                color: `var(--chart-${index + 1})`,
              },
            }}
            className="h-72 w-full min-w-0 [&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-ring"
          >
            <LineChart
              accessibilityLayer
              data={days}
              margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) =>
                  date.format(new Date(`${value}T00:00:00Z`))
                }
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis
                allowDecimals={false}
                domain={[0, "auto"]}
                tickFormatter={(value: number) => number.format(value)}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          {t(metric)}
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {number.format(Number(value))}
                        </span>
                      </div>
                    )}
                    labelFormatter={(_, payload) =>
                      fullDate.format(
                        new Date(`${payload[0]?.payload.date}T00:00:00Z`),
                      )
                    }
                  />
                }
              />
              <Line
                type="linear"
                dataKey={metric}
                stroke={`var(--color-${metric})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        </section>
      ))}
    </div>
  );
}

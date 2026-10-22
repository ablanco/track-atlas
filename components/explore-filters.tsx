"use client";

import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { ActivityIcon } from "@/components/activity-icon";
import { activityTypes } from "@/tracks/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import type { ExploreResult } from "@/tracks/explore-types";

type Props = {
  layout?: "toolbar" | "drawer";
  disabled?: boolean;
  query: string;
  bounds: ExploreResult["bounds"];
  isOwner: boolean;
  onChange(change: (params: URLSearchParams) => void): void;
};

function RangeFilter({
  label,
  inline,
  active,
  disabled,
  children,
}: {
  label: string;
  inline?: boolean;
  active: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  if (inline)
    return (
      <fieldset disabled={disabled} className="min-w-0">
        <legend className="mb-2 text-sm font-medium">{label}</legend>
        {children}
      </fieldset>
    );
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant={active ? "secondary" : "outline"}
            disabled={disabled}
          />
        }
      >
        {label}
        {active && (
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-current"
          />
        )}
        <CaretDownIcon aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="z-50">
          <Popover.Popup className="w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-md">
            <Popover.Title className="mb-3 text-sm font-medium">
              {label}
            </Popover.Title>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ExploreFilters({
  layout = "toolbar",
  query,
  bounds,
  isOwner,
  disabled,
  onChange,
}: Props) {
  const t = useTranslations("Explore");
  const tracks = useTranslations("Tracks");
  const params = new URLSearchParams(query);
  const maxDistance = Math.max(0.1, Math.ceil(bounds.maxDistanceKm * 10) / 10);
  const maxElevation = Math.max(1, Math.ceil(bounds.maxElevationRangeMeters));
  const distance = [
    Number(params.get("minDistance") ?? 0),
    Number(params.get("maxDistance") ?? maxDistance),
  ];
  const elevation = [Number(params.get("maxElevationRange") ?? maxElevation)];
  function change(key: string, value: string | null) {
    onChange((next) => {
      if (value === null) next.delete(key);
      else next.set(key, value);
      next.delete("page");
    });
  }
  function toggle(key: string, value: string) {
    onChange((next) => {
      const selected = next.getAll(key);
      next.delete(key);
      for (const item of selected.includes(value)
        ? selected.filter((x) => x !== value)
        : [...selected, value])
        next.append(key, item);
      next.delete("page");
    });
  }
  function commitDistance(values: number[]) {
    onChange((next) => {
      const [min, max] = values;
      if (min > 0) next.set("minDistance", String(min));
      else next.delete("minDistance");
      if (max < maxDistance) next.set("maxDistance", String(max));
      else next.delete("maxDistance");
      next.delete("page");
    });
  }
  // Reset only this field when its committed URL value changes. Other controls
  // and newly authorized bounds must leave a focused, uncommitted draft alone.
  const numeric = (key: string, label: string, step: number) => (
    <label className="grid gap-1 text-sm">
      {label}
      <Input
        key={params.get(key) ?? ""}
        type="number"
        min={0}
        step={step}
        aria-label={label}
        defaultValue={params.get(key) ?? ""}
        placeholder={t("unlimited")}
        onBlur={(event) => {
          const input = event.currentTarget;
          if (input.validity.valid)
            change(key, input.value === "" ? null : input.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
  return (
    <>
      <Select
        multiple
        value={params.getAll("activity")}
        disabled={disabled}
        onValueChange={(values) =>
          onChange((next) => {
            next.delete("activity");
            for (const value of values) next.append("activity", value);
            next.delete("page");
          })
        }
      >
        <SelectTrigger aria-label={tracks("activity")}>
          {tracks("activity")}
          {params.getAll("activity").length > 0 && (
            <span className="rounded bg-muted px-1 text-xs">
              {params.getAll("activity").length}
            </span>
          )}
        </SelectTrigger>
        <SelectContent
          align="start"
          alignItemWithTrigger={false}
          className="w-56"
        >
          {activityTypes.map((activity) => (
            <SelectItem key={activity} value={activity}>
              <ActivityIcon activity={activity} />
              {tracks(`activities.${activity}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <fieldset
        disabled={disabled}
        className="relative flex shrink-0 items-center gap-2"
      >
        <legend className="sr-only">{tracks("difficulty")}</legend>
        <span aria-hidden="true" className="text-sm">
          {tracks("difficulty")}
        </span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <Button
              type="button"
              size="sm"
              variant={
                params.getAll("difficulty").includes(String(value))
                  ? "secondary"
                  : "outline"
              }
              key={value}
              aria-label={t("difficultyValue", { value })}
              aria-pressed={params.getAll("difficulty").includes(String(value))}
              onClick={() => toggle("difficulty", String(value))}
            >
              {value}
            </Button>
          ))}
        </div>
      </fieldset>
      {isOwner && (
        <fieldset disabled={disabled} className="relative shrink-0">
          <legend className="sr-only">{tracks("visibility")}</legend>
          <div className="flex gap-2">
            {(["all", "public", "private"] as const).map((value) => (
              <Button
                type="button"
                key={value}
                size="sm"
                variant={
                  (params.get("visibility") ?? "all") === value
                    ? "secondary"
                    : "outline"
                }
                aria-pressed={(params.get("visibility") ?? "all") === value}
                onClick={() =>
                  change("visibility", value === "all" ? null : value)
                }
              >
                {t(value)}
              </Button>
            ))}
          </div>
        </fieldset>
      )}
      <RangeFilter
        inline={layout === "drawer"}
        label={t("distance")}
        active={params.has("minDistance") || params.has("maxDistance")}
        disabled={disabled}
      >
        <Slider
          min={0}
          max={maxDistance}
          step={0.1}
          key={JSON.stringify([distance, maxDistance])}
          defaultValue={distance.map((v) => Math.min(maxDistance, v))}
          labels={[t("minDistance"), t("maxDistance")]}
          onValueCommitted={commitDistance}
        />
        <div className="grid grid-cols-2 gap-3">
          {numeric("minDistance", t("minDistance"), 0.1)}
          {numeric("maxDistance", t("maxDistance"), 0.1)}
        </div>
      </RangeFilter>
      <RangeFilter
        inline={layout === "drawer"}
        label={t("elevation")}
        active={params.has("maxElevationRange")}
        disabled={disabled}
      >
        <Slider
          min={0}
          max={maxElevation}
          step={1}
          key={JSON.stringify([elevation, maxElevation])}
          defaultValue={elevation.map((v) => Math.min(maxElevation, v))}
          labels={[t("maxElevation")]}
          onValueCommitted={(values) =>
            change(
              "maxElevationRange",
              values[0] >= maxElevation ? null : String(values[0]),
            )
          }
        />
        {numeric("maxElevationRange", t("maxElevation"), 1)}
        <p className="mt-1 text-xs text-muted-foreground">
          {t("elevationHint")}
        </p>
      </RangeFilter>
      <Button
        type="button"
        variant="outline"
        className="shrink-0"
        disabled={disabled}
        onClick={() =>
          onChange((next) => {
            for (const key of [...next.keys()]) next.delete(key);
          })
        }
      >
        {t("clear")}
      </Button>
    </>
  );
}

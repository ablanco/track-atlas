"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { activityTypes } from "@/tracks/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import type { ExploreResult } from "@/tracks/explore-types";

type Props = {
  query: string;
  bounds: ExploreResult["bounds"];
  isOwner: boolean;
  onChange(params: URLSearchParams): void;
};

export function ExploreFilters({ query, bounds, isOwner, onChange }: Props) {
  const t = useTranslations("Explore");
  const tracks = useTranslations("Tracks");
  const params = new URLSearchParams(query);
  const maxDistance = Math.max(0.1, Math.ceil(bounds.maxDistanceKm * 10) / 10);
  const maxElevation = Math.max(1, Math.ceil(bounds.maxElevationRangeMeters));
  const [distance, setDistance] = useState([
    Number(params.get("minDistance") ?? 0),
    Number(params.get("maxDistance") ?? maxDistance),
  ]);
  const [elevation, setElevation] = useState([
    Number(params.get("maxElevationRange") ?? maxElevation),
  ]);
  function change(key: string, value: string | null) {
    const next = new URLSearchParams(query);
    if (value === null) next.delete(key);
    else next.set(key, value);
    next.delete("page");
    onChange(next);
  }
  function toggle(key: string, value: string) {
    const next = new URLSearchParams(query);
    const selected = next.getAll(key);
    next.delete(key);
    for (const item of selected.includes(value)
      ? selected.filter((x) => x !== value)
      : [...selected, value])
      next.append(key, item);
    next.delete("page");
    onChange(next);
  }
  function commitDistance(values: number[]) {
    const next = new URLSearchParams(query);
    const [min, max] = values;
    if (min > 0) next.set("minDistance", String(min));
    else next.delete("minDistance");
    if (max < maxDistance) next.set("maxDistance", String(max));
    else next.delete("maxDistance");
    next.delete("page");
    onChange(next);
  }
  const numeric = (key: string, label: string, step: number) => (
    <label className="grid gap-1 text-sm">
      {label}
      <Input
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
    <div className="grid gap-5 py-4 lg:grid-cols-3">
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium">
          {tracks("activity")}
        </legend>
        <div className="flex max-h-44 flex-wrap gap-1 overflow-y-auto">
          {activityTypes.map((activity) => (
            <Button
              type="button"
              size="sm"
              variant={
                params.getAll("activity").includes(activity)
                  ? "secondary"
                  : "outline"
              }
              key={activity}
              aria-pressed={params.getAll("activity").includes(activity)}
              onClick={() => toggle("activity", activity)}
            >
              {tracks(`activities.${activity}`)}
            </Button>
          ))}
        </div>
      </fieldset>
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            {tracks("difficulty")}
          </legend>
          <div className="flex flex-wrap gap-2">
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
                aria-pressed={params
                  .getAll("difficulty")
                  .includes(String(value))}
                onClick={() => toggle("difficulty", String(value))}
              >
                {value}
              </Button>
            ))}
          </div>
        </fieldset>
        {isOwner && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">
              {tracks("visibility")}
            </legend>
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
      </div>
      <div className="space-y-4">
        <fieldset>
          <legend className="text-sm font-medium">{t("distance")}</legend>
          <Slider
            min={0}
            max={maxDistance}
            step={0.1}
            value={distance.map((v) => Math.min(maxDistance, v))}
            labels={[t("minDistance"), t("maxDistance")]}
            onValueChange={setDistance}
            onValueCommitted={commitDistance}
          />
          <div className="grid grid-cols-2 gap-3">
            {numeric("minDistance", t("minDistance"), 0.1)}
            {numeric("maxDistance", t("maxDistance"), 0.1)}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">{t("elevation")}</legend>
          <Slider
            min={0}
            max={maxElevation}
            step={1}
            value={elevation.map((v) => Math.min(maxElevation, v))}
            labels={[t("maxElevation")]}
            onValueChange={setElevation}
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
        </fieldset>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => onChange(new URLSearchParams())}
      >
        {t("clear")}
      </Button>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ExploreDrawing, ExploreViewport } from "@/tracks/explore-types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** Criteria stay outside the map failure boundary and remain usable in List view. */
export function ExploreSpatialControls({
  viewport,
  drawing,
  placementMode = null,
  currentViewport,
  disabled,
  onChange,
  onDraw,
}: {
  viewport: ExploreViewport | null;
  drawing: ExploreDrawing | null;
  placementMode?: ExploreDrawing["mode"] | null;
  currentViewport: ExploreViewport | null;
  disabled: boolean;
  onChange: (spatial: {
    viewport?: ExploreViewport | null;
    drawing?: ExploreDrawing | null;
  }) => void;
  onDraw: (mode: ExploreDrawing["mode"]) => void;
}) {
  const t = useTranslations("ExploreSpatial");
  const committed = drawing?.corridorKm ?? null;
  const [width, setWidth] = useState({
    committed,
    text: String(committed ?? 1),
    invalid: false,
  });
  if (width.committed !== committed)
    setWidth({ committed, text: String(committed ?? 1), invalid: false });
  const { text, invalid } = width;
  const commit = () => {
    const number = Number(text);
    const valid =
      text.trim() !== "" &&
      Number.isFinite(number) &&
      number >= 0.1 &&
      number <= 50;
    setWidth((current) => ({ ...current, invalid: !valid }));
    if (valid && drawing && number !== committed)
      onChange({ drawing: { ...drawing, corridorKm: number } });
  };
  return (
    <div className="shrink-0 space-y-1 border-b px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={!!viewport}
            disabled={disabled || (!viewport && !currentViewport)}
            onChange={(e) =>
              onChange({ viewport: e.target.checked ? currentViewport : null })
            }
          />
          {t("viewport")}
        </label>
        {(["arrow", "line"] as const).map((mode) => (
          <Button
            className="min-h-11"
            key={mode}
            variant={
              (placementMode ?? drawing?.mode) === mode
                ? "secondary"
                : "outline"
            }
            aria-pressed={(placementMode ?? drawing?.mode) === mode}
            disabled={disabled}
            onClick={() =>
              drawing && !placementMode
                ? onChange({ drawing: { ...drawing, mode } })
                : onDraw(mode)
            }
          >
            {t(mode)}
          </Button>
        ))}
        {drawing && (
          <>
            <label className="flex items-center gap-2">
              {t("corridor")}
              <Input
                className="min-h-11 w-24"
                disabled={disabled}
                type="number"
                min="0.1"
                max="50"
                step="0.1"
                value={text}
                aria-invalid={invalid}
                onChange={(e) =>
                  setWidth({ committed, text: e.target.value, invalid: false })
                }
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                }}
              />
            </label>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={disabled}
              onClick={() => onDraw(drawing.mode)}
            >
              {t("replace")}
            </Button>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={disabled}
              onClick={() => onChange({ drawing: null })}
            >
              {t("clear")}
            </Button>
          </>
        )}
      </div>
      {invalid && (
        <p role="alert" className="text-destructive">
          {t("invalidCorridor")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t("approximation")}</p>
    </div>
  );
}

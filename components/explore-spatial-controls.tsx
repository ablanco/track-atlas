"use client";

import { useId, useState } from "react";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { Tooltip } from "@base-ui/react/tooltip";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { LineVerticalIcon } from "@phosphor-icons/react/dist/csr/LineVertical";
import { useTranslations } from "next-intl";
import type { ExploreDrawing, ExploreViewport } from "@/tracks/explore-types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** Compact controls shared by the map panel and its failure fallback. */
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
  const corridorErrorId = useId();
  const [helpOpen, setHelpOpen] = useState(false);
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
    <div className="max-w-72 space-y-1 text-sm">
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
            className="size-11"
            size="icon"
            aria-label={t(mode)}
            title={t(mode)}
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
            {mode === "arrow" ? (
              <ArrowDownIcon aria-hidden="true" className="size-5" />
            ) : (
              <LineVerticalIcon aria-hidden="true" className="size-5" />
            )}
          </Button>
        ))}
        <Tooltip.Root open={helpOpen} onOpenChange={setHelpOpen}>
          <Tooltip.Trigger
            delay={150}
            closeOnClick={false}
            onClick={() => setHelpOpen(true)}
            render={
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-11 text-muted-foreground"
                aria-label={t("help")}
              />
            }
          >
            <QuestionIcon aria-hidden="true" className="size-5" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner side="right" sideOffset={8} className="z-50">
              <Tooltip.Popup className="max-w-[min(20rem,calc(100vw-2rem))] rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
                {t("approximation")}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
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
                aria-describedby={invalid ? corridorErrorId : undefined}
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
        <p id={corridorErrorId} role="alert" className="text-destructive">
          {t("invalidCorridor")}
        </p>
      )}
    </div>
  );
}

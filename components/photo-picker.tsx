"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef } from "react";
import type { PhotoDraftController } from "./use-photo-drafts";
export type { PhotoDraft } from "@/tracks/photo-drafts";
import { useTranslations } from "next-intl";
import { ArrowFatLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowFatLeft";
import { ArrowFatRightIcon } from "@phosphor-icons/react/dist/csr/ArrowFatRight";
import { ArrowFatUpIcon } from "@phosphor-icons/react/dist/csr/ArrowFatUp";
import { ArrowFatDownIcon } from "@phosphor-icons/react/dist/csr/ArrowFatDown";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export function PhotoPicker({
  photos,
  disabled = false,
}: {
  photos: PhotoDraftController;
  disabled?: boolean;
}) {
  const t = useTranslations("Photos");
  const drag = useRef<string | null>(null);
  const { draft, rows: value } = photos;
  useEffect(
    () => () => {
      drag.current = null;
    },
    [],
  );
  function select(files: FileList | null) {
    if (!disabled && files) draft.add(files);
  }
  function move(key: string, target: number) {
    if (!disabled) draft.move(key, target);
  }
  return (
    <section
      aria-label={t("title")}
      className="space-y-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (disabled) return;
        if (drag.current) {
          drag.current = null;
          return;
        }
        select(e.dataTransfer.files);
      }}
    >
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <label className="block rounded-md border border-dashed p-4">
        {t("picker")}
        <Input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={disabled || value.length >= 20}
          onChange={(e) => {
            select(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <p className="text-sm text-muted-foreground">{t("limits")}</p>
      <ol className="grid gap-4 sm:grid-cols-2">
        {value.map((photo, index) => {
          return (
            <li
              key={photo.key}
              draggable={!disabled}
              onDragEnd={() => {
                drag.current = null;
              }}
              onDragStart={() => {
                if (!disabled) drag.current = photo.key;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                if (disabled) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                if (drag.current) {
                  e.preventDefault();
                  e.stopPropagation();
                  move(drag.current, index);
                  drag.current = null;
                }
              }}
              className="flex flex-col gap-2 rounded-md border p-3"
            >
              <img
                src={photo.preview}
                alt=""
                className="h-32 w-full object-contain"
              />
              <label className="grid gap-1">
                {t("caption")}
                <Input
                  disabled={disabled}
                  maxLength={500}
                  value={photo.caption}
                  onChange={(e) =>
                    !disabled && draft.caption(photo.key, e.target.value)
                  }
                />
              </label>
              {photo.status !== "ready" && (
                <p role="status">
                  {t(photo.expired ? "expired" : photo.status)} {photo.progress}
                  %
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {photo.status === "failed" && (
                  <Button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      draft.retry(photo.key);
                    }}
                  >
                    {t("retry")}
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={disabled || index === 0}
                  onClick={() => move(photo.key, index - 1)}
                >
                  <ArrowFatLeftIcon
                    aria-hidden="true"
                    className="hidden sm:block"
                    data-icon="inline-start"
                  />
                  <ArrowFatUpIcon
                    aria-hidden="true"
                    className="sm:hidden"
                    data-icon="inline-start"
                  />
                  {t("up")}
                </Button>
                <Button
                  type="button"
                  disabled={disabled || index === value.length - 1}
                  onClick={() => move(photo.key, index + 1)}
                >
                  {t("down")}
                  <ArrowFatRightIcon
                    aria-hidden="true"
                    className="hidden sm:block"
                    data-icon="inline-end"
                  />
                  <ArrowFatDownIcon
                    aria-hidden="true"
                    className="sm:hidden"
                    data-icon="inline-end"
                  />
                </Button>
                <Button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    draft.remove(photo.key);
                  }}
                >
                  <TrashIcon aria-hidden="true" data-icon="inline-start" />
                  {t("remove")}
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

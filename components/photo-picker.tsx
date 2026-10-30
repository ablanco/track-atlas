"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export type PhotoDraft = { id: string; caption: string };
type Upload = {
  key: string;
  file: File;
  preview: string;
  status: "queued" | "uploading" | "failed" | "ready";
  progress: number;
  id?: string;
  caption: string;
};
export function PhotoPicker({
  value,
  onChange,
  onBusy,
  trackId,
}: {
  value: PhotoDraft[];
  onChange: (v: PhotoDraft[]) => void;
  onBusy: (v: boolean) => void;
  trackId?: string;
}) {
  const t = useTranslations("Photos");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const active = useRef(new Set<string>()),
    urls = useRef<string[]>([]),
    drag = useRef<string | null>(null);
  const requests = useRef(new Map<string, XMLHttpRequest>());
  const completed = useRef(new Map<string, string>());
  const latest = useRef({ value, onChange, onBusy });
  useEffect(() => {
    latest.current = { value, onChange, onBusy };
  }, [value, onChange, onBusy]);
  useEffect(
    () => () => {
      urls.current.forEach(URL.revokeObjectURL);
      for (const xhr of requests.current.values()) {
        xhr.onload = null;
        xhr.onerror = null;
        xhr.ontimeout = null;
        xhr.abort();
      }
      requests.current.clear();
    },
    [],
  );
  useEffect(() => {
    onBusy(uploads.some((u) => u.status !== "ready"));
    for (const upload of uploads
      .filter((u) => u.status === "queued" && !active.current.has(u.key))
      .slice(0, 2 - active.current.size)) {
      active.current.add(upload.key);
      setUploads((old) =>
        old.map((u) =>
          u.key === upload.key ? { ...u, status: "uploading" } : u,
        ),
      );
      const xhr = new XMLHttpRequest();
      requests.current.set(upload.key, xhr);
      xhr.open("POST", "/api/files?purpose=photo");
      xhr.setRequestHeader(
        "Content-Type",
        upload.file.type || "application/octet-stream",
      );
      xhr.upload.onprogress = (e) =>
        setUploads((old) =>
          old.map((u) =>
            u.key === upload.key
              ? {
                  ...u,
                  progress: e.lengthComputable
                    ? Math.round((e.loaded / e.total) * 90)
                    : 0,
                }
              : u,
          ),
        );
      const fail = () => {
        requests.current.delete(upload.key);
        active.current.delete(upload.key);
        setUploads((old) =>
          old.map((u) =>
            u.key === upload.key ? { ...u, status: "failed" } : u,
          ),
        );
      };
      xhr.timeout = 120000;
      xhr.ontimeout = fail;
      xhr.onerror = fail;
      xhr.onload = () => {
        if (xhr.status !== 201) {
          fail();
          return;
        }
        try {
          const result = JSON.parse(xhr.responseText);
          requests.current.delete(upload.key);
          active.current.delete(upload.key);
          setUploads((old) =>
            old.map((u) =>
              u.key === upload.key
                ? { ...u, status: "ready", progress: 100, id: result.id }
                : u,
            ),
          );
          completed.current.set(upload.key, result.id);
          const current = latest.current;
          current.onChange(
            current.value.map((p) => ({
              ...p,
              id: completed.current.get(p.id) ?? p.id,
            })),
          );
        } catch {
          fail();
        }
      };
      xhr.send(upload.file);
    }
  }, [uploads, onBusy]);
  function select(files: FileList | null) {
    if (!files) return;
    const added = [...files].slice(0, 20 - value.length).map((file) => {
      const preview = URL.createObjectURL(file);
      urls.current.push(preview);
      return {
        key: crypto.randomUUID(),
        file,
        preview,
        status: "queued" as const,
        progress: 0,
        caption: "",
      };
    });
    setUploads((old) => [...old, ...added]);
    onChange([...value, ...added.map((u) => ({ id: u.key, caption: "" }))]);
  }
  function move(id: string, target: number) {
    const index = value.findIndex((p) => p.id === id);
    if (index < 0 || target < 0 || target >= value.length) return;
    const next = [...value];
    const [photo] = next.splice(index, 1);
    next.splice(target, 0, photo);
    onChange(next);
  }
  return (
    <section
      aria-label={t("title")}
      className="space-y-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (drag.current) {
          drag.current = null;
          return;
        }
        select(e.dataTransfer.files);
      }}
    >
      <label className="block rounded-md border border-dashed p-4">
        {t("picker")}
        <Input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={value.length >= 20}
          onChange={(e) => {
            select(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <p className="text-sm text-muted-foreground">{t("limits")}</p>
      <ol className="grid gap-4 sm:grid-cols-2">
        {value.map((photo, index) => {
          const upload = uploads.find(
            (u) => u.key === photo.id || u.id === photo.id,
          );
          return (
            <li
              key={upload?.key ?? photo.id}
              draggable
              onDragStart={() => {
                drag.current = photo.id;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                if (drag.current) {
                  e.preventDefault();
                  e.stopPropagation();
                  move(drag.current, index);
                  drag.current = null;
                }
              }}
              className="space-y-2 rounded-md border p-3"
            >
              <img
                src={
                  upload?.preview ??
                  `/api/tracks/${trackId}/photos/${photo.id}?size=thumbnail`
                }
                alt=""
                className="h-32 w-full object-contain"
              />
              <label>
                {t("caption")}
                <Input
                  maxLength={500}
                  value={photo.caption}
                  onChange={(e) =>
                    onChange(
                      value.map((p) =>
                        p.id === photo.id
                          ? { ...p, caption: e.target.value }
                          : p,
                      ),
                    )
                  }
                />
              </label>
              {upload && upload.status !== "ready" && (
                <p role="status">
                  {t(upload.status)} {upload.progress}%
                </p>
              )}
              {upload?.status === "failed" && (
                <Button
                  type="button"
                  onClick={() =>
                    setUploads((old) =>
                      old.map((u) =>
                        u === upload
                          ? { ...u, status: "queued", progress: 0 }
                          : u,
                      ),
                    )
                  }
                >
                  {t("retry")}
                </Button>
              )}
              <Button
                type="button"
                disabled={index === 0}
                onClick={() => move(photo.id, index - 1)}
              >
                {t("up")}
              </Button>
              <Button
                type="button"
                disabled={index === value.length - 1}
                onClick={() => move(photo.id, index + 1)}
              >
                {t("down")}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onChange(value.filter((p) => p.id !== photo.id));
                  setUploads((old) => old.filter((u) => u !== upload));
                }}
              >
                {t("remove")}
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

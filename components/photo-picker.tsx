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
  expiresAt?: number;
  expired?: boolean;
};
export function PhotoPicker({
  value,
  onChange,
  onBusy,
  trackId,
  disabled = false,
}: {
  value: PhotoDraft[];
  onChange: (v: PhotoDraft[]) => void;
  onBusy: (v: boolean) => void;
  trackId?: string;
  disabled?: boolean;
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
  useEffect(() => {
    const liveRequests = requests.current;
    const liveSlots = active.current;
    // Activity preserves File/state but disposes effects and browser resources.
    setUploads((old) =>
      old.map((u) => {
        const preview = URL.createObjectURL(u.file);
        urls.current.push(preview);
        return {
          ...u,
          preview,
          status: u.status === "uploading" ? "failed" : u.status,
        };
      }),
    );
    return () => {
      urls.current.forEach(URL.revokeObjectURL);
      urls.current = [];
      drag.current = null;
      for (const xhr of liveRequests.values()) {
        xhr.onload = null;
        xhr.onerror = null;
        xhr.ontimeout = null;
        xhr.upload.onprogress = null;
        xhr.abort();
      }
      liveRequests.clear();
      liveSlots.clear();
    };
  }, []);
  useEffect(() => {
    const expire = () =>
      setUploads((old) => {
        if (
          !old.some((u) => u.status === "ready" && u.expiresAt! <= Date.now())
        )
          return old;
        return old.map((u) =>
          u.status === "ready" && u.expiresAt! <= Date.now()
            ? { ...u, status: "failed", progress: 0, expired: true }
            : u,
        );
      });
    expire();
    const timer = setInterval(expire, 1000);
    return () => clearInterval(timer);
  }, []);
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
      // The server lease starts at reservation, before upload/decoding finishes.
      const expiresAt = Date.now() + 14 * 60 * 1000;
      const xhr = new XMLHttpRequest();
      requests.current.set(upload.key, xhr);
      xhr.open("POST", "/api/files?purpose=photo");
      xhr.setRequestHeader(
        "Content-Type",
        upload.file.type || "application/octet-stream",
      );
      const currentRequest = () => requests.current.get(upload.key) === xhr;
      xhr.upload.onprogress = (e) =>
        currentRequest() &&
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
        if (!currentRequest()) return;
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
        if (!currentRequest()) return;
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
                ? {
                    ...u,
                    status: "ready",
                    progress: 100,
                    id: result.id,
                    expiresAt,
                  }
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
    if (disabled || !files) return;
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
    if (disabled) return;
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
        if (disabled) return;
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
          const upload = uploads.find(
            (u) => u.key === photo.id || u.id === photo.id,
          );
          return (
            <li
              key={upload?.key ?? photo.id}
              draggable={!disabled}
              onDragEnd={() => {
                drag.current = null;
              }}
              onDragStart={() => {
                if (!disabled) drag.current = photo.id;
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
                  disabled={disabled}
                  maxLength={500}
                  value={photo.caption}
                  onChange={(e) =>
                    !disabled &&
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
                  {t(upload.expired ? "expired" : upload.status)}{" "}
                  {upload.progress}%
                </p>
              )}
              {upload?.status === "failed" && (
                <Button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    completed.current.delete(upload.key);
                    onChange(
                      value.map((p) =>
                        p.id === upload.id ? { ...p, id: upload.key } : p,
                      ),
                    );
                    setUploads((old) =>
                      old.map((u) =>
                        u === upload
                          ? {
                              ...u,
                              status: "queued",
                              progress: 0,
                              expired: false,
                            }
                          : u,
                      ),
                    );
                  }}
                >
                  {t("retry")}
                </Button>
              )}
              <Button
                type="button"
                disabled={disabled || index === 0}
                onClick={() => move(photo.id, index - 1)}
              >
                {t("up")}
              </Button>
              <Button
                type="button"
                disabled={disabled || index === value.length - 1}
                onClick={() => move(photo.id, index + 1)}
              >
                {t("down")}
              </Button>
              <Button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  if (upload) {
                    const xhr = requests.current.get(upload.key);
                    requests.current.delete(upload.key);
                    active.current.delete(upload.key);
                    xhr?.abort();
                    URL.revokeObjectURL(upload.preview);
                  }
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

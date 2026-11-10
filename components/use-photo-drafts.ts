"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  PhotoDrafts,
  type PhotoDraft,
  type PhotoPlatform,
} from "@/tracks/photo-drafts";

const browser: PhotoPlatform = {
  now: () => Date.now(),
  key: () => crypto.randomUUID(),
  preview: (file) => URL.createObjectURL(file),
  revoke: (url) => URL.revokeObjectURL(url),
  upload(file, progress, finish) {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files?purpose=photo");
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    xhr.timeout = 120000;
    xhr.upload.onprogress = (e) =>
      progress(e.lengthComputable ? Math.round((e.loaded / e.total) * 90) : 0);
    xhr.onload = () => finish(xhr.status, xhr.responseText);
    xhr.onerror = xhr.ontimeout = () => finish(0, "");
    xhr.send(file);
    return () => {
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.upload.onprogress = null;
      xhr.abort();
    };
  },
};

export function usePhotoDrafts(initial: PhotoDraft[] = [], trackId?: string) {
  const [draft] = useState(() => new PhotoDrafts(initial, browser, trackId));
  const state = useSyncExternalStore(
    draft.subscribe,
    draft.getSnapshot,
    draft.getSnapshot,
  );
  useEffect(() => {
    draft.resume();
    const timer = setInterval(draft.expire, 1000);
    return () => {
      clearInterval(timer);
      draft.suspend();
    };
  }, [draft]);
  return { draft, ...state };
}
export type PhotoDraftController = ReturnType<typeof usePhotoDrafts>;

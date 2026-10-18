"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import type { SettingsLabels } from "./settings-labels";

type AvatarError = keyof SettingsLabels["avatar"]["errors"];
type UploadState = { kind: "idle" } | { kind: "uploading" } | { kind: "success" } | { kind: "error"; code: AvatarError };
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const maxBytes = 5 * 1024 * 1024;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const fileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function responseError(value: unknown): AvatarError {
  if (typeof value === "object" && value !== null && "error" in value) {
    switch (value.error) {
      case "invalidFile": case "tooLarge": case "quotaExceeded": case "unauthorized": return value.error;
    }
  }
  return "unavailable";
}

export function AvatarForm({ avatarFileId, labels }: { avatarFileId: string | null; labels: SettingsLabels["avatar"] }) {
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [selection, setSelection] = useState<File | null>(null);
  const [failedImageId, setFailedImageId] = useState<string | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const pending = state.kind === "uploading";
  useEffect(() => { if (state.kind === "error") alert.current?.focus(); }, [state]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !selection || pending) return;
    if (!imageTypes.has(selection.type)) { setState({ kind: "error", code: "invalidFile" }); return; }
    if (selection.size > maxBytes) { setState({ kind: "error", code: "tooLarge" }); return; }
    setState({ kind: "uploading" });
    try {
      const response = await fetch("/api/files?purpose=avatar", { method: "POST", headers: { "content-type": selection.type }, body: selection });
      const value: unknown = await response.json();
      if (!response.ok) { setState({ kind: "error", code: responseError(value) }); return; }
      if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "string" || !fileIdPattern.test(value.id)) {
        setState({ kind: "error", code: "unavailable" }); return;
      }
      setState({ kind: "success" });
      setSelection(null);
      if (input.current) input.current.value = "";
      router.refresh();
    } catch { setState({ kind: "error", code: "unavailable" }); }
  }

  return <section className="border-b border-default py-7">
    <h2 id={`${id}-title`} className="text-xl font-semibold">{labels.title}</h2>
    <div className="mt-5 flex min-h-32 items-center">
      {avatarFileId && failedImageId !== avatarFileId
        ? <Image key={avatarFileId} src={`/api/avatars/${avatarFileId}`} alt={labels.imageAlt} width={128} height={128} unoptimized loading="eager" className="h-32 w-32 max-w-full rounded-md border border-default bg-surface-muted object-contain" onError={() => setFailedImageId(avatarFileId)} />
        : <p role="status" className="text-sm text-muted">{avatarFileId ? labels.imageUnavailable : labels.empty}</p>}
    </div>
    <form onSubmit={upload} aria-labelledby={`${id}-title`} aria-busy={pending} className="mt-5 space-y-4">
      <div>
        <label htmlFor={`${id}-file`} className="block text-sm font-semibold">{labels.file} <span className="font-normal text-muted">({labels.optional})</span></label>
        <input ref={input} id={`${id}-file`} name="avatar" type="file" accept="image/jpeg,image/png,image/webp" disabled={!ready || pending}
          aria-invalid={state.kind === "error" && (state.code === "invalidFile" || state.code === "tooLarge") || undefined}
          aria-describedby={`${id}-hint ${id}-metadata${state.kind === "error" ? ` ${id}-error` : ""}`}
          onChange={event => { setSelection(event.currentTarget.files?.[0] ?? null); setState({ kind: "idle" }); }}
          className="mt-2 block min-h-11 w-full min-w-0 max-w-full rounded-md border border-default bg-surface px-3 py-2 text-sm text-primary" />
        <p id={`${id}-hint`} className="mt-2 text-sm text-muted">{labels.hint}</p>
        <p id={`${id}-metadata`} className="mt-2 text-sm text-muted">{labels.metadata}</p>
      </div>
      {state.kind === "error" && <p ref={alert} id={`${id}-error`} role="alert" tabIndex={-1} className="rounded-md border border-danger bg-surface-muted p-3 text-sm text-danger">{labels.errors[state.code]}</p>}
      <button type="submit" disabled={!ready || !selection || pending} className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-70">{pending ? labels.pending : labels.submit}</button>
      <p role="status" className="text-sm text-muted">{pending ? labels.pending : state.kind === "success" ? labels.success : ""}</p>
    </form>
  </section>;
}

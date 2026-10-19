"use client";

import Image from "next/image";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "@/i18n/navigation";
import type { SettingsLabels } from "./settings-labels";

type AvatarError = keyof SettingsLabels["avatar"]["errors"];
type AvatarState =
  | { kind: "idle" | "uploading" | "uploaded" | "removed" }
  | { kind: "removing"; fileId: string }
  | { kind: "uploadError"; code: AvatarError }
  | { kind: "removeError"; fileId: string };
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const maxBytes = 5 * 1024 * 1024;
const fileIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function responseError(value: unknown): AvatarError {
  if (typeof value === "object" && value !== null && "error" in value) {
    switch (value.error) {
      case "invalidFile":
      case "tooLarge":
      case "quotaExceeded":
      case "unauthorized":
        return value.error;
    }
  }
  return "unavailable";
}

export function AvatarForm({
  avatarFileId,
  avatarHasVersions,
  labels,
}: {
  avatarFileId: string | null;
  avatarHasVersions: boolean;
  labels: SettingsLabels["avatar"];
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [state, setState] = useState<AvatarState>({ kind: "idle" });
  const [selection, setSelection] = useState<File | null>(null);
  const [retryFileId, setRetryFileId] = useState<string | null>(null);
  const [failedImageId, setFailedImageId] = useState<string | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const pending =
    state.kind === "uploading" || state.kind === "removing" || refreshing;
  const removalTarget = avatarFileId ?? retryFileId;
  const hasError = state.kind === "uploadError" || state.kind === "removeError";
  useEffect(() => {
    if (hasError) alert.current?.focus();
  }, [state, hasError]);
  useEffect(() => {
    if (state.kind === "removed" && !removalTarget && !pending)
      input.current?.focus();
  }, [state.kind, removalTarget, pending]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !selection || pending) return;
    if (selection.size > maxBytes) {
      setState({ kind: "uploadError", code: "tooLarge" });
      return;
    }
    setState({ kind: "uploading" });
    try {
      const response = await fetch("/api/files?purpose=avatar", {
        method: "POST",
        headers: {
          "content-type": selection.type || "application/octet-stream",
        },
        body: selection,
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        setState({ kind: "uploadError", code: responseError(value) });
        return;
      }
      if (
        typeof value !== "object" ||
        value === null ||
        !("id" in value) ||
        typeof value.id !== "string" ||
        !fileIdPattern.test(value.id)
      ) {
        setState({ kind: "uploadError", code: "unavailable" });
        return;
      }
      setRetryFileId(null);
      setState({ kind: "uploaded" });
      setSelection(null);
      if (input.current) input.current.value = "";
      startRefresh(() => router.refresh());
    } catch {
      setState({ kind: "uploadError", code: "unavailable" });
    }
  }

  async function remove() {
    if (!ready || !removalTarget || pending) return;
    const fileId = removalTarget;
    setRetryFileId(fileId);
    setState({ kind: "removing", fileId });
    try {
      const response = await fetch(`/api/files/${fileId}`, {
        method: "DELETE",
      });
      if (response.status !== 204) {
        setState({ kind: "removeError", fileId });
        startRefresh(() => router.refresh());
        return;
      }
      setRetryFileId(null);
      setState({ kind: "removed" });
      setSelection(null);
      if (input.current) input.current.value = "";
      startRefresh(() => router.refresh());
    } catch {
      setState({ kind: "removeError", fileId });
      startRefresh(() => router.refresh());
    }
  }

  return (
    <section className="border-b border-default py-7">
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        {labels.title}
      </h2>
      <div className="mt-4 flex items-center">
        {avatarFileId && avatarHasVersions && failedImageId !== avatarFileId ? (
          <Image
            key={avatarFileId}
            src={`/api/avatars/${avatarFileId}`}
            alt={labels.imageAlt}
            width={128}
            height={128}
            unoptimized
            loading="eager"
            className="h-32 w-32 max-w-full rounded-md border border-default bg-surface-muted object-contain"
            onError={() => setFailedImageId(avatarFileId)}
          />
        ) : (
          <p role="status" className="text-sm text-muted">
            {avatarFileId && avatarHasVersions
              ? labels.imageUnavailable
              : labels.empty}
          </p>
        )}
      </div>
      <form
        onSubmit={upload}
        aria-labelledby={`${id}-title`}
        aria-busy={pending}
        className="mt-5 space-y-4"
      >
        <div>
          <label
            htmlFor={`${id}-file`}
            className="mb-3 block text-sm font-semibold"
          >
            {labels.file}{" "}
            <span className="font-normal text-muted">({labels.optional})</span>
          </label>
          <input
            ref={input}
            id={`${id}-file`}
            name="avatar"
            type="file"
            accept="image/*"
            disabled={!ready || pending}
            aria-invalid={
              (state.kind === "uploadError" &&
                (state.code === "invalidFile" || state.code === "tooLarge")) ||
              undefined
            }
            aria-describedby={`${id}-hint${hasError ? ` ${id}-error` : ""}`}
            onChange={(event) => {
              setSelection(event.currentTarget.files?.[0] ?? null);
              setState({ kind: "idle" });
            }}
            className="block min-h-11 w-full min-w-0 max-w-full rounded-md border border-default bg-surface pr-3 text-sm text-primary file:mr-3 file:min-h-11 file:border-0 file:border-r file:border-solid file:border-default file:bg-surface-muted file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary disabled:cursor-not-allowed disabled:opacity-70"
          />
          <p id={`${id}-hint`} className="mt-2 text-sm text-muted">
            {labels.hint}
          </p>
        </div>
        {hasError && (
          <p
            ref={alert}
            id={`${id}-error`}
            role="alert"
            tabIndex={-1}
            className="rounded-md border border-danger bg-surface-muted p-3 text-sm text-danger"
          >
            {state.kind === "uploadError"
              ? labels.errors[state.code]
              : labels.removeError}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={!ready || !selection || pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-70"
          >
            <UploadSimpleIcon size={20} weight="regular" aria-hidden="true" />
            {state.kind === "uploading" ? labels.pending : labels.submit}
          </button>
          {removalTarget && (
            <button
              type="button"
              onClick={remove}
              disabled={!ready || pending}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-danger px-4 py-2 text-sm font-semibold text-danger disabled:cursor-not-allowed disabled:opacity-70"
            >
              <TrashIcon size={20} weight="regular" aria-hidden="true" />
              {state.kind === "removing" ? labels.removing : labels.remove}
            </button>
          )}
        </div>
        <p role="status" className="text-sm text-muted">
          {state.kind === "uploading"
            ? labels.pending
            : state.kind === "removing"
              ? labels.removing
              : state.kind === "uploaded"
                ? labels.success
                : state.kind === "removed"
                  ? labels.removed
                  : ""}
        </p>
      </form>
    </section>
  );
}

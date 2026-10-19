"use client";

import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  const alert = useRef<HTMLDivElement>(null);
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
    <section className="border-b border-border py-7">
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        {labels.title}
      </h2>
      <div className="mt-4 flex items-center">
        <Avatar
          render={<div />}
          key={avatarFileId}
          className={
            avatarFileId && avatarHasVersions && failedImageId !== avatarFileId
              ? "size-32 max-w-full rounded-md after:rounded-md"
              : "h-auto w-auto rounded-none after:hidden"
          }
        >
          {avatarFileId &&
            avatarHasVersions &&
            failedImageId !== avatarFileId && (
              <AvatarImage
                render={
                  <Image
                    src={`/api/avatars/${avatarFileId}`}
                    alt={labels.imageAlt}
                    width={128}
                    height={128}
                    unoptimized
                  />
                }
                src={`/api/avatars/${avatarFileId}`}
                alt={labels.imageAlt}
                width={128}
                height={128}
                loading="eager"
                className="rounded-md bg-muted object-contain"
                onError={() => setFailedImageId(avatarFileId)}
              />
            )}
          <AvatarFallback
            render={<p role="status" />}
            className="rounded-none bg-transparent text-left"
          >
            {avatarFileId && avatarHasVersions
              ? labels.imageUnavailable
              : labels.empty}
          </AvatarFallback>
        </Avatar>
      </div>
      <form
        onSubmit={upload}
        aria-labelledby={`${id}-title`}
        aria-busy={pending}
        className="mt-5 space-y-4"
      >
        <Field>
          <FieldLabel htmlFor={`${id}-file`}>
            {labels.file}{" "}
            <span className="font-normal text-muted-foreground">
              ({labels.optional})
            </span>
          </FieldLabel>
          <Input
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
            className="min-h-11 min-w-0 max-w-full file:mr-3"
          />
          <FieldDescription id={`${id}-hint`}>{labels.hint}</FieldDescription>
        </Field>
        {hasError && (
          <Alert
            ref={alert}
            id={`${id}-error`}
            variant="destructive"
            tabIndex={-1}
          >
            <AlertDescription>
              {state.kind === "uploadError"
                ? labels.errors[state.code]
                : labels.removeError}
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            disabled={!ready || !selection || pending}
            className="min-h-11 gap-2 px-4"
          >
            <UploadSimpleIcon size={20} weight="regular" aria-hidden="true" />
            {state.kind === "uploading" ? labels.pending : labels.submit}
          </Button>
          {removalTarget && (
            <Button
              type="button"
              onClick={remove}
              disabled={!ready || pending}
              variant="destructive"
              className="min-h-11 gap-2 px-4"
            >
              <TrashIcon size={20} weight="regular" aria-hidden="true" />
              {state.kind === "removing" ? labels.removing : labels.remove}
            </Button>
          )}
        </div>
        <p role="status" className="text-sm text-muted-foreground">
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

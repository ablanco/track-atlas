"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { listError, listRequest } from "./list-request";
import type { TrackListSummary, TrackListErrorCode } from "@/tracks/list-types";

export function ListNameForm({
  list,
  trackId,
  onSaved,
  onUnauthorized,
  disabled = false,
  onPendingChange,
  inline = false,
}: {
  list?: { id: string; name: string };
  trackId?: string;
  onSaved(list: TrackListSummary): void;
  onUnauthorized?(): void;
  disabled?: boolean;
  onPendingChange?(pending: boolean): void;
  inline?: boolean;
}) {
  const t = useTranslations("Lists");
  const id = useId();
  const [name, setName] = useState(list?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TrackListErrorCode | null>(null);
  const lifetime = useRef({
    active: true,
    controller: null as AbortController | null,
  });
  const pendingChange = useRef(onPendingChange);
  useLayoutEffect(() => {
    pendingChange.current = onPendingChange;
  }, [onPendingChange]);
  useLayoutEffect(() => {
    const current = lifetime.current;
    current.active = true;
    return () => {
      current.active = false;
      current.controller?.abort();
      if (current.controller) pendingChange.current?.(false);
      setBusy(false);
      setError(null);
    };
  }, []);
  return (
    <form
      className={
        inline
          ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
          : "space-y-2"
      }
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || disabled) return;
        const trimmed = name.trim();
        if (!trimmed || Array.from(trimmed).length > 100) {
          setError("invalidRequest");
          return;
        }
        setBusy(true);
        onPendingChange?.(true);
        const controller = new AbortController();
        lifetime.current.controller = controller;
        setError(null);
        try {
          const result = await listRequest<{ list: TrackListSummary }>(
            list ? `/api/lists/${list.id}` : "/api/lists",
            {
              signal: controller.signal,
              method: list ? "PATCH" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: trimmed,
                ...(trackId ? { trackId } : {}),
              }),
            },
          );
          if (!lifetime.current.active || controller.signal.aborted) return;
          setName("");
          onSaved(result.list);
        } catch (cause) {
          if (!lifetime.current.active || controller.signal.aborted) return;
          const code = listError(cause);
          setError(code);
          if (code === "unauthorized") onUnauthorized?.();
        } finally {
          if (lifetime.current.active && !controller.signal.aborted) {
            setBusy(false);
            onPendingChange?.(false);
          }
        }
      }}
    >
      <label
        className={
          inline
            ? "col-span-2 text-sm font-medium"
            : "block text-sm font-medium"
        }
        htmlFor={id}
      >
        {t("name")}
      </label>
      <Input
        id={id}
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={busy || disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        autoComplete="off"
      />
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className={
            inline
              ? "col-span-2 text-sm text-destructive"
              : "text-sm text-destructive"
          }
        >
          {t(`errors.${error}`)}
        </p>
      )}
      <Button
        type="submit"
        className={inline ? "col-start-2 row-start-2" : undefined}
        disabled={busy || disabled}
      >
        {t(busy ? "saving" : list ? "save" : "create")}
      </Button>
    </form>
  );
}

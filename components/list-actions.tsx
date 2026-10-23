"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { TrackListSummary, TrackListErrorCode } from "@/tracks/list-types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { ListNameForm } from "./list-name-form";
import { listError, listRequest } from "./list-request";
export function ListActions({
  list,
  onRenamed,
  onDeleted,
  onUnauthorized,
}: {
  list: { id: string; name: string };
  onRenamed(list: TrackListSummary): void;
  onDeleted(): void;
  onUnauthorized(): void;
}) {
  const t = useTranslations("Lists");
  const [mode, setMode] = useState<"rename" | "delete" | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<TrackListErrorCode | null>(null);
  const lifetime = useRef({
    active: true,
    controller: null as AbortController | null,
  });
  useLayoutEffect(() => {
    const current = lifetime.current;
    current.active = true;
    return () => {
      current.active = false;
      current.controller?.abort();
      setBusy(false);
      setMode(null);
      setError(null);
    };
  }, []);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          setMode("rename");
        }}
      >
        {t("rename")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          setMode("delete");
        }}
      >
        {t("delete")}
      </Button>
      <Dialog
        open={mode !== null}
        disablePointerDismissal={busy}
        onOpenChange={(open) => {
          if (!open && !busy) setMode(null);
        }}
      >
        <DialogContent closeButtonProps={{ disabled: busy }}>
          <DialogTitle>
            {t(mode === "delete" ? "deleteTitle" : "renameTitle", {
              name: list.name,
            })}
          </DialogTitle>
          <DialogDescription>
            {t(mode === "delete" ? "deleteDescription" : "renameDescription")}
          </DialogDescription>
          {mode === "rename" ? (
            <ListNameForm
              list={list}
              onPendingChange={setBusy}
              onSaved={(value) => {
                setMode(null);
                onRenamed(value);
              }}
              onUnauthorized={onUnauthorized}
            />
          ) : (
            <>
              {error && (
                <p role="alert" className="text-destructive">
                  {t(`errors.${error}`)}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setMode(null)}
                >
                  {t("cancel")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={async () => {
                    const controller = new AbortController();
                    lifetime.current.controller = controller;
                    setBusy(true);
                    setError(null);
                    try {
                      await listRequest(`/api/lists/${list.id}`, {
                        method: "DELETE",
                        signal: controller.signal,
                      });
                      if (!lifetime.current.active || controller.signal.aborted)
                        return;
                      setMode(null);
                      onDeleted();
                    } catch (cause) {
                      if (!lifetime.current.active || controller.signal.aborted)
                        return;
                      const code = listError(cause);
                      setError(code);
                      if (code === "unauthorized") onUnauthorized();
                    } finally {
                      if (lifetime.current.active) setBusy(false);
                    }
                  }}
                >
                  {t(busy ? "saving" : "deleteList")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

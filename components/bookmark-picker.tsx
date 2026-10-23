"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Popover } from "@base-ui/react/popover";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/dist/csr/BookmarkSimple";
import type { TrackListPicker, TrackListErrorCode } from "@/tracks/list-types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { LoginModal, type AuthLabels } from "./auth-control";
import { ListNameForm } from "./list-name-form";
import { listRequest, listError } from "./list-request";

export function BookmarkPicker({
  trackId,
  authLabels,
  initialBookmarked = false,
  loadInitial = false,
  onMembershipChange,
  onUnauthorized,
  size = "default",
}: {
  trackId: string;
  authLabels?: AuthLabels;
  initialBookmarked?: boolean;
  loadInitial?: boolean;
  onMembershipChange?(listId: string, contains: boolean): void;
  onUnauthorized?(): void;
  size?: "default" | "lg";
}) {
  const t = useTranslations("Lists");
  const locale = useLocale();
  const [login, setLogin] = useState(false);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TrackListPicker | null>(null);
  const [filled, setFilled] = useState(initialBookmarked);
  const [error, setError] = useState<TrackListErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const operations = useRef(0);
  const [operation, setOperation] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  function cancelOperations() {
    setOperation(++operations.current);
    mutation.current?.abort();
    setBusy(false);
  }
  useLayoutEffect(() => {
    const lifetime = generation;
    return () => {
      lifetime.current++;
      cancelOperations();
      setData(null);
      setFilled(false);
      setOpen(false);
      setLogin(false);
      setError(null);
    };
  }, []);
  useEffect(() => {
    // Strict Mode and Activity cleanup discard private state. Reauthorize even
    // a closed explorer picker on resumption; never replay discarded props.
    if (
      (!open && !loadInitial && generation.current === 0 && attempt === 0) ||
      document.visibilityState === "hidden"
    )
      return;
    const controller = new AbortController();
    const lifetime = generation;
    const current = ++lifetime.current;
    listRequest<TrackListPicker>(`/api/lists?trackId=${trackId}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (current === generation.current) {
          setData(open ? value : null);
          setFilled(value.lists.some((list) => list.containsTrack));
        }
      })
      .catch((cause) => {
        if (current === generation.current && !controller.signal.aborted) {
          const code = listError(cause);
          setError(code);
          if (code === "unauthorized") {
            setData(null);
            setFilled(false);
            setOpen(false);
            if (open) {
              setLogin(true);
              onUnauthorized?.();
            }
          }
        }
      });
    return () => {
      lifetime.current++;
      controller.abort();
    };
  }, [open, trackId, attempt, loadInitial, onUnauthorized]);
  useEffect(() => {
    const discard = () => {
      generation.current++;
      cancelOperations();
      setOpen(false);
      setLogin(false);
      setData(null);
      setFilled(false);
      setError(null);
      setAttempt((value) => value + 1);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) discard();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") discard();
      else setAttempt((value) => value + 1);
    };
    window.addEventListener("pageshow", restore);
    window.addEventListener("pagehide", discard);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("pagehide", discard);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  async function toggle(id: string, contains: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const current = generation.current;
    const controller = new AbortController();
    mutation.current = controller;
    try {
      await listRequest(`/api/lists/${id}/tracks/${trackId}`, {
        method: contains ? "PUT" : "DELETE",
        signal: controller.signal,
      });
      if (current !== generation.current) return;
      const next = {
        lists: data!.lists.map((list) =>
          list.id === id ? { ...list, containsTrack: contains } : list,
        ),
      };
      setData(next);
      setFilled(next.lists.some((list) => list.containsTrack));
      onMembershipChange?.(id, contains);
    } catch (cause) {
      if (current !== generation.current) return;
      const code = listError(cause);
      setError(code);
      if (code === "unauthorized") {
        setData(null);
        setFilled(false);
        setOpen(false);
        setLogin(true);
        onUnauthorized?.();
      }
    } finally {
      if (current === generation.current && !controller.signal.aborted)
        setBusy(false);
    }
  }
  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            generation.current++;
            cancelOperations();
          }
          setOpen(value);
          setData(null);
          setError(null);
        }}
      >
        <Popover.Trigger
          render={
            <Button
              ref={trigger}
              type="button"
              variant="ghost"
              size="icon"
              className={
                size === "lg"
                  ? "size-12 shrink-0"
                  : "shrink-0 max-sm:min-h-11 max-sm:min-w-11"
              }
              aria-label={t("bookmark")}
              aria-pressed={filled}
            />
          }
        >
          <BookmarkSimpleIcon
            aria-hidden="true"
            className={size === "lg" ? "size-8" : undefined}
            weight={filled ? "fill" : "regular"}
          />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            sideOffset={6}
            collisionPadding={16}
            className="z-50"
          >
            <Popover.Popup
              onClick={(event) => event.stopPropagation()}
              aria-label={t("bookmark")}
              className="w-80 max-w-[calc(100vw-2rem)] max-h-[min(32rem,calc(100dvh-2rem))] overflow-y-auto rounded-md border bg-popover p-4 text-popover-foreground shadow-md"
            >
              {data ? (
                <PickerChoices
                  data={data}
                  busy={busy}
                  toggle={toggle}
                  onPendingChange={(pending) => {
                    if (operation === operations.current) setBusy(pending);
                  }}
                  trackId={trackId}
                  onCreated={(list) => {
                    if (operation !== operations.current) return;
                    setData((previous) => ({
                      lists: [
                        { ...list, containsTrack: true },
                        ...(previous?.lists ?? []),
                      ],
                    }));
                    setError(null);
                    setFilled(true);
                    onMembershipChange?.(list.id, true);
                  }}
                  onUnauthorized={() => {
                    if (operation !== operations.current) return;
                    setData(null);
                    setFilled(false);
                    setOpen(false);
                    setLogin(true);
                    onUnauthorized?.();
                  }}
                />
              ) : (
                <p role="status">{t("loading")}</p>
              )}
              {error && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {t(`errors.${error}`)}{" "}
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => {
                      setError(null);
                      setAttempt((x) => x + 1);
                    }}
                  >
                    {t("retry")}
                  </Button>
                </p>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {login && authLabels && (
        <LoginModal
          locale={locale}
          labels={authLabels}
          onSubmit={() => {}}
          onClose={() => {
            setLogin(false);
            trigger.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}
function PickerChoices({
  data,
  busy,
  toggle,
  trackId,
  onCreated,
  onUnauthorized,
  onPendingChange,
}: {
  data: TrackListPicker;
  busy: boolean;
  toggle(id: string, contains: boolean): void;
  trackId: string;
  onCreated(list: import("@/tracks/list-types").TrackListSummary): void;
  onUnauthorized(): void;
  onPendingChange(pending: boolean): void;
}) {
  const t = useTranslations("Lists");
  const [search, setSearch] = useState("");
  const choices = data.lists.filter((list) =>
    list.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="space-y-3">
      <Input
        type="search"
        aria-label={t("search")}
        placeholder={t("search")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="max-h-56 overflow-y-auto">
        {choices.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">
            {t(data.lists.length ? "noMatches" : "emptyPicker")}
          </p>
        )}
        {choices.map((list) => (
          <label
            key={list.id}
            className="flex min-h-11 items-center gap-3 break-words text-sm"
          >
            <input
              type="checkbox"
              checked={list.containsTrack}
              disabled={busy}
              onChange={(e) => toggle(list.id, e.target.checked)}
            />
            {list.name}
          </label>
        ))}
      </div>
      <div className="border-t pt-3">
        <ListNameForm
          trackId={trackId}
          disabled={busy}
          onPendingChange={onPendingChange}
          onSaved={onCreated}
          onUnauthorized={onUnauthorized}
        />
      </div>
    </div>
  );
}

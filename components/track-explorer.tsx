"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { ExploreMap } from "@/components/explore-map";
import { getExploreTrackColor } from "@/tracks/explore-map";
import {
  parseExploreFilters,
  serializeExploreFilters,
} from "@/tracks/explore-query";
import { ExploreFilters } from "@/components/explore-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type {
  ExploreResult,
  ExploreGeometryStatus,
} from "@/tracks/explore-types";

function formatExploreDistance(meters: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilometer",
    // Keep short, nonzero tracks visible below the usual 0.01 km rounding.
    ...(meters > 0 && meters < 10
      ? { maximumSignificantDigits: 2 }
      : { maximumFractionDigits: 2 }),
  }).format(meters / 1000);
}

export function TrackExplorer({ ownerId }: { ownerId?: string }) {
  const t = useTranslations("Explore");
  const tracks = useTranslations("Tracks");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [draft, setDraft] = useState({
    query,
    text: searchParams.get("q") ?? "",
  });
  const text =
    draft.query === query ? draft.text : (searchParams.get("q") ?? "");
  const [snapshot, setSnapshot] = useState<{
    query: string;
    result: ExploreResult;
    slots: Record<string, number>;
  } | null>(null);
  const [lastQuery, setLastQuery] = useState(query);
  const result = snapshot?.query === query ? snapshot.result : null;
  let validQuery = true;
  try {
    parseExploreFilters(new URLSearchParams(query));
  } catch {
    validQuery = false;
  }
  const [failedQuery, setFailedQuery] = useState<string | null>(null);
  const error = failedQuery === query;
  const list = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{
    result: ExploreResult;
    id: string;
  } | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const selectedId =
    result && selection?.result === result ? selection.id : null;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<
    Record<string, ExploreGeometryStatus>
  >({});
  const [retry, setRetry] = useState<{ id: string; attempt: number } | null>(
    null,
  );
  const entries = useRef(new Map<string, HTMLLIElement>());
  const mapTracks = useMemo(
    () =>
      result
        ? result.tracks.map((track) => ({
            id: track.id,
            name: track.name,
            number: snapshot!.slots[track.id] + 1,
            color: getExploreTrackColor(snapshot!.slots[track.id]),
          }))
        : [],
    [result, snapshot],
  );
  const onStatus = useCallback((id: string, status: ExploreGeometryStatus) => {
    setStatuses((previous) =>
      previous[id] === status ? previous : { ...previous, [id]: status },
    );
  }, []);
  const selectFromMap = useCallback(
    (id: string) => {
      if (!result?.tracks.some((track) => track.id === id)) return;
      setSelection({ result, id });
      setView("list");
      requestAnimationFrame(() => {
        const entry = entries.current.get(id);
        entry
          ?.querySelector<HTMLButtonElement>("button")
          ?.focus({ preventScroll: true });
        entry?.scrollIntoView({ block: "nearest" });
      });
    },
    [result],
  );
  const [invalid, setInvalid] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSearch = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  if (lastQuery !== query) {
    setLastQuery(query);
    setFailedQuery(null);
    setInvalid(false);
    // Retain only palette slots and bounds while a new URL is reauthorized.
    // Mark even a Back-navigation snapshot unusable before committing a render.
    setSnapshot((previous) => (previous ? { ...previous, query: "\0" } : null));
  }
  const update = useCallback((change: (params: URLSearchParams) => void) => {
    // Read the URL synchronously so consecutive controls compose before a render.
    const params = new URLSearchParams(window.location.search);
    let searchChanged = false;
    if (pendingSearch.current !== null) {
      const value = pendingSearch.current.trim().replace(/\s+/gu, " ");
      searchChanged =
        value !== (params.get("q") ?? "").trim().replace(/\s+/gu, " ");
      if (value) params.set("q", value);
      else params.delete("q");
    }
    change(params);
    // A page control still represents the old results while new text is pending.
    if (searchChanged) params.delete("page");
    let canonical: URLSearchParams;
    try {
      canonical = serializeExploreFilters(parseExploreFilters(params));
    } catch {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft({ query: canonical.toString(), text: canonical.get("q") ?? "" });
    pendingSearch.current = null;
    if (timer.current) clearTimeout(timer.current);
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${canonical.size ? `?${canonical}` : ""}`,
    );
  }, []);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    pendingSearch.current = null;
  }, [query]);
  useLayoutEffect(
    () => () => {
      // Next Activity retains hidden routes: discard metadata before returning.
      setSnapshot(null);
      setFailedQuery(null);
      setSelection(null);
      setHoveredId(null);
      setFocusedId(null);
      setStatuses({});
      setRetry(null);
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    list.current?.scrollTo(0, 0);
    const params = new URLSearchParams(query);
    // Validate shared URLs before feeding their numeric values to sliders.
    try {
      parseExploreFilters(params);
    } catch {
      queueMicrotask(() => {
        if (active) setFailedQuery(query);
      });
      return () => {
        active = false;
      };
    }
    const timeout = setTimeout(() => controller.abort(), 20_000);
    if (ownerId) params.set("ownerId", ownerId);
    fetch(`/api/tracks/explore?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error("unavailable");
        const data: ExploreResult = await response.json();
        if (active) {
          setSnapshot((previous) => {
            const retained = Object.fromEntries(
              data.tracks
                .filter((track) => previous?.slots[track.id] !== undefined)
                .map((track) => [track.id, previous!.slots[track.id]]),
            );
            const used = new Set(Object.values(retained));
            for (const track of data.tracks) {
              if (retained[track.id] !== undefined) continue;
              const slot = Array.from({ length: 10 }, (_, index) => index).find(
                (index) => !used.has(index),
              )!;
              retained[track.id] = slot;
              used.add(slot);
            }
            return { query, result: data, slots: retained };
          });
          setStatuses({});
          setSelection(null);
          setHoveredId(null);
          setFocusedId(null);
          setFailedQuery(null);
          if (
            data.page !== Number(new URLSearchParams(query).get("page") ?? 1)
          ) {
            const canonical = new URLSearchParams(query);
            if (data.page === 1) canonical.delete("page");
            else canonical.set("page", String(data.page));
            window.history.replaceState(
              null,
              "",
              `${window.location.pathname}${canonical.size ? `?${canonical}` : ""}`,
            );
          }
        }
      })
      .catch(() => {
        if (active) setFailedQuery(query);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, ownerId, attempt]);
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0 border-b p-4">
        <h1 className="text-lg font-semibold">
          {result?.collection
            ? t("collectionOwner", { name: result.collection.name })
            : t(ownerId ? "collection" : "title")}
        </h1>
        {result?.collection && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <Avatar aria-hidden="true">
              {result.collection.avatarUrl && (
                <AvatarImage
                  src={result.collection.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              )}
              <AvatarFallback>
                {Array.from(result.collection.name)[0]}
              </AvatarFallback>
            </Avatar>
            {result.collection.name}
          </div>
        )}
        {(invalid || !validQuery) && (
          <p role="alert" className="text-sm text-destructive">
            {t("invalidFilters")}{" "}
            <Button
              type="button"
              variant="link"
              onClick={() =>
                update((params) => {
                  for (const key of [...params.keys()]) params.delete(key);
                })
              }
            >
              {t("clear")}
            </Button>
          </p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <Input
            type="search"
            aria-label={t("search")}
            placeholder={t("search")}
            value={text}
            onChange={(event) => {
              const value = event.target.value;
              setDraft({ query, text: value });
              pendingSearch.current = value;
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => {
                update((params) => params.delete("page"));
              }, 300);
            }}
          />
          <Button
            type="button"
            variant="outline"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            {t("filters")}
          </Button>
        </div>
        <div className="mt-2 flex gap-2 lg:hidden" aria-label={t("view")}>
          {(["list", "map"] as const).map((mode) => (
            <Button
              type="button"
              key={mode}
              variant={view === mode ? "secondary" : "outline"}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {t(mode)}
            </Button>
          ))}
        </div>
        {filtersOpen && validQuery && (
          <div className="max-h-[45dvh] overflow-y-auto">
            <ExploreFilters
              key={query + JSON.stringify(snapshot?.result.bounds)}
              query={query}
              bounds={
                snapshot?.result.bounds ?? {
                  maxDistanceKm: 1,
                  maxElevationRangeMeters: 1,
                }
              }
              isOwner={snapshot?.result.collection?.isOwner ?? false}
              onChange={update}
            />
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section
          className={`min-h-0 w-full flex-col lg:flex lg:w-96 lg:shrink-0 lg:border-r ${view === "list" ? "flex" : "hidden"}`}
          aria-label={t("results")}
        >
          {error ? (
            <p role="alert">
              {t("unavailable")}{" "}
              <button
                onClick={() => {
                  setFailedQuery(null);
                  setSnapshot(null);
                  setAttempt((x) => x + 1);
                }}
              >
                {t("retry")}
              </button>
            </p>
          ) : !result ? (
            <p role="status">{t("loading")}</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <p role="status" className="p-4 text-sm">
                {t("count", { count: result.total })}
              </p>
              <div ref={list} className="min-h-0 flex-1 overflow-y-auto">
                {result.tracks.length === 0 && (
                  <div className="space-y-3 p-4">
                    <p>
                      {t(
                        result.scopeCount === 0
                          ? ownerId
                            ? "emptyCollection"
                            : "emptyPublic"
                          : "noMatches",
                      )}
                    </p>
                    {result.scopeCount > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          update((params) => {
                            for (const key of [...params.keys()])
                              params.delete(key);
                          })
                        }
                      >
                        {t("clear")}
                      </Button>
                    )}
                  </div>
                )}
                <ul aria-label={t("results")}>
                  {result.tracks.map((track) => (
                    <li
                      key={track.id}
                      ref={(node) => {
                        if (node) entries.current.set(track.id, node);
                        else entries.current.delete(track.id);
                      }}
                      onMouseEnter={() => setHoveredId(track.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onFocusCapture={() => setFocusedId(track.id)}
                      onBlurCapture={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget))
                          setFocusedId(null);
                      }}
                      className={`border-b p-4 ${selectedId === track.id ? "bg-accent ring-2 ring-inset ring-ring" : ""}`}
                      onClick={(event) => {
                        if (!(event.target as HTMLElement).closest("a, button"))
                          setSelection({ result, id: track.id });
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <Button
                          type="button"
                          variant={
                            selectedId === track.id ? "secondary" : "outline"
                          }
                          size="icon"
                          className="shrink-0 border-2"
                          style={{
                            borderColor: getExploreTrackColor(
                              snapshot!.slots[track.id],
                            ),
                          }}
                          aria-label={t("selectTrack", {
                            number: snapshot!.slots[track.id] + 1,
                            name: track.name,
                          })}
                          aria-pressed={selectedId === track.id}
                          onClick={() => setSelection({ result, id: track.id })}
                        >
                          {snapshot!.slots[track.id] + 1}
                        </Button>
                        <div className="min-w-0 space-y-2">
                          <Link
                            className="block break-words font-semibold hover:underline"
                            href={`/tracks/${track.id}`}
                            prefetch={false}
                          >
                            {track.name}
                          </Link>
                          <Link
                            className="flex w-fit items-center gap-2 text-sm hover:underline"
                            href={`/users/${track.owner.id}/tracks`}
                            prefetch={false}
                          >
                            <Avatar size="sm" aria-hidden="true">
                              {track.owner.avatarUrl && (
                                <AvatarImage
                                  src={track.owner.avatarUrl}
                                  alt=""
                                  referrerPolicy="no-referrer"
                                />
                              )}
                              <AvatarFallback>
                                {Array.from(track.owner.name)[0]}
                              </AvatarFallback>
                            </Avatar>
                            {track.owner.name}
                          </Link>
                          <p className="text-sm text-muted-foreground">
                            {tracks(`activities.${track.activity}`)} ·{" "}
                            {t("difficultyValue", { value: track.difficulty })}{" "}
                            ·{" "}
                            {formatExploreDistance(
                              track.distanceMeters,
                              locale,
                            )}
                          </p>
                          <div
                            className="text-xs text-muted-foreground"
                            role="status"
                          >
                            {(statuses[track.id] ?? "loading") === "loading" &&
                              t("pathLoading")}
                            {statuses[track.id] === "error" && (
                              <>
                                <span>{t("pathError")}</span>
                                <Button
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  aria-label={t("retryPath", {
                                    name: track.name,
                                  })}
                                  onClick={() =>
                                    setRetry((previous) => ({
                                      id: track.id,
                                      attempt: (previous?.attempt ?? 0) + 1,
                                    }))
                                  }
                                >
                                  {t("retry")}
                                </Button>
                              </>
                            )}
                          </div>
                          {track.visibility === "private" && (
                            <span className="rounded bg-muted px-2 py-1 text-xs">
                              {t("private")}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <nav
                aria-label={t("pagination")}
                className="flex flex-wrap items-center gap-2 border-t p-4"
              >
                <p className="w-full text-sm">
                  {t("pageOf", { page: result.page, count: result.pageCount })}
                </p>
                {Array.from(
                  { length: Math.min(result.pageCount, 7) },
                  (_, i) => {
                    const page =
                      result.pageCount <= 7
                        ? i + 1
                        : Math.min(
                            Math.max(1, result.page - 3),
                            result.pageCount - 6,
                          ) + i;
                    return (
                      <Button
                        type="button"
                        key={page}
                        size="sm"
                        aria-label={t("page", { page })}
                        aria-current={page === result.page ? "page" : undefined}
                        variant={page === result.page ? "secondary" : "outline"}
                        onClick={() => {
                          update((params) => {
                            if (page === 1) params.delete("page");
                            else params.set("page", String(page));
                          });
                        }}
                      >
                        {page}
                      </Button>
                    );
                  },
                )}
              </nav>
            </div>
          )}
        </section>
        <section
          aria-label={t("map")}
          className={`relative min-h-0 min-w-0 flex-1 lg:block ${view === "map" ? "block" : "hidden"}`}
        >
          <ExploreMap
            tracks={mapTracks}
            selectedId={selectedId}
            highlightedId={hoveredId ?? focusedId}
            onSelect={selectFromMap}
            onStatus={onStatus}
            retry={retry}
          />
        </section>
      </div>
    </main>
  );
}

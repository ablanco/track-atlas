"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Map, {
  AttributionControl,
  Layer,
  Marker,
  Source,
  type MapRef,
} from "react-map-gl/maplibre";
import { useLocale, useTranslations } from "next-intl";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import type { ExploreMapProps } from "@/tracks/explore-types";
import {
  prepareExplorePaths,
  readExploreGeometry,
  type ExploreGeometry,
} from "@/tracks/explore-map";
import { createOutdoorStyle } from "@/tracks/outdoor-style";
import { topographicStyle } from "@/tracks/topographic-style";
import { createSatelliteStyle } from "@/tracks/satellite-style";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { ExploreMapFailure } from "./explore-map-feedback";
import "maplibre-gl/dist/maplibre-gl.css";
import "./track-map.css";

type Basemap = "street" | "outdoor" | "topographic" | "satellite";

export default function ExploreMapRenderer({
  tracks,
  selectedId,
  highlightedId,
  onSelect,
  onStatus,
  retry,
}: ExploreMapProps) {
  const t = useTranslations("ExploreMap");
  const shared = useTranslations("Tracks.map");
  const locale = useLocale();
  const outdoor = useMemo(() => createOutdoorStyle(locale), [locale]);
  const satellite = useMemo(
    () =>
      createSatelliteStyle(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? ""),
    [],
  );
  const [basemap, setBasemap] = useState<Basemap>("outdoor");
  const [failed, setFailed] = useState(false);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [cache, setCache] = useState<{
    key: string;
    geometries: Record<string, ExploreGeometry>;
    anchor?: number;
  } | null>(null);
  const [chooser, setChooser] = useState<{ key: string; ids: string[] } | null>(
    null,
  );
  const map = useRef<MapRef>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const contextLost = useCallback(() => setFailed(true), []);
  const container = useRef<HTMLDivElement>(null);
  const manualCamera = useRef(false);
  const fetchOne = useRef<(id: string) => void>(() => {});
  const status = useRef(onStatus);
  const resultKey = JSON.stringify(tracks.map((track) => track.id));
  useLayoutEffect(() => {
    status.current = onStatus;
  }, [onStatus]);

  // Activity cleanup and generation cancellation protect retained private views.
  useLayoutEffect(() => {
    const ids: string[] = JSON.parse(resultKey);
    const jobs = new globalThis.Map<
      string,
      { controller: AbortController; timeout: ReturnType<typeof setTimeout> }
    >();
    let disposed = false;
    manualCamera.current = false;
    const request = (id: string) => {
      if (!ids.includes(id) || disposed) return;
      const old = jobs.get(id);
      if (old) {
        old.controller.abort();
        clearTimeout(old.timeout);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const job = { controller, timeout };
      jobs.set(id, job);
      setCache((current) => {
        const geometries =
          current?.key === resultKey ? { ...current.geometries } : {};
        delete geometries[id];
        return {
          key: resultKey,
          geometries,
          anchor: current?.key === resultKey ? current.anchor : undefined,
        };
      });
      status.current(id, "loading");
      fetch(`/api/tracks/${encodeURIComponent(id)}/explore-geometry`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw Error("Geometry unavailable");
          return response.json();
        })
        .then((data) => {
          const geometry = readExploreGeometry(data);
          if (disposed || jobs.get(id) !== job) return;
          setCache((current) => ({
            key: resultKey,
            anchor:
              (current?.key === resultKey ? current.anchor : undefined) ??
              geometry.coordinates[0][0],
            geometries: {
              ...(current?.key === resultKey ? current.geometries : {}),
              [id]: geometry,
            },
          }));
          status.current(id, "ready");
        })
        .catch(() => {
          if (!disposed && jobs.get(id) === job) status.current(id, "error");
        })
        .finally(() => {
          clearTimeout(timeout);
        });
    };
    fetchOne.current = request;
    ids.forEach(request);
    return () => {
      disposed = true;
      jobs.forEach(({ controller, timeout }) => {
        controller.abort();
        clearTimeout(timeout);
      });
      fetchOne.current = () => {};
      setCache(null);
      setChooser(null);
    };
  }, [resultKey]);

  const retryId = retry?.id;
  const retryAttempt = retry?.attempt;
  useEffect(() => {
    if (retryId) fetchOne.current(retryId);
  }, [retryId, retryAttempt]);
  const page = useMemo(
    () =>
      prepareExplorePaths(
        tracks.flatMap((track) => {
          const geometry =
            cache?.key === resultKey ? cache.geometries[track.id] : undefined;
          return geometry ? [{ id: track.id, geometry }] : [];
        }),
        cache?.key === resultKey ? cache.anchor : undefined,
      ),
    [tracks, cache, resultKey],
  );
  useEffect(() => {
    const instance = map.current?.getMap();
    for (const id of [selectedId, highlightedId]) {
      if (!id) continue;
      for (const layer of [`explore-outline-${id}`, `explore-line-${id}`]) {
        if (instance?.getLayer(layer)) instance.moveLayer(layer);
      }
    }
  }, [selectedId, highlightedId, page, basemap, loaded]);
  const fit = useCallback(() => {
    if (page.bounds)
      map.current?.fitBounds(page.bounds, {
        padding: 64,
        maxZoom: 16,
        duration: 0,
      });
  }, [page.bounds]);
  useEffect(() => {
    if (loaded && !manualCamera.current) fit();
  }, [fit, loaded]);

  // Resize also when the mobile List/Map switch reveals the retained map.
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (loaded && !switching) return;
    const timer = setTimeout(() => {
      setBasemapFailed(true);
      setSwitching(false);
    }, 25_000);
    return () => clearTimeout(timer);
  }, [loaded, switching, basemap]);
  useLayoutEffect(() => {
    return () => {
      canvas.current?.removeEventListener("webglcontextlost", contextLost);
      setLoaded(false);
      setFailed(false);
    };
  }, [contextLost]);

  const css = getComputedStyle(document.documentElement);
  const resolveColor = (color: string) => {
    const token = /^var\((--[\w-]+)\)$/.exec(color);
    return token ? css.getPropertyValue(token[1]).trim() : color;
  };
  const outline = css.getPropertyValue("--recorded-path-outline").trim();
  const pathIds = page.paths.map((path) => `explore-line-${path.id}`);
  const choices =
    chooser?.key === resultKey
      ? tracks.filter((track) => chooser.ids.includes(track.id))
      : [];
  if (failed) return <ExploreMapFailure />;
  return (
    <div
      ref={container}
      className="track-map relative h-full min-h-80 w-full overflow-hidden bg-background"
      aria-label={t("title")}
      onWheelCapture={() => map.current?.getMap().cooperativeGestures.disable()}
      onWheel={() => map.current?.getMap().cooperativeGestures.enable()}
    >
      <Map
        ref={map}
        initialViewState={{ longitude: 0, latitude: 25, zoom: 1 }}
        mapStyle={
          basemap === "outdoor"
            ? outdoor
            : basemap === "topographic"
              ? topographicStyle
              : basemap === "satellite"
                ? satellite
                : "https://tiles.openfreemap.org/styles/liberty"
        }
        transformRequest={(url) => ({ url, referrerPolicy: "no-referrer" })}
        attributionControl={false}
        scrollZoom
        cooperativeGestures
        dragRotate={false}
        touchPitch={false}
        maxPitch={0}
        canvasContextAttributes={{ preserveDrawingBuffer: false }}
        locale={{
          "Map.Title": t("title"),
          "CooperativeGesturesHandler.WindowsHelpText": shared("gesture"),
          "CooperativeGesturesHandler.MacHelpText": shared("gesture"),
          "CooperativeGesturesHandler.MobileHelpText": shared("gesture"),
        }}
        interactiveLayerIds={pathIds}
        onMoveStart={(event) => {
          if (event.originalEvent) manualCamera.current = true;
        }}
        onClick={(event) => {
          const ids = [
            ...new Set(
              event.features
                ?.map((feature) => String(feature.properties?.id))
                .filter((id) => tracks.some((track) => track.id === id)) ?? [],
            ),
          ];
          if (ids.length === 1) onSelect(ids[0]);
          else if (ids.length > 1) setChooser({ key: resultKey, ids });
        }}
        onLoad={() => {
          const instance = map.current?.getMap();
          instance?.touchZoomRotate.disableRotation();
          instance?.keyboard.disableRotation();
          canvas.current = map.current?.getCanvas() ?? null;
          canvas.current?.addEventListener("webglcontextlost", contextLost, {
            once: true,
          });
          setLoaded(true);
        }}
        onIdle={() => setSwitching(false)}
        onError={(event) => {
          const source = "sourceId" in event ? event.sourceId : undefined;
          if (
            typeof source === "string" &&
            source.startsWith("explore-path-")
          ) {
            status.current(source.slice("explore-path-".length), "error");
            return;
          }
          if (
            (source === "outdoor" ||
              source === "topographic" ||
              source === "satellite") &&
            source !== basemap
          )
            return;
          setBasemapFailed(true);
          setSwitching(false);
        }}
      >
        {page.paths.map((path) => {
          const track = tracks.find((track) => track.id === path.id)!;
          const selected = selectedId === track.id;
          const highlighted = highlightedId === track.id;
          const color = resolveColor(track.color);
          const first = path.geometry.coordinates[0];
          return (
            <Source
              key={track.id}
              id={`explore-path-${track.id}`}
              type="geojson"
              tolerance={0}
              data={{
                type: "Feature",
                properties: { id: track.id },
                geometry: path.geometry,
              }}
            >
              <Layer
                id={`explore-outline-${track.id}`}
                type="line"
                paint={{
                  "line-color": outline,
                  "line-width": selected || highlighted ? 11 : 7,
                }}
              />
              <Layer
                id={`explore-line-${track.id}`}
                type="line"
                paint={{
                  "line-color": color,
                  "line-width": selected || highlighted ? 7 : 4,
                }}
              />
              <Marker
                ref={(marker) => {
                  if (marker) {
                    marker.getElement().removeAttribute("role");
                    marker.getElement().removeAttribute("tabindex");
                  }
                }}
                longitude={first[0]}
                latitude={Math.max(-85.051129, Math.min(85.051129, first[1]))}
              >
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-full border-2 bg-background font-bold text-foreground shadow focus-visible:outline-2 focus-visible:outline-ring"
                  style={{
                    borderColor: color,
                    outline:
                      selected || highlighted
                        ? `3px solid ${color}`
                        : undefined,
                  }}
                  aria-pressed={selected}
                  aria-label={t("select", {
                    number: track.number,
                    name: track.name,
                  })}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(track.id);
                  }}
                >
                  {track.number}
                </button>
              </Marker>
            </Source>
          );
        })}
        <AttributionControl compact={false} />
      </Map>
      <label className="absolute top-2 left-2 max-w-[calc(100%-5rem)] rounded-md bg-background p-2 text-sm shadow">
        <span className="sr-only">{shared("basemap")}</span>
        <select
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-foreground"
          value={basemap}
          onChange={(event) => {
            setBasemap(event.target.value as Basemap);
            setSwitching(true);
            setBasemapFailed(false);
          }}
        >
          <option value="street">{shared("street")}</option>
          <option value="outdoor">{shared("outdoor")}</option>
          <option value="topographic">{shared("topographic")}</option>
          {process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN && (
            <option value="satellite">{shared("satellite")}</option>
          )}
        </select>
      </label>
      <div
        role="group"
        aria-label={shared("controls")}
        className="absolute top-2 right-2 flex flex-col gap-1 rounded-md bg-background p-1 shadow"
      >
        <Button
          size="icon"
          variant="outline"
          className="size-11"
          aria-label={shared("zoomIn")}
          onClick={() => {
            manualCamera.current = true;
            map.current?.zoomIn({ duration: 0 });
          }}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="size-11"
          aria-label={shared("zoomOut")}
          onClick={() => {
            manualCamera.current = true;
            map.current?.zoomOut({ duration: 0 });
          }}
        >
          <MinusIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="size-11"
          aria-label={t("fit")}
          onClick={() => {
            manualCamera.current = false;
            fit();
          }}
        >
          <CrosshairIcon aria-hidden="true" />
        </Button>
      </div>
      {(!loaded || switching) && !basemapFailed && (
        <p
          role="status"
          className="absolute top-24 left-2 bg-background p-2 text-sm"
        >
          {shared("loading")}
        </p>
      )}
      {basemapFailed && (
        <p
          role="alert"
          className="absolute top-24 left-2 max-w-[calc(100%-5rem)] rounded-md bg-background p-2 text-sm shadow"
        >
          {t("basemapFailure")}
        </p>
      )}
      {page.polar && (
        <p className="absolute bottom-10 left-2 max-w-[70%] bg-background p-2 text-xs">
          {shared("polar")}
        </p>
      )}
      <details className="absolute bottom-10 right-2 max-w-[70%] rounded-md bg-background p-2 text-xs shadow">
        <summary className="min-h-11 cursor-pointer py-3">
          {shared("help")}
        </summary>
        <p>{shared("privacy")}</p>
        <p>{shared("interaction")}</p>
      </details>
      <Dialog
        open={choices.length > 1}
        onOpenChange={(open) => {
          if (!open) setChooser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("choose")}</DialogTitle>
          </DialogHeader>
          {choices.map((track) => (
            <Button
              key={track.id}
              variant="outline"
              className="min-h-11 h-auto justify-start whitespace-normal text-left"
              onClick={() => {
                setChooser(null);
                onSelect(track.id);
              }}
            >
              {track.number}. {track.name}
            </Button>
          ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}

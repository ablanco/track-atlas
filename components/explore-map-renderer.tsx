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
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { exploreDrawingGeometry } from "@/tracks/explore-spatial-geometry";
import {
  parseExploreFilters,
  serializeExploreFilters,
} from "@/tracks/explore-query";
import type {
  ExploreDrawing,
  ExplorePosition,
  ExploreMapProps,
} from "@/tracks/explore-types";
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

const normalizeLongitude = (longitude: number) =>
  ((((longitude + 180) % 360) + 360) % 360) - 180;

type Basemap = "street" | "outdoor" | "topographic" | "satellite";

export default function ExploreMapRenderer({
  tracks,
  selectedId,
  highlightedId,
  onSelect,
  onStatus,
  retry,
  spatial,
  drawRequest,
  onDrawing,
  onPlacementMode,
  onViewport,
}: ExploreMapProps) {
  const t = useTranslations("ExploreMap");
  const spatialText = useTranslations("ExploreSpatial");
  const restoreKey = spatial?.restoreKey ?? 0;
  const [placement, setPlacement] = useState<{
    restoreKey: number;
    mode: ExploreDrawing["mode"];
    start: ExplorePosition | null;
  } | null>(null);
  if (placement && placement.restoreKey !== restoreKey) setPlacement(null);
  const [hadDrawing, setHadDrawing] = useState(!!spatial?.drawing);
  if (hadDrawing !== !!spatial?.drawing) {
    setHadDrawing(!!spatial?.drawing);
    if (!spatial?.drawing) setPlacement(null);
  }
  const [invalidDrawing, setInvalidDrawing] = useState(false);
  const consumedRequest = useRef<number | undefined>(undefined);
  const requestId = drawRequest?.id;
  const requestMode = drawRequest?.mode;
  const placementMode = placement?.mode ?? null;
  useEffect(() => {
    if (consumedRequest.current !== undefined) onPlacementMode?.(placementMode);
  }, [placementMode, onPlacementMode]);
  useEffect(() => {
    if (!placement) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPlacement(null);
        setInvalidDrawing(false);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [placement]);
  const place = (position: ExplorePosition) => {
    if (!placement) return;
    const point: ExplorePosition = [
      normalizeLongitude(position[0]),
      position[1],
    ];
    if (!placement.start) {
      setPlacement({ ...placement, start: point });
      return;
    }
    const drawing: ExploreDrawing = {
      mode: placement.mode,
      start: placement.start,
      end: point,
      corridorKm: spatial?.drawing?.corridorKm ?? 1,
    };
    try {
      const validated = parseExploreFilters(
        serializeExploreFilters({
          q: "",
          activities: [],
          difficulties: [],
          minDistanceKm: null,
          maxDistanceKm: null,
          maxElevationRangeMeters: null,
          visibility: "all",
          page: 1,
          drawing,
        }),
      ).drawing!;
      onDrawing?.(validated);
      setPlacement(null);
      setInvalidDrawing(false);
    } catch {
      setInvalidDrawing(true);
    }
  };
  const shared = useTranslations("Tracks.map");
  const locale = useLocale();
  const drawing = spatial?.drawing;
  const drawingGeometry = useMemo(
    () => (drawing ? exploreDrawingGeometry(drawing) : null),
    [drawing],
  );
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
  useEffect(() => {
    if (
      loaded &&
      requestId !== undefined &&
      requestMode &&
      consumedRequest.current !== requestId
    ) {
      consumedRequest.current = requestId;
      setPlacement((current) =>
        current && current.mode !== requestMode
          ? { ...current, mode: requestMode }
          : { restoreKey, mode: requestMode, start: null },
      );
      setInvalidDrawing(false);
    }
  }, [requestId, requestMode, restoreKey, loaded]);

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
  const intentionalMovement = useRef(false);
  const spatialActive = !!(spatial?.viewport || spatial?.drawing);
  const spatialRef = useRef(spatial);
  useLayoutEffect(() => {
    spatialRef.current = spatial;
  }, [spatial]);
  useEffect(() => {
    if (!loaded) return;
    const saved = spatialRef.current;
    intentionalMovement.current = false;
    if (saved?.viewport) {
      const { west, south, east, north } = saved.viewport;
      map.current?.fitBounds(
        [
          [west, Math.max(-85.051129, Math.min(85.051129, south))],
          [
            east < west ? east + 360 : east,
            Math.max(-85.051129, Math.min(85.051129, north)),
          ],
        ],
        { padding: 0, duration: 0 },
      );
    } else if (saved?.drawing) {
      map.current?.fitBounds(exploreDrawingGeometry(saved.drawing).bounds, {
        padding: 64,
        maxZoom: 16,
        duration: 0,
      });
    }
  }, [loaded, restoreKey]);
  const reportViewport = (intentional: boolean) => {
    const bounds = map.current?.getBounds();
    if (!bounds) return;
    const round = (v: number) => Math.round(v * 1e6) / 1e6;
    const normalize = (v: number) => round(normalizeLongitude(v));
    const world = bounds.getEast() - bounds.getWest() >= 360;
    const viewport = {
      west: world ? -180 : normalize(bounds.getWest()),
      east: world ? 180 : normalize(bounds.getEast()),
      south: round(Math.max(-90, bounds.getSouth())),
      north: round(Math.min(90, bounds.getNorth())),
    };
    if (viewport.west !== viewport.east && viewport.south < viewport.north)
      onViewport?.(viewport, intentional);
  };
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
    if (loaded && !manualCamera.current && !spatialActive) fit();
  }, [fit, loaded, spatialActive]);

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
      setPlacement(null);
      setInvalidDrawing(false);
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
        doubleClickZoom={!placement}
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
          if (event.originalEvent) {
            manualCamera.current = true;
            intentionalMovement.current = true;
          }
        }}
        onMoveEnd={() => {
          reportViewport(intentionalMovement.current);
          intentionalMovement.current = false;
        }}
        onClick={(event) => {
          if (placement) {
            place([event.lngLat.lng, event.lngLat.lat]);
            return;
          }
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
          reportViewport(false);
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
        {drawingGeometry && (
          <>
            <Source
              id="explore-spatial-corridor"
              type="geojson"
              data={{
                type: "Feature",
                properties: {},
                geometry: {
                  type: "Polygon",
                  coordinates: [drawingGeometry.corridor],
                },
              }}
            >
              <Layer
                id="explore-spatial-fill"
                type="fill"
                paint={{
                  "fill-color": resolveColor("var(--recorded-path)"),
                  "fill-opacity": 0.18,
                }}
              />
              <Layer
                id="explore-spatial-border"
                type="line"
                paint={{
                  "line-color": resolveColor("var(--recorded-path)"),
                  "line-width": 2,
                }}
              />
            </Source>
            <Source
              id="explore-spatial-drawing"
              type="geojson"
              data={{
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: drawingGeometry.line,
                },
              }}
            >
              <Layer
                id="explore-spatial-line"
                type="line"
                paint={{ "line-color": outline, "line-width": 7 }}
              />
              <Layer
                id="explore-spatial-center"
                type="line"
                paint={{
                  "line-color": resolveColor("var(--recorded-path)"),
                  "line-width": 3,
                }}
              />
            </Source>
            {[
              drawingGeometry.line[0],
              drawingGeometry.line[drawingGeometry.line.length - 1],
            ].map((position, i) => (
              <Marker
                key={i}
                longitude={position[0]}
                latitude={position[1]}
                ref={(marker) => {
                  if (!marker) return;
                  const element = marker.getElement();
                  element.setAttribute("role", "img");
                  element.setAttribute(
                    "aria-label",
                    spatialText(i ? "drawingEnd" : "drawingStart"),
                  );
                  element.removeAttribute("tabindex");
                }}
              >
                <span
                  aria-hidden="true"
                  className="rounded-full border-2 border-primary bg-background px-2 py-1 text-xs font-bold text-foreground"
                >
                  {i ? "B" : "A"}
                  {i === 1 && drawing?.mode === "arrow" && (
                    <ArrowUpIcon
                      aria-hidden="true"
                      className="inline size-5"
                      style={{
                        transform: `rotate(${drawingGeometry.finalAzimuth}deg)`,
                      }}
                    />
                  )}
                </span>
              </Marker>
            ))}
          </>
        )}
        {placement?.start && (
          <Marker
            ref={(marker) => {
              if (!marker) return;
              const element = marker.getElement();
              element.setAttribute("aria-hidden", "true");
              element.removeAttribute("role");
              element.removeAttribute("aria-label");
              element.removeAttribute("tabindex");
            }}
            longitude={placement.start[0]}
            latitude={Math.max(
              -85.051129,
              Math.min(85.051129, placement.start[1]),
            )}
          >
            <span
              aria-hidden="true"
              className="rounded-full border-2 bg-background px-2 text-foreground"
            >
              A
            </span>
          </Marker>
        )}
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
                  disabled={!!placement}
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
      {placement && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-background/70 p-2 text-xl"
          >
            <CrosshairIcon className="size-6" aria-hidden="true" />
          </span>
          <div className="absolute bottom-24 left-2 right-16 rounded-md bg-background p-2 text-sm shadow">
            <p role="status">
              {spatialText(
                placement.start ? "endInstruction" : "startInstruction",
              )}
            </p>
            {invalidDrawing && (
              <p role="alert" className="text-destructive">
                {spatialText("invalidDrawing")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                disabled={!loaded}
                onClick={() => {
                  const center = map.current?.getCenter();
                  if (center) place([center.lng, center.lat]);
                }}
              >
                {spatialText(placement.start ? "setEnd" : "setStart")}
              </Button>
              <Button
                className="min-h-11"
                variant="outline"
                onClick={() => {
                  setPlacement(null);
                  setInvalidDrawing(false);
                }}
              >
                {spatialText("cancel")}
              </Button>
            </div>
          </div>
        </>
      )}
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
            intentionalMovement.current = true;
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
            intentionalMovement.current = true;
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
            intentionalMovement.current = true;
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
      {(page.polar || drawingGeometry?.polar) && (
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

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
import { useBasemap, isBasemap } from "./use-basemap";
import { createOutdoorStyle } from "@/tracks/outdoor-style";
import { topographicStyle } from "@/tracks/topographic-style";
import { createSatelliteStyle } from "@/tracks/satellite-style";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { ArrowsOutIcon } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { ArrowsInIcon } from "@phosphor-icons/react/dist/csr/ArrowsIn";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { Button } from "./ui/button";
import { MapFailure, MapLoading } from "./track-map-feedback";
import "maplibre-gl/dist/maplibre-gl.css";
import "./track-map.css";

import type { TrackMultiLineString as Geometry } from "@/tracks/geometry";
import {
  prepareExplorePaths,
  prepareTrackEndpoints,
  readTrackGeometry,
} from "@/tracks/explore-map";

export default function TrackMapRenderer({ id }: { id: string }) {
  const t = useTranslations("Tracks.map");
  const locale = useLocale();
  const outdoorStyle = useMemo(() => createOutdoorStyle(locale), [locale]);
  const darkStyle = useMemo(() => createOutdoorStyle(locale, "dark"), [locale]);
  const satelliteStyle = useMemo(
    () =>
      createSatelliteStyle(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? ""),
    [],
  );
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [basemap, setBasemap] = useBasemap();
  const [switching, setSwitching] = useState(false);
  const [basemapFailed, setBasemapFailed] = useState(false);

  const [previousBasemap, setPreviousBasemap] = useState(basemap);
  if (previousBasemap !== basemap) {
    setPreviousBasemap(basemap);
    setSwitching(loaded);
    setBasemapFailed(false);
  }
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapRef>(null);
  const contextCanvas = useRef<HTMLCanvasElement | null>(null);
  const contextLost = useCallback(() => setFailed(true), []);
  useLayoutEffect(
    () => () => {
      contextCanvas.current?.removeEventListener(
        "webglcontextlost",
        contextLost,
      );
      // Activity retains hidden routes. Clear private snapshots synchronously;
      // the request effect reauthorizes when this route becomes visible again.
      setGeometry(null);
      setLoaded(false);
      setFailed(false);
      setSwitching(false);
      setBasemapFailed(false);
    },
    [contextLost],
  );
  const path = useMemo(() => {
    if (!geometry) return null;
    const page = prepareExplorePaths([{ id, geometry }]);
    return { ...page, geometry: page.paths[0].geometry, bounds: page.bounds! };
  }, [geometry, id]);
  // MapLibre needs concrete CSS colors, not var() expressions. These shared
  // basemap-overlay tokens deliberately remain constant across UI themes.
  const colors = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      path: style.getPropertyValue("--recorded-path").trim(),
      outline: style.getPropertyValue("--recorded-path-outline").trim(),
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    fetch(`/api/tracks/${id}/data`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw Error("Map unavailable");
        return response.json();
      })
      .then((data) => {
        if (!disposed) setGeometry(readTrackGeometry(data));
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      })
      .finally(() => clearTimeout(timeout));
    let disposed = false;
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [id]);

  useEffect(() => {
    if (!path || loaded || failed) return;
    const timeout = setTimeout(() => setFailed(true), 25_000);
    return () => clearTimeout(timeout);
  }, [path, loaded, failed]);

  useEffect(() => {
    if (!switching) return;
    const timeout = setTimeout(() => {
      setSwitching(false);
      if (basemap !== "street") setBasemapFailed(true);
      else setFailed(true);
    }, 25_000);
    return () => clearTimeout(timeout);
  }, [basemap, switching]);

  useEffect(() => {
    const change = () =>
      setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  const fit = useCallback(() => {
    if (path)
      map.current?.fitBounds(path.bounds, {
        padding: 64,
        maxZoom: 16,
        duration: 0,
      });
  }, [path]);

  if (failed) return <MapFailure />;
  if (!path) return <MapLoading />;
  const singleSegment = path.geometry.coordinates.length === 1;
  // Bypass cooperation only while a wheel event reaches MapLibre. Restoring
  // it on bubble keeps the two-finger touch guard, including hybrid devices.
  return (
    <div
      ref={container}
      className="track-map relative h-[28rem] w-full overflow-hidden rounded-md border bg-background"
      aria-busy={!loaded || switching}
      onWheelCapture={() => map.current?.getMap().cooperativeGestures.disable()}
      onWheel={() => map.current?.getMap().cooperativeGestures.enable()}
    >
      <label className="absolute top-2 left-2 z-10 max-w-[calc(100%-5rem)] rounded-md bg-background p-2 text-sm shadow">
        <span className="sr-only">{t("basemap")}</span>
        <select
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          value={basemap}
          disabled={!loaded}
          onChange={(event) => {
            const next = event.target.value;
            if (!isBasemap(next)) return;
            setBasemapFailed(false);
            setSwitching(true);
            setBasemap(next);
          }}
        >
          <option value="street">{t("street")}</option>
          <option value="outdoor">{t("outdoor")}</option>
          <option value="dark">{t("dark")}</option>
          <option value="topographic">{t("topographic")}</option>
          {process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN && (
            <option value="satellite">{t("satellite")}</option>
          )}
        </select>
      </label>
      {(!loaded || switching) && (
        <p
          role="status"
          className="absolute top-28 left-2 z-10 bg-background p-2"
        >
          {t("loading")}
        </p>
      )}
      <Map
        ref={map}
        initialViewState={{
          bounds: path.bounds,
          fitBoundsOptions: { padding: 64, maxZoom: 16 },
        }}
        mapStyle={
          basemap === "dark"
            ? darkStyle
            : basemap === "outdoor"
              ? outdoorStyle
              : basemap === "topographic"
                ? topographicStyle
                : basemap === "satellite"
                  ? satelliteStyle
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
          "Map.Title": t("canvas"),
          "CooperativeGesturesHandler.WindowsHelpText": t("gesture"),
          "CooperativeGesturesHandler.MacHelpText": t("gesture"),
          "CooperativeGesturesHandler.MobileHelpText": t("gesture"),
        }}
        onLoad={() => {
          map.current?.getMap().touchZoomRotate.disableRotation();
          map.current?.getMap().keyboard.disableRotation();
          contextCanvas.current = map.current?.getCanvas() ?? null;
          contextCanvas.current?.addEventListener(
            "webglcontextlost",
            contextLost,
          );
          fit();
          setLoaded(true);
        }}
        onIdle={() => {
          if (switching) setSwitching(false);
        }}
        onError={(event) => {
          // Ignore late errors from an optional basemap that is no longer active.
          const sourceId = "sourceId" in event ? event.sourceId : undefined;
          if (
            (sourceId === "dark" ||
              sourceId === "outdoor" ||
              sourceId === "topographic" ||
              sourceId === "satellite") &&
            sourceId !== basemap
          )
            return;
          if (basemap !== "street" && sourceId !== "recorded-path") {
            setBasemapFailed(true);
            setSwitching(false);
          } else setFailed(true);
        }}
      >
        <Source
          id="recorded-path"
          type="geojson"
          data={{ type: "Feature", properties: {}, geometry: path.geometry }}
          tolerance={0}
        >
          <Layer
            id="recorded-path-outline"
            type="line"
            paint={{ "line-color": colors.outline, "line-width": 7 }}
          />
          <Layer
            id="recorded-path-line"
            type="line"
            paint={{ "line-color": colors.path, "line-width": 4 }}
          />
        </Source>
        {prepareTrackEndpoints(geometry!, path.geometry).map(
          ({ position, endpoints }) => {
            const labels = endpoints.map(({ segment, kind }) =>
              singleSegment
                ? t(kind)
                : t("segmentEndpoint", { segment, endpoint: t(kind) }),
            );
            const badge = (
              <span
                aria-hidden="true"
                className={`rounded-full border-2 border-background bg-primary px-1.5 text-xs font-semibold text-primary-foreground shadow ${endpoints.every((endpoint) => endpoint.kind === "end") ? "border-dashed" : ""}`}
              >
                {singleSegment ? t(endpoints[0].kind) : endpoints[0].segment}
                {!singleSegment && endpoints.length > 1 ? "+" : ""}
              </span>
            );
            return (
              <Marker
                key={position.join(",")}
                longitude={position[0]}
                latitude={position[1]}
                anchor="bottom"
                className="has-[details[open]]:z-10"
              >
                {singleSegment ? (
                  <div
                    role="img"
                    aria-label={labels.join("; ")}
                    className="flex size-11 items-center justify-center"
                  >
                    {badge}
                  </div>
                ) : (
                  <details
                    name={`track-endpoints-${id}`}
                    className="relative"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.currentTarget.open = false;
                        event.currentTarget.querySelector("summary")?.focus();
                      }
                    }}
                  >
                    <summary
                      aria-label={labels.join("; ")}
                      className="flex size-11 cursor-pointer list-none items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
                    >
                      {badge}
                    </summary>
                    <ul
                      className="absolute bottom-full left-1/2 z-10 max-h-48 w-max max-w-52 -translate-x-1/2 overflow-y-auto rounded-md bg-background px-2 py-1 text-xs text-foreground shadow"
                      tabIndex={0}
                    >
                      {labels.map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </Marker>
            );
          },
        )}
        <AttributionControl compact={false} />
      </Map>
      <div
        className="absolute top-2 right-2 flex flex-col gap-1 rounded-md bg-background p-1 shadow"
        role="group"
        aria-label={t("controls")}
      >
        <Button
          size="icon"
          variant="outline"
          className="size-11"
          aria-label={t("zoomIn")}
          onClick={() => map.current?.zoomIn({ duration: 0 })}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="size-11"
          aria-label={t("zoomOut")}
          onClick={() => map.current?.zoomOut({ duration: 0 })}
        >
          <MinusIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="size-11"
          aria-label={t("fit")}
          onClick={fit}
        >
          <CrosshairIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="size-11"
          aria-label={fullscreen ? t("exitFullscreen") : t("fullscreen")}
          onClick={async () => {
            try {
              if (document.fullscreenElement) await document.exitFullscreen();
              else await container.current?.requestFullscreen();
            } catch {
              /* Unsupported fullscreen does not disable the map. */
            }
          }}
        >
          {fullscreen ? (
            <ArrowsInIcon aria-hidden="true" />
          ) : (
            <ArrowsOutIcon aria-hidden="true" />
          )}
        </Button>
      </div>
      {basemapFailed && basemap !== "street" && (
        <p
          role="alert"
          className="absolute top-28 left-2 z-10 max-w-[calc(100%-5rem)] rounded-md bg-background p-2 text-sm shadow"
        >
          {t(
            basemap === "dark"
              ? "darkFailure"
              : basemap === "topographic"
                ? "topographicFailure"
                : basemap === "satellite"
                  ? "satelliteFailure"
                  : "outdoorFailure",
          )}
        </p>
      )}
      {path.polar && (
        <p className="absolute bottom-10 left-2 max-w-[70%] bg-background p-2 text-xs">
          {t("polar")}
        </p>
      )}
    </div>
  );
}

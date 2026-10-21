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
import { useTranslations } from "next-intl";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { ArrowsOutIcon } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { ArrowsInIcon } from "@phosphor-icons/react/dist/csr/ArrowsIn";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { Button } from "./ui/button";
import { MapFailure, MapLoading } from "./track-map-feedback";
import "maplibre-gl/dist/maplibre-gl.css";
import "./track-map.css";

type Geometry = { type: "LineString"; coordinates: [number, number][] };

function readGeometry(data: unknown): Geometry {
  const geometry = (data as { geometry?: Geometry } | null)?.geometry;
  if (
    geometry?.type !== "LineString" ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 2 ||
    geometry.coordinates.length > 100_000 ||
    geometry.coordinates.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1]) ||
        Math.abs(point[0]) > 180 ||
        Math.abs(point[1]) > 90,
    )
  )
    throw Error("Invalid geometry");
  return geometry;
}

// Display-only world wrapping: retain every position/order/repetition, but
// choose each longitude's nearest world copy to avoid a line across the globe.
function mapPath(geometry: Geometry) {
  let previous = geometry.coordinates[0][0];
  let west = previous,
    east = previous,
    south = 90,
    north = -90;
  const coordinates = geometry.coordinates.map(
    ([lon, lat]): [number, number] => {
      const longitude = lon + 360 * Math.round((previous - lon) / 360);
      previous = longitude;
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      return [longitude, lat];
    },
  );
  // Mercator cannot display the poles; do not mutate source latitude values.
  const clamp = (lat: number) => Math.max(-85.051129, Math.min(85.051129, lat));
  return {
    geometry: { type: "LineString" as const, coordinates },
    bounds: [
      [west, clamp(south)],
      [east, clamp(north)],
    ] as [[number, number], [number, number]],
    polar: south < -85.051129 || north > 85.051129,
  };
}

export default function TrackMapRenderer({ id }: { id: string }) {
  const t = useTranslations("Tracks.map");
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
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
    },
    [contextLost],
  );
  const path = useMemo(() => (geometry ? mapPath(geometry) : null), [geometry]);
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
        if (!disposed) setGeometry(readGeometry(data));
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
  const first = path.geometry.coordinates[0];
  const last = path.geometry.coordinates.at(-1)!;
  const loop =
    geometry!.coordinates[0][0] === geometry!.coordinates.at(-1)![0] &&
    first[1] === last[1];
  const markerClass =
    "rounded-md border-2 border-background bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground shadow";
  // Bypass cooperation only while a wheel event reaches MapLibre. Restoring
  // it on bubble keeps the two-finger touch guard, including hybrid devices.
  return (
    <div
      ref={container}
      className="track-map relative h-[28rem] w-full overflow-hidden rounded-md border bg-background"
      aria-busy={!loaded}
      onWheelCapture={() => map.current?.getMap().cooperativeGestures.disable()}
      onWheel={() => map.current?.getMap().cooperativeGestures.enable()}
    >
      {!loaded && (
        <p
          role="status"
          className="absolute top-2 left-2 z-10 bg-background p-2"
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
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
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
        onError={() => setFailed(true)}
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
        <Marker longitude={first[0]} latitude={first[1]} anchor="bottom">
          <span className={markerClass}>
            {loop ? t("startEnd") : t("start")}
          </span>
        </Marker>
        {!loop && (
          <Marker longitude={last[0]} latitude={last[1]} anchor="top">
            <span className={`${markerClass} border-dashed`}>{t("end")}</span>
          </Marker>
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
      {path.polar && (
        <p className="absolute bottom-10 left-2 max-w-[70%] bg-background p-2 text-xs">
          {t("polar")}
        </p>
      )}
    </div>
  );
}

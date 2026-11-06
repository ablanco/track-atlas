"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Marker } from "react-map-gl/maplibre";
import { useTranslations } from "next-intl";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type {
  TrackWaypoint,
  TrackPosition,
  TrackMultiLineString,
} from "@/tracks/geometry";
import { prepareTrackEndpoints } from "@/tracks/explore-map";
import { Button } from "./ui/button";

type Endpoints = ReturnType<typeof prepareTrackEndpoints>;
// Source coordinates already lie in [-180, 180]. Avoid modulo arithmetic here:
// adding 180/360 would round distinct microscopic source positions together.
const longitude = (lon: number) => (lon === 180 ? -180 : lon);
const positionKey = ([lon, lat]: TrackPosition) =>
  `${Math.abs(lat) === 90 ? 0 : longitude(lon)},${lat}`;
function endpointPosition(
  original: TrackMultiLineString,
  endpoint: Endpoints[number]["endpoints"][number],
) {
  const part = original.coordinates[endpoint.segment - 1];
  return endpoint.kind === "end" ? part.at(-1)! : part[0];
}
const markerPageSize = 100;
const popupPageSize = 50;

export function TrackWaypoints({
  waypoints,
  endpoints,
  original,
  referenceLongitude,
  singleSegment,
  children,
}: {
  waypoints: TrackWaypoint[];
  endpoints: Endpoints;
  original: TrackMultiLineString;
  referenceLongitude: number;
  singleSegment: boolean;
  children: (endpoints: Endpoints) => React.ReactNode;
}) {
  const t = useTranslations("Tracks.map");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [popupPage, setPopupPage] = useState(0);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const popup = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!selected) return;
    popup.current?.querySelector("button")?.focus({ preventScroll: true });
    const dismiss = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !popup.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      ) {
        setSelected(null);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("click", dismiss);
    return () => document.removeEventListener("click", dismiss);
  }, [selected]);
  const groups = useMemo(() => {
    const grouped = new globalThis.Map<
      string,
      {
        key: string;
        position: TrackPosition;
        waypoints: TrackWaypoint[];
        endpoints: Endpoints[number]["endpoints"];
      }
    >();
    for (const waypoint of waypoints) {
      const key = positionKey(waypoint.position);
      let group = grouped.get(key);
      if (!group) {
        const lon = longitude(waypoint.position[0]);
        group = {
          key,
          position: [
            lon + 360 * Math.round((referenceLongitude - lon) / 360),
            waypoint.position[1],
          ],
          waypoints: [],
          endpoints: [],
        };
        grouped.set(key, group);
      }
      group.waypoints.push(waypoint);
    }
    for (const endpoint of endpoints)
      for (const item of endpoint.endpoints)
        grouped
          .get(positionKey(endpointPosition(original, item)))
          ?.endpoints.push(item);
    return [...grouped.values()];
  }, [waypoints, endpoints, original, referenceLongitude]);
  const visible = groups.slice(
    page * markerPageSize,
    (page + 1) * markerPageSize,
  );
  const visibleKeys = new Set(visible.map((group) => group.key));
  const current = selected
    ? visible.find((group) => group.key === selected)
    : undefined;
  const close = () => {
    setSelected(null);
    trigger.current?.focus({ preventScroll: true });
  };
  const endpointLabels = (items: Endpoints[number]["endpoints"]) =>
    items.map(({ segment, kind }) =>
      singleSegment
        ? t(kind)
        : t("segmentEndpoint", { segment, endpoint: t(kind) }),
    );
  return (
    <>
      {children(
        endpoints.flatMap((endpoint) => {
          const remaining = endpoint.endpoints.filter(
            (item) =>
              !visibleKeys.has(positionKey(endpointPosition(original, item))),
          );
          return remaining.length
            ? [{ ...endpoint, endpoints: remaining }]
            : [];
        }),
      )}
      {visible.map((group) => (
        <Marker
          key={group.key}
          longitude={group.position[0]}
          latitude={group.position[1]}
          anchor="bottom"
        >
          <button
            type="button"
            data-waypoint-marker
            aria-label={[
              t("waypointCount", { count: group.waypoints.length }),
              ...endpointLabels(group.endpoints),
              group.waypoints[0].name || t("waypoint"),
            ].join("; ")}
            aria-haspopup="dialog"
            aria-expanded={selected === group.key}
            className="flex size-11 cursor-pointer items-center justify-center rounded-md text-primary drop-shadow focus-visible:outline-2 focus-visible:outline-ring"
            onClick={(event) => {
              event.stopPropagation();
              trigger.current = event.currentTarget;
              setPopupPage(0);
              setSelected(group.key);
            }}
          >
            <MapPinIcon
              size={32}
              weight="regular"
              aria-hidden="true"
              className="rounded-full bg-background"
            />
          </button>
        </Marker>
      ))}
      {current && (
        <div
          ref={popup}
          role="dialog"
          aria-modal="false"
          aria-label={t("waypoints")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
          className="absolute bottom-12 left-2 z-20 max-h-64 w-72 max-w-[calc(100%-1rem)] overflow-y-auto rounded-md border bg-popover p-2 text-sm text-popover-foreground shadow"
        >
          <div className="flex items-center justify-between gap-2">
            <strong>{t("waypoints")}</strong>
            <Button
              size="icon"
              variant="ghost"
              className="size-11 shrink-0"
              aria-label={t("closeWaypoints")}
              onClick={close}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
          {current.endpoints.length > 0 && (
            <ul className="mb-2 border-b pb-2">
              {endpointLabels(current.endpoints).map((label, index) => (
                <li key={index}>{label}</li>
              ))}
            </ul>
          )}
          <ol start={popupPage * popupPageSize + 1} className="space-y-3">
            {current.waypoints
              .slice(popupPage * popupPageSize, (popupPage + 1) * popupPageSize)
              .map((waypoint, index) => (
                <li key={index} className="whitespace-pre-wrap wrap-anywhere">
                  <p className="font-semibold">
                    {waypoint.name || t("waypoint")}
                  </p>
                  {waypoint.description && <p>{waypoint.description}</p>}
                </li>
              ))}
          </ol>
          {current.waypoints.length > popupPageSize && (
            <WaypointPages
              page={popupPage}
              size={popupPageSize}
              total={current.waypoints.length}
              change={setPopupPage}
            />
          )}
        </div>
      )}
      {groups.length > markerPageSize && (
        <div className="absolute bottom-12 left-2 z-10 max-w-[calc(100%-1rem)] rounded-md bg-background p-2 text-foreground shadow">
          <WaypointPages
            page={page}
            size={markerPageSize}
            total={groups.length}
            change={(next) => {
              setSelected(null);
              setPage(next);
            }}
          />
        </div>
      )}
    </>
  );
}

function WaypointPages({
  page,
  size,
  total,
  change,
}: {
  page: number;
  size: number;
  total: number;
  change: (page: number) => void;
}) {
  const t = useTranslations("Tracks.map");
  return (
    <div
      role="group"
      aria-label={t("waypointPages")}
      className="flex flex-wrap items-center gap-1 text-xs"
    >
      <span aria-live="polite">
        {t("waypointRange", {
          first: page * size + 1,
          last: Math.min((page + 1) * size, total),
          total,
        })}
      </span>
      <Button
        variant="outline"
        className="min-h-11"
        disabled={page === 0}
        onClick={() => change(page - 1)}
      >
        {t("previousWaypoints")}
      </Button>
      <Button
        variant="outline"
        className="min-h-11"
        disabled={(page + 1) * size >= total}
        onClick={() => change(page + 1)}
      >
        {t("nextWaypoints")}
      </Button>
    </div>
  );
}

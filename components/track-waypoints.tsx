"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Marker } from "react-map-gl/maplibre";
import { useTranslations } from "next-intl";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { DropIcon } from "@phosphor-icons/react/dist/csr/Drop";
import { TentIcon } from "@phosphor-icons/react/dist/csr/Tent";
import { BinocularsIcon } from "@phosphor-icons/react/dist/csr/Binoculars";
import { CarIcon } from "@phosphor-icons/react/dist/csr/Car";
import { ForkKnifeIcon } from "@phosphor-icons/react/dist/csr/ForkKnife";
import { BedIcon } from "@phosphor-icons/react/dist/csr/Bed";
import { MountainsIcon } from "@phosphor-icons/react/dist/csr/Mountains";
import { ToiletIcon } from "@phosphor-icons/react/dist/csr/Toilet";
import { ShowerIcon } from "@phosphor-icons/react/dist/csr/Shower";
import { PicnicTableIcon } from "@phosphor-icons/react/dist/csr/PicnicTable";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { ProhibitIcon } from "@phosphor-icons/react/dist/csr/Prohibit";
import { WavesIcon } from "@phosphor-icons/react/dist/csr/Waves";
import { FirstAidIcon } from "@phosphor-icons/react/dist/csr/FirstAid";
import { StorefrontIcon } from "@phosphor-icons/react/dist/csr/Storefront";
import { GasPumpIcon } from "@phosphor-icons/react/dist/csr/GasPump";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import { TreeIcon } from "@phosphor-icons/react/dist/csr/Tree";
import { ParkIcon } from "@phosphor-icons/react/dist/csr/Park";
import { UmbrellaIcon } from "@phosphor-icons/react/dist/csr/Umbrella";
import { BridgeIcon } from "@phosphor-icons/react/dist/csr/Bridge";
import { BicycleIcon } from "@phosphor-icons/react/dist/csr/Bicycle";
import { PhoneIcon } from "@phosphor-icons/react/dist/csr/Phone";
import { AnchorIcon } from "@phosphor-icons/react/dist/csr/Anchor";
import { BankIcon } from "@phosphor-icons/react/dist/csr/Bank";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { CarProfileIcon } from "@phosphor-icons/react/dist/csr/CarProfile";
import { IntersectionIcon } from "@phosphor-icons/react/dist/csr/Intersection";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { BusIcon } from "@phosphor-icons/react/dist/csr/Bus";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { RoadHorizonIcon } from "@phosphor-icons/react/dist/csr/RoadHorizon";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { HouseLineIcon } from "@phosphor-icons/react/dist/csr/HouseLine";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type {
  TrackWaypoint,
  WaypointCategory,
  TrackPosition,
  TrackMultiLineString,
} from "@/tracks/geometry";
import { prepareTrackEndpoints } from "@/tracks/explore-map";
import { Button } from "./ui/button";

function WaypointIcon({
  category,
  size,
}: {
  category: WaypointCategory;
  size: number;
}) {
  const icons = {
    generic: MapPinIcon,
    drinkingWater: DropIcon,
    shelter: HouseLineIcon,
    viewpoint: BinocularsIcon,
    parking: CarIcon,
    food: ForkKnifeIcon,
    accommodation: BedIcon,
    campsite: TentIcon,
    summit: MountainsIcon,
    toilets: ToiletIcon,
    shower: ShowerIcon,
    picnicArea: PicnicTableIcon,
    information: InfoIcon,
    warning: WarningIcon,
    restrictedArea: ProhibitIcon,
    waterSource: WavesIcon,
    pharmacy: FirstAidIcon,
    supplies: StorefrontIcon,
    fuel: GasPumpIcon,
    vehicleRepair: WrenchIcon,
    forest: TreeIcon,
    park: ParkIcon,
    beach: UmbrellaIcon,
    bridge: BridgeIcon,
    cyclingTrail: BicycleIcon,
    telephone: PhoneIcon,
    anchorage: AnchorIcon,
    bank: BankIcon,
    building: BuildingsIcon,
    car: CarProfileIcon,
    crossing: IntersectionIcon,
    exit: SignOutIcon,
    transport: BusIcon,
    house: HouseIcon,
    road: RoadHorizonIcon,
    tunnel: DoorOpenIcon,
  } satisfies Record<WaypointCategory, typeof MapPinIcon>;
  const Icon = Object.hasOwn(icons, category) ? icons[category] : MapPinIcon;
  return (
    <Icon
      size={size}
      weight="regular"
      aria-hidden="true"
      data-poi-category={Object.hasOwn(icons, category) ? category : "generic"}
      className="shrink-0 rounded-full bg-background"
    />
  );
}

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
            <WaypointIcon
              size={32}
              category={
                group.waypoints.every(
                  (waypoint) =>
                    waypoint.category === group.waypoints[0].category,
                )
                  ? group.waypoints[0].category
                  : "generic"
              }
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
                  <p className="flex items-center gap-2">
                    <WaypointIcon category={waypoint.category} size={20} />
                    {t(`categories.${waypoint.category}`)}
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

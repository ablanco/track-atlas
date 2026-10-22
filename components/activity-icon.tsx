"use client";

import { WavesIcon } from "@phosphor-icons/react/dist/csr/Waves";
import { CompassIcon } from "@phosphor-icons/react/dist/csr/Compass";
import { FootprintsIcon } from "@phosphor-icons/react/dist/csr/Footprints";
import { HorseIcon } from "@phosphor-icons/react/dist/csr/Horse";
import { JeepIcon } from "@phosphor-icons/react/dist/csr/Jeep";
import { MotorcycleIcon } from "@phosphor-icons/react/dist/csr/Motorcycle";
import { MountainsIcon } from "@phosphor-icons/react/dist/csr/Mountains";
import { PersonSimpleBikeIcon } from "@phosphor-icons/react/dist/csr/PersonSimpleBike";
import { PersonSimpleHikeIcon } from "@phosphor-icons/react/dist/csr/PersonSimpleHike";
import { PersonSimpleRunIcon } from "@phosphor-icons/react/dist/csr/PersonSimpleRun";
import { PersonSimpleSkiIcon } from "@phosphor-icons/react/dist/csr/PersonSimpleSki";
import { PersonSimpleWalkIcon } from "@phosphor-icons/react/dist/csr/PersonSimpleWalk";
import { SnowflakeIcon } from "@phosphor-icons/react/dist/csr/Snowflake";
import { TireIcon } from "@phosphor-icons/react/dist/csr/Tire";
import type { ActivityType } from "@/tracks/validation";

const icons: Record<
  ActivityType,
  { icon: typeof PersonSimpleWalkIcon; badge?: typeof MountainsIcon }
> = {
  walking: { icon: PersonSimpleWalkIcon },
  hiking: { icon: PersonSimpleHikeIcon },
  road_running: { icon: PersonSimpleRunIcon },
  trail_running: { icon: PersonSimpleRunIcon, badge: MountainsIcon },
  cycling: { icon: PersonSimpleBikeIcon },
  mountain_biking: { icon: PersonSimpleBikeIcon, badge: MountainsIcon },
  ski_touring: { icon: PersonSimpleSkiIcon, badge: MountainsIcon },
  cross_country_skiing: { icon: PersonSimpleSkiIcon },
  snowshoeing: { icon: FootprintsIcon, badge: SnowflakeIcon },
  paddling: { icon: WavesIcon },
  horse_riding: { icon: HorseIcon },
  four_by_four: { icon: JeepIcon },
  road_motorcycling: { icon: MotorcycleIcon },
  off_road_motorcycling: { icon: MotorcycleIcon, badge: MountainsIcon },
  atv_quad: { icon: TireIcon },
  other: { icon: CompassIcon },
};

export function ActivityIcon({
  activity,
  size = "sm",
}: {
  activity: ActivityType;
  size?: "sm" | "lg";
}) {
  const { icon: Icon, badge: Badge } = icons[activity];
  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0">
      <Icon
        weight="regular"
        focusable="false"
        className={size === "lg" ? "size-8" : "size-5"}
      />
      {Badge && (
        <Badge
          weight="regular"
          focusable="false"
          className={
            size === "lg"
              ? "absolute -right-2 -bottom-1 size-4 rounded-sm bg-background"
              : "absolute -right-1 -bottom-0.5 size-2.5 rounded-sm bg-popover"
          }
        />
      )}
    </span>
  );
}

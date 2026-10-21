"use client";

import { Radio } from "@base-ui/react/radio";
import { useTranslations } from "next-intl";
import { WavesIcon } from "@phosphor-icons/react/dist/csr/Waves";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
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
import { RadioGroup } from "@/components/ui/radio-group";
import { activityTypes, type ActivityType } from "@/tracks/validation";

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

export function ActivityGrid({
  value,
  onValueChange,
  disabled,
  invalid,
}: {
  value: ActivityType | null;
  onValueChange: (value: ActivityType) => void;
  disabled: boolean;
  invalid: boolean;
}) {
  const t = useTranslations("Tracks");
  return (
    <RadioGroup
      id="track-activity"
      name="activity"
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      required
      aria-required="true"
      aria-invalid={invalid}
      aria-labelledby="track-activity-label"
      aria-describedby="track-activity-hint track-activity-error"
      className="grid-cols-2 auto-rows-fr sm:grid-cols-4"
    >
      {activityTypes.map((activity) => {
        const { icon: Icon, badge: Badge } = icons[activity];
        return (
          <Radio.Root
            key={activity}
            value={activity}
            aria-invalid={invalid}
            className="relative flex min-h-28 min-w-0 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-input px-3 py-4 text-center text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-accent data-checked:text-accent-foreground data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive"
          >
            <span aria-hidden="true" className="relative inline-flex shrink-0">
              <Icon size={32} weight="regular" />
              {Badge && (
                <Badge
                  size={16}
                  weight="regular"
                  className="absolute -right-2 -bottom-1 rounded-sm bg-background"
                />
              )}
            </span>
            <span className="break-words">{t(`activities.${activity}`)}</span>
            <Radio.Indicator
              className="absolute top-2 right-2"
              aria-hidden="true"
            >
              <CheckIcon size={14} weight="regular" />
            </Radio.Indicator>
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}

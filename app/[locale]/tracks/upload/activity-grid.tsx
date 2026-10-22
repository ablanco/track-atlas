"use client";

import { Radio } from "@base-ui/react/radio";
import { useTranslations } from "next-intl";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ActivityIcon } from "@/components/activity-icon";
import { RadioGroup } from "@/components/ui/radio-group";
import { activityTypes, type ActivityType } from "@/tracks/validation";

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
        return (
          <Radio.Root
            key={activity}
            value={activity}
            aria-invalid={invalid}
            className="relative flex min-h-28 min-w-0 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-input px-3 py-4 text-center text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-accent data-checked:text-accent-foreground data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive"
          >
            <ActivityIcon activity={activity} size="lg" />
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

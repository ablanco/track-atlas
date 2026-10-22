"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "cn";

function Slider({
  className,
  labels,
  value,
  defaultValue,
  ...props
}: SliderPrimitive.Root.Props<number[]> & { labels: string[] }) {
  const values = value ?? defaultValue ?? [0];
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center py-3 select-none data-disabled:opacity-50",
        className,
      )}
      value={value}
      defaultValue={defaultValue}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex h-5 w-full items-center">
        <SliderPrimitive.Track className="relative h-1.5 w-full rounded-full bg-muted">
          <SliderPrimitive.Indicator className="absolute h-full rounded-full bg-primary" />
          {values.map((_, index) => (
            <SliderPrimitive.Thumb
              key={index}
              index={index}
              aria-label={labels[index]}
              className="block size-4 rounded-full border border-primary bg-background shadow-sm outline-none focus-within:ring-3 focus-within:ring-ring/50"
            />
          ))}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
export { Slider };

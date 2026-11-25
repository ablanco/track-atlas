"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "./ui/button";

export function WeatherDays({
  days,
}: {
  days: { key: string; summary: ReactNode; details: ReactNode }[];
}) {
  const id = useId();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ul className="flex gap-2 overflow-x-auto p-1">
        {days.map((day) => (
          <li key={day.key} className="min-w-fit flex-1">
            <Button
              id={`${id}-${day.key}-button`}
              variant="outline"
              className="relative h-auto w-full justify-start gap-3 px-3 py-2.5 text-left"
              aria-expanded={selected === day.key}
              aria-controls={`${id}-${day.key}-details`}
              onClick={() => setSelected(selected === day.key ? null : day.key)}
            >
              {day.summary}
            </Button>
          </li>
        ))}
      </ul>
      {days.map((day) => (
        <div
          key={day.key}
          id={`${id}-${day.key}-details`}
          role="region"
          aria-labelledby={`${id}-${day.key}-button`}
          hidden={selected !== day.key}
        >
          {day.details}
        </div>
      ))}
    </div>
  );
}

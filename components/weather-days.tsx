"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { Button } from "./ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverClose,
} from "./ui/popover";

export function WeatherDays({
  days,
}: {
  days: {
    key: string;
    label: string;
    summary: ReactNode;
    details: ReactNode;
  }[];
}) {
  const t = useTranslations("Auth");
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ul className="grid w-full grid-cols-1 gap-2 p-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6">
      {days.map((day) => (
        <li key={day.key} className="min-w-0">
          <Popover
            open={selected === day.key}
            onOpenChange={(open) =>
              setSelected((current) =>
                open ? day.key : current === day.key ? null : current,
              )
            }
          >
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="relative h-auto w-full justify-start gap-3 px-3 py-2.5 text-left"
                />
              }
            >
              {day.summary}
            </PopoverTrigger>
            <PopoverContent className="w-[40rem]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <PopoverTitle className="font-semibold">
                  {day.label}
                </PopoverTitle>
                <PopoverClose render={<Button variant="ghost" size="icon" />}>
                  <XIcon aria-hidden="true" />
                  <span className="sr-only">{t("close")}</span>
                </PopoverClose>
              </div>
              {day.details}
            </PopoverContent>
          </Popover>
        </li>
      ))}
    </ul>
  );
}

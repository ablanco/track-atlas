"use client";

import { useId } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale, useTranslations } from "next-intl";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

export function AdminPagination({
  page,
  totalPages,
  totalRecords,
  hasNext = false,
  pageHref,
  pageSize,
  onPageSizeChange,
}: {
  page: number;
  totalPages?: number;
  totalRecords?: number;
  hasNext?: boolean;
  pageHref: (page: number) => string;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const t = useTranslations("Admin"),
    locale = useLocale();
  const pageSizeId = useId();
  const last = totalPages ?? page + Number(hasNext);
  const pages = Array.from(
    new Set([
      1,
      ...Array.from({ length: 3 }, (_, i) => page + i - 1),
      ...(totalPages === undefined ? [] : [totalPages]),
    ]),
  )
    .filter((value) => value >= 1 && value <= last)
    .sort((a, b) => a - b);
  const boundary = (disabled: boolean) => ({
    "aria-disabled": disabled || undefined,
    tabIndex: disabled ? -1 : undefined,
    className: disabled ? "pointer-events-none opacity-50" : undefined,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (disabled) event.preventDefault();
    },
  });

  return (
    <Pagination
      aria-label={t("paginationNavigation")}
      className="flex-col items-center gap-4 sm:flex-row sm:justify-between"
    >
      <Field orientation="horizontal" className="w-auto">
        <FieldLabel htmlFor={pageSizeId} className="whitespace-nowrap">
          {t("pageSize")}
        </FieldLabel>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            if (value) onPageSizeChange(Number(value));
          }}
        >
          <SelectTrigger id={pageSizeId} className="w-20" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[25, 50, 100].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {totalRecords !== undefined && (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {t("totalRecords", { total: totalRecords })}
          </span>
        )}
      </Field>
      <PaginationContent className="flex-wrap">
        <PaginationItem>
          <PaginationPrevious
            prefetch={false}
            href={pageHref(Math.max(1, page - 1))}
            text={t("previous")}
            {...boundary(page === 1)}
          />
        </PaginationItem>
        {pages.map((value, index) => (
          <PaginationItem key={value} className="flex items-center gap-1">
            {index > 0 && value - pages[index - 1] > 1 && (
              <PaginationEllipsis />
            )}
            <PaginationLink
              prefetch={false}
              href={pageHref(value)}
              isActive={page === value}
              aria-label={t("goToPage", { page: value })}
            >
              {new Intl.NumberFormat(locale).format(value)}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            prefetch={false}
            href={pageHref(Math.min(last, page + 1))}
            text={t("next")}
            {...boundary(page >= last)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

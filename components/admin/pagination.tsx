"use client";

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
  hasNext = false,
  pageHref,
}: {
  page: number;
  totalPages?: number;
  hasNext?: boolean;
  pageHref: (page: number) => string;
}) {
  const t = useTranslations("Admin"),
    locale = useLocale();
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
    <Pagination aria-label={t("paginationNavigation")}>
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

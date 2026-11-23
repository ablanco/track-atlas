"use client";
import { Fragment, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import type { FollowingPage } from "@/following/types";
import { usePrivateFollowing } from "./use-private-following";

export function FollowingOverview() {
  const query = useSearchParams();
  const page = Number(query.get("page") ?? 1);
  const current = Number.isSafeInteger(page) && page > 0 ? page : 1;
  return <FollowingList key={current} current={current} />;
}

function FollowingList({ current }: { current: number }) {
  const t = useTranslations("Following");
  const locale = useLocale();
  const router = useRouter();
  const resource = usePrivateFollowing<FollowingPage>(
    `/api/following?page=${current}`,
  );
  const { data, error, pending, loading } = resource;
  const pages = data
    ? [...new Set([1, data.page - 1, data.page, data.page + 1, data.pages])]
        .filter((page) => page >= 1 && page <= data.pages)
        .sort((a, b) => a - b)
    : [];
  const boundary = (disabled: boolean) => ({
    "aria-disabled": disabled || undefined,
    tabIndex: disabled ? -1 : undefined,
    className: disabled ? "pointer-events-none opacity-50" : undefined,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (disabled) event.preventDefault();
    },
  });
  useEffect(() => {
    if (data && data.page !== current)
      router.replace(`/following?page=${data.page}`);
  }, [data, current, router]);
  async function remove(id: string) {
    if (await resource.put(`/api/users/${id}/follow`, { following: false }))
      resource.reload();
  }
  return (
    <section
      aria-label={t("title")}
      aria-busy={loading || pending}
      className="space-y-5"
    >
      <p className="text-muted-foreground">
        {t("description")}{" "}
        <Link href="/settings" className="underline underline-offset-4">
          {t("settings")}
        </Link>
      </p>
      <p className="text-sm text-muted-foreground">{t("confirmation")}</p>
      {error && (
        <p role="alert" className="text-destructive">
          {t(error)}{" "}
          {error !== "unauthorized" && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={resource.reload}
            >
              {t("retry")}
            </Button>
          )}
        </p>
      )}
      {loading && <p role="status">{t("loading")}</p>}
      {data && (
        <>
          {data.items.length ? (
            <ul aria-label={t("title")} className="divide-y divide-border">
              {data.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 py-4"
                >
                  <Avatar aria-hidden="true">
                    <AvatarImage src={item.avatarUrl ?? undefined} alt="" />
                    <AvatarFallback>
                      {item.active
                        ? Array.from(item.displayName ?? "")[0]
                        : "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 break-words">
                    {item.collectionUrl ? (
                      <Link
                        href={item.collectionUrl}
                        prefetch={false}
                        className="font-medium underline underline-offset-4"
                      >
                        {item.displayName}
                      </Link>
                    ) : (
                      <span>{t("inactive")}</span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    disabled={pending || loading}
                    onClick={() => void remove(item.id)}
                  >
                    {t(pending ? "pending" : "unfollow")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("empty")}</p>
          )}
          <Pagination aria-label={t("pagination")}>
            <PaginationContent className="flex-wrap justify-center">
              <PaginationItem>
                <PaginationPrevious
                  text={t("previous")}
                  href={`/following?page=${Math.max(1, data.page - 1)}`}
                  prefetch={false}
                  {...boundary(pending || loading || data.page <= 1)}
                />
              </PaginationItem>
              {pages.map((page, index) => (
                <Fragment key={page}>
                  {index > 0 && page > pages[index - 1] + 1 && (
                    <PaginationItem>
                      <PaginationEllipsis />
                    </PaginationItem>
                  )}
                  <PaginationItem>
                    <PaginationLink
                      href={`/following?page=${page}`}
                      isActive={page === data.page}
                      aria-label={t("page", {
                        page: new Intl.NumberFormat(locale).format(page),
                        pages: new Intl.NumberFormat(locale).format(data.pages),
                      })}
                      prefetch={false}
                      {...boundary(pending || loading)}
                    >
                      {new Intl.NumberFormat(locale).format(page)}
                    </PaginationLink>
                  </PaginationItem>
                </Fragment>
              ))}
              <PaginationItem>
                <PaginationNext
                  text={t("next")}
                  href={`/following?page=${Math.min(data.pages, data.page + 1)}`}
                  prefetch={false}
                  {...boundary(pending || loading || data.page >= data.pages)}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          <span role="status" className="sr-only">
            {t("page", {
              page: new Intl.NumberFormat(locale).format(data.page),
              pages: new Intl.NumberFormat(locale).format(data.pages),
            })}
          </span>
        </>
      )}
    </section>
  );
}

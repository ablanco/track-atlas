"use client";
import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
            <ul className="divide-y divide-border">
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
          <nav
            aria-label={t("pagination")}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <Button
              variant="outline"
              disabled={pending || loading || data.page <= 1}
              onClick={() => router.push(`/following?page=${data.page - 1}`)}
            >
              {t("previous")}
            </Button>
            <span role="status">
              {t("page", {
                page: new Intl.NumberFormat(locale).format(data.page),
                pages: new Intl.NumberFormat(locale).format(data.pages),
              })}
            </span>
            <Button
              variant="outline"
              disabled={pending || loading || data.page >= data.pages}
              onClick={() => router.push(`/following?page=${data.page + 1}`)}
            >
              {t("next")}
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}

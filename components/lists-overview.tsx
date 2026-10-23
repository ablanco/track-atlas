"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import type { TrackListIndex, TrackListErrorCode } from "@/tracks/list-types";
import type { AuthLabels } from "./auth-control";
import { listError, listRequest } from "./list-request";
import { ListNameForm } from "./list-name-form";
import { ListActions } from "./list-actions";
import { ListSessionPrompt } from "./list-session-prompt";
import { Button } from "./ui/button";

export function ListsOverview({ labels }: { labels: AuthLabels }) {
  const t = useTranslations("Lists");
  const query = useSearchParams().toString();
  const [data, setData] = useState<{
    query: string;
    value: TrackListIndex;
  } | null>(null);
  const [error, setError] = useState<TrackListErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const result = data?.query === query ? data.value : null;
  useLayoutEffect(
    () => () => {
      setData(null);
      setError(null);
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    listRequest<TrackListIndex>(`/api/lists?${query}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!active) return;
        setData({ query, value });
        setError(null);
        if (
          value.page !== Number(new URLSearchParams(query).get("page") ?? 1)
        ) {
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${value.page > 1 ? `?page=${value.page}` : ""}`,
          );
        }
      })
      .catch((cause) => {
        if (active) {
          setData(null);
          setError(listError(cause));
        }
      });
    const restore = () => {
      setData(null);
      setError(null);
      setAttempt((x) => x + 1);
    };
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", restore);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("focus", restore);
    };
  }, [query, attempt]);
  const refresh = () => {
    setData(null);
    setAttempt((x) => x + 1);
  };
  const unauthorized = () => {
    setData(null);
    setError("unauthorized");
  };
  if (error === "unauthorized") return <ListSessionPrompt labels={labels} />;
  return (
    <div className="space-y-6">
      <ListNameForm
        onSaved={() => {
          if (query)
            window.history.pushState(null, "", window.location.pathname);
          refresh();
        }}
        onUnauthorized={unauthorized}
      />
      {error ? (
        <p role="alert">
          {t(`errors.${error}`)}{" "}
          <Button variant="link" onClick={refresh}>
            {t("retry")}
          </Button>
        </p>
      ) : !result ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          {result.lists.length === 0 && <p>{t("empty")}</p>}
          <ul className="divide-y rounded-md border">
            {result.lists.map((list) => (
              <li
                key={list.id}
                className="flex flex-wrap items-center gap-3 p-4"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/lists/${list.id}`}
                    prefetch={false}
                    className="break-words font-semibold underline underline-offset-4"
                  >
                    {list.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {t("trackCount", { count: list.trackCount })}
                  </p>
                </div>
                <ListActions
                  list={list}
                  onRenamed={refresh}
                  onDeleted={refresh}
                  onUnauthorized={unauthorized}
                />
              </li>
            ))}
          </ul>
          <nav
            aria-label={t("pagination")}
            className="flex flex-wrap items-center gap-2"
          >
            <span>
              {t("pageOf", { page: result.page, count: result.pageCount })}
            </span>
            {Array.from(
              { length: Math.min(result.pageCount, 5) },
              (_, i) => i + 1,
            ).map((page) => (
              <Button
                key={page}
                variant="outline"
                aria-label={t("page", { page })}
                aria-current={page === result.page ? "page" : undefined}
                onClick={() =>
                  window.history.pushState(
                    null,
                    "",
                    `${window.location.pathname}${page > 1 ? `?page=${page}` : ""}`,
                  )
                }
              >
                {page}
              </Button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}

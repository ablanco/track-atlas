"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ThumbsUpIcon } from "@phosphor-icons/react/dist/csr/ThumbsUp";
import { ThumbsDownIcon } from "@phosphor-icons/react/dist/csr/ThumbsDown";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { TrackVote, TrackVotes } from "@/tracks/votes";

export function TrackVoting({
  id,
  initial,
}: {
  id: string;
  initial: TrackVotes;
}) {
  const t = useTranslations("Tracks.votes");
  const locale = useLocale();
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function vote(direction: Exclude<TrackVote, null>) {
    if (pending) return;
    const desired = state.vote === direction ? null : direction;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/tracks/${id}/vote`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: desired }),
        cache: "no-store",
      });
      if (!response.ok) throw Error("voteFailed");
      setState((await response.json()) as TrackVotes);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  return (
    <section
      aria-label={t("title")}
      className="space-y-3 rounded-md border bg-muted/30 p-4"
    >
      <div
        className="flex flex-wrap items-center gap-4"
        aria-live="polite"
        aria-atomic="true"
      >
        <dl className="flex flex-wrap gap-4 tabular-nums">
          <div>
            <dt className="text-sm text-muted-foreground">{t("up")}</dt>
            <dd className="font-semibold">{number(state.up)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("down")}</dt>
            <dd className="font-semibold">{number(state.down)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("popularity")}</dt>
            <dd data-testid="vote-popularity" className="font-semibold">
              {number(state.popularity)}
            </dd>
          </div>
        </dl>
        {state.canVote && (
          <div className="flex gap-2">
            <Button
              type="button"
              aria-label={t("up")}
              aria-pressed={state.vote === "up"}
              variant={state.vote === "up" ? "default" : "outline"}
              disabled={pending}
              onClick={() => void vote("up")}
            >
              <ThumbsUpIcon aria-hidden="true" />
              {t("up")}
            </Button>
            <Button
              type="button"
              aria-label={t("down")}
              aria-pressed={state.vote === "down"}
              variant={state.vote === "down" ? "default" : "outline"}
              disabled={pending}
              onClick={() => void vote("down")}
            >
              <ThumbsDownIcon aria-hidden="true" />
              {t("down")}
            </Button>
          </div>
        )}
      </div>
      {state.needsConfirmation && (
        <p className="text-sm text-muted-foreground">
          {t("confirm")}{" "}
          <Link href="/settings" className="underline underline-offset-4">
            {t("settings")}
          </Link>
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t("failed")}
        </p>
      )}
    </section>
  );
}

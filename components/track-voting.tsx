"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ThumbsUpIcon } from "@phosphor-icons/react/dist/csr/ThumbsUp";
import { ThumbsDownIcon } from "@phosphor-icons/react/dist/csr/ThumbsDown";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { TrackVote, TrackVotes } from "@/tracks/votes";

type VotingContextValue = {
  state: TrackVotes;
  pending: boolean;
  failed: boolean;
  vote: (direction: Exclude<TrackVote, null>) => Promise<void>;
};
const VotingContext = createContext<VotingContextValue | null>(null);

function useVoting() {
  const value = useContext(VotingContext);
  if (!value) throw new Error("Track voting provider required");
  return value;
}

export function TrackVotingProvider({
  id,
  initial,
  children,
}: {
  id: string;
  initial: TrackVotes;
  children: ReactNode;
}) {
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
  return (
    <VotingContext value={{ state, pending, failed, vote }}>
      {children}
    </VotingContext>
  );
}

export function TrackPopularity() {
  const { state } = useVoting();
  const locale = useLocale();
  return (
    <span data-testid="vote-popularity" aria-live="polite">
      {new Intl.NumberFormat(locale).format(state.popularity)}
    </span>
  );
}

export function TrackVoting() {
  const { state, pending, failed, vote } = useVoting();
  const t = useTranslations("Tracks.votes");
  const locale = useLocale();
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  return (
    <section aria-label={t("title")} className="space-y-2">
      <dl
        className="flex items-center gap-2 whitespace-nowrap tabular-nums"
        aria-live="polite"
        aria-atomic="true"
      >
        {(
          [
            { direction: "up", Icon: ThumbsUpIcon, count: state.up },
            { direction: "down", Icon: ThumbsDownIcon, count: state.down },
          ] as const
        ).map(({ direction, Icon, count }) => (
          <div key={direction}>
            <dt className="sr-only">{t(direction)}</dt>
            <dd>
              {state.canVote ? (
                <Button
                  type="button"
                  size="sm"
                  aria-label={t(direction)}
                  title={t(direction)}
                  aria-pressed={state.vote === direction}
                  variant={state.vote === direction ? "default" : "outline"}
                  disabled={pending}
                  onClick={() => void vote(direction)}
                >
                  <Icon aria-hidden="true" />
                  {number(count)}
                </Button>
              ) : (
                <span className="inline-flex h-8 items-center gap-1 px-2.5 text-sm">
                  <Icon
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                  {number(count)}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
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

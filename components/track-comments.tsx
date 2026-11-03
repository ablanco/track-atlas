"use client";

import { useEffect, useState, useRef, useId, Fragment } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import { useLocale, useTranslations } from "next-intl";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/csr/ChatCircleText";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { LoginModal, type AuthLabels } from "@/components/auth-control";
import type {
  TrackCommentsPage,
  DiscussionPost,
  CreatedDiscussionPost,
  DiscussionErrorCode,
} from "@/tracks/comment-types";

function Post({ post, href }: { post: DiscussionPost; href?: string }) {
  const t = useTranslations("Comments");
  const locale = useLocale();
  const name = post.author.deactivated
    ? t("deactivated")
    : (post.author.name ?? "");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Avatar className="size-6" aria-hidden="true">
          {post.author.avatarUrl && !post.author.deactivated && (
            <AvatarImage
              src={post.author.avatarUrl}
              alt=""
              width={24}
              height={24}
            />
          )}
          <AvatarFallback>
            {post.author.deactivated ? (
              <UserIcon aria-hidden="true" />
            ) : (
              name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => Array.from(part)[0])
                .join("")
                .toUpperCase()
            )}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 max-w-full break-words font-medium [overflow-wrap:anywhere]">
          {name}
        </span>
        <span className="inline-flex items-center gap-2">
          <time dateTime={post.createdAt} className="text-muted-foreground">
            {new Intl.DateTimeFormat(locale, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZoneName: "short",
            }).format(new Date(post.createdAt))}
          </time>
          {href && (
            <Link
              href={href}
              prefetch={false}
              aria-label={t("permalink")}
              title={t("permalink")}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <LinkIcon className="size-4" aria-hidden="true" />
            </Link>
          )}
        </span>
      </div>
      <p className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
        {post.text}
      </p>
    </div>
  );
}

type UiError = DiscussionErrorCode | "uncertain";
const codes = new Set<string>([
  "unauthorized",
  "emailUnconfirmed",
  "forbidden",
  "notFound",
  "invalidRequest",
  "invalidText",
  "tooLarge",
  "rateLimited",
  "replyExists",
  "unavailable",
]);
function errorCode(error: unknown): UiError {
  return error instanceof Error && codes.has(error.message)
    ? (error.message as DiscussionErrorCode)
    : "uncertain";
}

export function TrackComments({
  id,
  authLabels,
}: {
  id: string;
  authLabels: AuthLabels;
}) {
  const t = useTranslations("Comments");
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<TrackCommentsPage | null>(null);
  const [failed, setFailed] = useState<UiError | null>(null);
  const [notice, setNotice] = useState<UiError | null>(null);
  const params = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ["page", "comment"])
    for (const value of params.getAll(key)) query.append(key, value);
  const search = query.toString();
  const target = params.get("comment");
  const [login, setLogin] = useState(false);
  const [form, setForm] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const readRequest = useRef<AbortController | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    function discard() {
      readRequest.current?.abort();
      request.current?.abort();
      request.current = null;
      setData(null);
      setFailed(null);
      setNotice(null);
      setForm(null);
      setLogin(false);
      setBusy(false);
    }
    function hide() {
      discard();
      setHidden(true);
    }
    function restore() {
      if (document.visibilityState === "hidden") return;
      discard();
      setHidden(false);
      setAttempt((value) => value + 1);
    }
    function show(event: PageTransitionEvent) {
      if (event.persisted) restore();
    }
    function visibility() {
      if (document.visibilityState === "hidden") hide();
      else restore();
    }
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("focus", restore);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      // React Activity also tears down effects when navigating away.
      discard();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("focus", restore);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController();
    readRequest.current = controller;
    fetch(`/api/tracks/${id}/comments?${search}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error((await response.json()).error);
        return response.json() as Promise<TrackCommentsPage>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.page > value.pages) {
          router.replace(`/tracks/${id}?page=${value.pages}#comments`, {
            scroll: false,
          });
          return;
        }
        setData(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          const code = errorCode(error);
          setFailed(code === "uncertain" ? "unavailable" : code);
        }
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [id, search, attempt, router, hidden]);
  useEffect(() => {
    if (data && target) document.getElementById(`comment-${target}`)?.focus();
  }, [data, target]);
  function reload() {
    setData(null);
    setFailed(null);
    setNotice(null);
    setForm(null);
    setAttempt((value) => value + 1);
  }
  async function submit(text: string, parent: string | null) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/tracks/${id}/comments${parent ? `/${parent}/reply` : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok) throw Error((await response.json()).error);
      const created: CreatedDiscussionPost = await response.json();
      if (controller.signal.aborted) return;
      reload();
      const url = new URL(window.location.href);
      url.search = new URLSearchParams({
        comment: created.commentId,
      }).toString();
      url.hash = `comment-${created.commentId}`;
      window.history.replaceState(null, "", url);
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = errorCode(error);
      if (
        [
          "unauthorized",
          "emailUnconfirmed",
          "forbidden",
          "notFound",
          "replyExists",
        ].includes(code)
      ) {
        reload();
        setNotice(code);
      }
      throw error;
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  function cancel() {
    setForm(null);
    trigger.current?.focus({ preventScroll: true });
  }
  return (
    <section
      aria-label={t("title")}
      id="comments"
      className="space-y-5 border-t pt-6"
    >
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      {notice && !failed && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${notice}`)}
        </p>
      )}
      {failed ? (
        <div className="space-y-2">
          <p role="alert">{t(`errors.${failed}`)}</p>
          <Button variant="outline" onClick={reload}>
            {t("retry")}
          </Button>
        </div>
      ) : !data ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          {data.comments.length === 0 && (
            <p className="text-muted-foreground">{t("empty")}</p>
          )}
          <ol className="space-y-6">
            {data.comments.map((comment) => (
              <li
                key={comment.id}
                id={`comment-${comment.id}`}
                tabIndex={-1}
                className="scroll-mt-6 space-y-3 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Post
                  post={comment}
                  href={`/tracks/${id}?comment=${comment.id}#comment-${comment.id}`}
                />
                {comment.reply ? (
                  <div className="ml-4 border-l pl-4 sm:ml-8">
                    <Post post={comment.reply} />
                  </div>
                ) : (
                  comment.canReply &&
                  (form === comment.id ? (
                    <div className="ml-4 border-l pl-4 sm:ml-8">
                      <PostForm
                        reply
                        busy={busy}
                        submit={(text) => submit(text, comment.id)}
                        cancel={cancel}
                      />
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={(event) => {
                        trigger.current = event.currentTarget;
                        setForm(comment.id);
                      }}
                      className="min-h-11"
                    >
                      <ChatCircleTextIcon aria-hidden="true" />
                      {t("reply")}
                    </Button>
                  ))
                )}
              </li>
            ))}
          </ol>
          {data.pages > 1 && (
            <CommentPagination id={id} page={data.page} pages={data.pages} />
          )}
          {form === "new" ? (
            <PostForm
              busy={busy}
              submit={(text) => submit(text, null)}
              cancel={cancel}
            />
          ) : (
            <Button
              disabled={busy}
              onClick={(event) => {
                trigger.current = event.currentTarget;
                if (data.posting === "login") setLogin(true);
                else if (data.posting === "allowed") setForm("new");
                else setForm("confirm");
              }}
              className="min-h-11"
            >
              <ChatCircleTextIcon aria-hidden="true" />
              {t("leave")}
            </Button>
          )}
          {form === "confirm" && (
            <p role="status">
              {t("confirm")}{" "}
              <Link href="/settings" className="underline underline-offset-4">
                {t("settings")}
              </Link>
            </p>
          )}
        </>
      )}
      {login && (
        <LoginModal
          locale={locale}
          labels={authLabels}
          onClose={() => {
            setLogin(false);
            trigger.current?.focus({ preventScroll: true });
          }}
          onSubmit={() => {}}
          onSuccess={() => {
            setLogin(false);
            reload();
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function PostForm({
  reply = false,
  busy,
  submit,
  cancel,
}: {
  reply?: boolean;
  busy: boolean;
  submit(text: string): Promise<void>;
  cancel(): void;
}) {
  const t = useTranslations("Comments");
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<UiError | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) alert.current?.focus({ preventScroll: true });
  }, [error]);
  return (
    <form
      aria-label={t(reply ? "replyText" : "text")}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setError(null);
        const length = Array.from(text.trim()).length;
        if (!length || length > 2000) {
          setError("invalidText");
          return;
        }
        try {
          await submit(text);
        } catch (cause) {
          setError(errorCode(cause));
        }
      }}
      className="space-y-3"
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {t(reply ? "replyText" : "text")}
      </label>
      <Textarea
        id={id}
        autoFocus
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        aria-invalid={error === "invalidText" || error === "tooLarge"}
        rows={4}
      />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {t("hint")}
      </p>
      {error && (
        <p
          ref={alert}
          id={`${id}-error`}
          tabIndex={-1}
          role="alert"
          className="text-sm text-destructive"
        >
          {t(`errors.${error}`)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} className="min-h-11">
          {t(busy ? "pending" : "submit")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={cancel}
          className="min-h-11"
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function CommentPagination({
  id,
  page,
  pages,
}: {
  id: string;
  page: number;
  pages: number;
}) {
  const t = useTranslations("Comments");
  const href = (value: number) => `/tracks/${id}?page=${value}#comments`;
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((value) => value >= 1 && value <= pages)
    .sort((a, b) => a - b);
  return (
    <Pagination aria-label={t("pagination")}>
      <PaginationContent className="flex-wrap justify-center">
        <PaginationItem>
          <PaginationPrevious
            text={t("previous")}
            href={href(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : undefined}
            onClick={(event) => {
              if (page <= 1) event.preventDefault();
            }}
            prefetch={false}
          />
        </PaginationItem>
        {numbers.map((value, index) => (
          <Fragment key={value}>
            {index > 0 && value > numbers[index - 1] + 1 && (
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
            )}
            <PaginationItem>
              <PaginationLink
                href={href(value)}
                isActive={value === page}
                aria-label={t("page", { page: value })}
                prefetch={false}
              >
                {value}
              </PaginationLink>
            </PaginationItem>
          </Fragment>
        ))}
        <PaginationItem>
          <PaginationNext
            text={t("next")}
            href={href(Math.min(pages, page + 1))}
            aria-disabled={page >= pages}
            tabIndex={page >= pages ? -1 : undefined}
            onClick={(event) => {
              if (page >= pages) event.preventDefault();
            }}
            prefetch={false}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

"use client";
import {
  locales,
  isSupportedLocale,
  type SupportedLocale,
} from "@/i18n/locales";
import { languageNames } from "@/i18n/languages";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Preferences = { enabled: boolean; locale: SupportedLocale | null };
type PreferencesError = "unavailable" | "unauthorized";

export function DiscussionPreferences() {
  const t = useTranslations("Settings.discussion");
  const siteLocale = useLocale();
  const id = useId();
  const [data, setData] = useState<Preferences | null>(null);
  const [error, setError] = useState<PreferencesError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) alert.current?.focus({ preventScroll: true });
  }, [error]);
  useEffect(() => {
    function discard() {
      read.current?.abort();
      write.current?.abort();
      write.current = null;
      setData(null);
      setError(null);
      setSaved(false);
      setPending(false);
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
    function visibility() {
      if (document.visibilityState === "hidden") hide();
      else restore();
    }
    function show(event: PageTransitionEvent) {
      if (event.persisted) restore();
    }
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("focus", restore);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      // Discard state for React Activity navigation as well as tab hiding.
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
    read.current = controller;
    fetch("/api/discussion-preferences", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw Error(response.status === 401 ? "unauthorized" : "unavailable");
        return response.json() as Promise<Preferences>;
      })
      .then((value) => {
        if (!controller.signal.aborted)
          setData({
            ...value,
            locale:
              value.locale ??
              (isSupportedLocale(siteLocale) ? siteLocale : "en"),
          });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error && cause.message === "unauthorized"
              ? "unauthorized"
              : "unavailable",
          );
      });
    return () => controller.abort();
  }, [attempt, hidden, siteLocale]);
  async function save() {
    if (!data || write.current) return;
    const controller = new AbortController();
    write.current = controller;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/discussion-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw Error(response.status === 401 ? "unauthorized" : "unavailable");
      const value: Preferences = await response.json();
      if (!controller.signal.aborted) {
        setData(value);
        setSaved(true);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      const code =
        cause instanceof Error && cause.message === "unauthorized"
          ? "unauthorized"
          : "unavailable";
      if (code === "unauthorized") setData(null);
      setError(code);
    } finally {
      if (write.current === controller) {
        write.current = null;
        setPending(false);
      }
    }
  }
  return (
    <section className="border-b border-border py-7">
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        {t("title")}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
      <form
        aria-labelledby={`${id}-title`}
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="mt-5 space-y-5"
      >
        {error && (
          <p
            ref={alert}
            role="alert"
            tabIndex={-1}
            className="text-sm text-destructive"
          >
            {t(error)}
            {error === "unauthorized" && (
              <>
                {" "}
                <Link href="/" className="underline underline-offset-4">
                  {t("home")}
                </Link>
              </>
            )}
          </p>
        )}
        {data ? (
          <>
            <fieldset disabled={pending} className="space-y-5">
              <Field orientation="horizontal">
                <Switch
                  id={`${id}-enabled`}
                  checked={data.enabled}
                  disabled={pending}
                  onCheckedChange={(enabled) => {
                    setData({ ...data, enabled });
                    setSaved(false);
                  }}
                />
                <FieldLabel htmlFor={`${id}-enabled`} className="min-h-11">
                  {t("enabled")}
                </FieldLabel>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-locale`}>{t("locale")}</FieldLabel>
                <Select
                  value={data.locale}
                  disabled={pending}
                  items={locales.map((value) => ({
                    value,
                    label: languageNames[value],
                  }))}
                  onValueChange={(locale) => {
                    if (isSupportedLocale(locale)) {
                      setData({ ...data, locale });
                      setSaved(false);
                    }
                  }}
                >
                  <SelectTrigger id={`${id}-locale`} className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locales.map((locale) => (
                      <SelectItem key={locale} value={locale} lang={locale}>
                        {languageNames[locale]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" disabled={pending} className="min-h-11">
                {t(pending ? "pending" : "submit")}
              </Button>
            </fieldset>
            {saved && (
              <p role="status" className="text-sm text-success">
                {t("saved")}
              </p>
            )}
          </>
        ) : error ? (
          error !== "unauthorized" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              {t("retry")}
            </Button>
          )
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t("loading")}
          </p>
        )}
      </form>
    </section>
  );
}

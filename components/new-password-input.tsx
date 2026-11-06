"use client";

import { useEffect, useId, useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { PasswordInput } from "@/components/password-input";
import { Progress } from "@/components/ui/progress";
import {
  maximumPasswordBytes,
  measurePassword,
  minimumPasswordScore,
  type PasswordScore,
} from "@/auth/password-strength";

export function NewPasswordInput({
  resetSignal,
  onChange,
  ...props
}: ComponentProps<typeof PasswordInput> & { resetSignal?: unknown }) {
  const t = useTranslations("PasswordStrength");
  const id = useId();
  const [entry, setEntry] = useState({ password: "", resetSignal });
  const [result, setResult] = useState<{
    password: string;
    score?: PasswordScore;
  } | null>(null);
  if (entry.resetSignal !== resetSignal) {
    setEntry({ password: "", resetSignal });
    setResult(null);
  }
  const password = entry.password;
  const tooLong =
    new TextEncoder().encode(password).length > maximumPasswordBytes;
  useEffect(() => {
    if (!password || tooLong) return;
    let active = true;
    const timer = setTimeout(() => {
      measurePassword(password).then(
        (score) => {
          if (active) setResult({ password, score });
        },
        () => {
          if (active) setResult({ password });
        },
      );
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [password, tooLong]);
  const score = result?.password === password ? result.score : undefined;
  const label = !password
    ? t("empty")
    : tooLong
      ? t("tooLong")
      : score !== undefined
        ? t(`scores.${score}`)
        : result?.password === password
          ? t("unavailable")
          : t("checking");
  return (
    <>
      <PasswordInput
        {...props}
        aria-describedby={[`${id}-strength`, props["aria-describedby"]]
          .filter(Boolean)
          .join(" ")}
        onChange={(event) => {
          setEntry({ password: event.currentTarget.value, resetSignal });
          onChange?.(event);
        }}
      />
      <div
        id={`${id}-strength`}
        className="space-y-2 text-sm text-muted-foreground"
      >
        <Progress
          value={password && score !== undefined ? (score + 1) * 20 : 0}
          aria-label={t("label")}
          aria-valuetext={label}
          className={
            score !== undefined && score >= minimumPasswordScore
              ? "**:data-[slot=progress-indicator]:bg-success"
              : "**:data-[slot=progress-indicator]:bg-destructive"
          }
        />
        <p aria-live="polite" aria-atomic="true">
          {label}
        </p>
        <p>{t("hint")}</p>
      </div>
    </>
  );
}

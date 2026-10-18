"use client";

import { useId, useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeClosedIcon } from "@phosphor-icons/react/dist/csr/EyeClosed";

type PasswordInputProps = Omit<ComponentProps<"input">, "type">;

export function PasswordInput({ id, className = "", disabled, ...props }: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const t = useTranslations("PasswordInput");
  const Icon = visible ? EyeClosedIcon : EyeIcon;

  return (
    <div className="relative">
      <input {...props} id={inputId} disabled={disabled} type={visible ? "text" : "password"}
        className={`mt-2 block min-h-11 w-full min-w-0 rounded-md border border-default bg-surface px-3 py-2 pr-12 text-primary aria-invalid:border-danger ${className}`} />
      <button type="button" disabled={disabled} aria-label={t(visible ? "hide" : "show")} aria-controls={inputId}
        onClick={() => setVisible(value => !value)}
        className="absolute right-0 bottom-0 flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-60">
        <Icon size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

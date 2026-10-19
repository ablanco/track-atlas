"use client";

import { useId, useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeClosedIcon } from "@phosphor-icons/react/dist/csr/EyeClosed";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<ComponentProps<"input">, "type">;

export function PasswordInput({
  id,
  className = "",
  disabled,
  ...props
}: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const t = useTranslations("PasswordInput");
  const Icon = visible ? EyeClosedIcon : EyeIcon;

  return (
    <div className="relative">
      <Input
        {...props}
        id={inputId}
        disabled={disabled}
        type={visible ? "text" : "password"}
        className={cn("min-h-11 pr-12", className)}
      />
      <Button
        variant="ghost"
        size="icon"
        type="button"
        disabled={disabled}
        aria-label={t(visible ? "hide" : "show")}
        aria-controls={inputId}
        onClick={() => setVisible((value) => !value)}
        className="absolute top-0 right-0 h-full w-11 text-muted-foreground"
      >
        <Icon size={20} aria-hidden="true" />
      </Button>
    </div>
  );
}

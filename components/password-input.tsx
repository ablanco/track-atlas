"use client";

import { useId, useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeClosedIcon } from "@phosphor-icons/react/dist/csr/EyeClosed";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
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
    <InputGroup
      className={cn("min-h-11", className)}
      data-disabled={disabled || undefined}
    >
      <InputGroupInput
        {...props}
        id={inputId}
        disabled={disabled}
        type={visible ? "text" : "password"}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          variant="ghost"
          size="icon-sm"
          type="button"
          disabled={disabled}
          aria-label={t(visible ? "hide" : "show")}
          aria-controls={inputId}
          onClick={() => setVisible((value) => !value)}
          className="relative after:absolute after:-inset-1.5"
        >
          <Icon size={20} aria-hidden="true" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

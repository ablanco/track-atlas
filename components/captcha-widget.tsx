"use client";

import { useEffect, useRef, useState } from "react";
import type { AltchaWidgetElement } from "altcha";
import type {} from "altcha/types/react";

export function CaptchaWidget({ locale, resetSignal, unavailable }: { locale: string; resetSignal: object; unavailable: string }) {
  const widget = useRef<AltchaWidgetElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    // Load only after hydration: the web component uses browser APIs. Bundle
    // its worker/translations locally rather than depending on a CDN.
    Promise.all([import("altcha"), import("altcha/i18n/es-es")]).catch(() => {
      if (mounted) setFailed(true);
    });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { widget.current?.reset?.(); }, [resetSignal]);

  return (
    <div>
      <altcha-widget ref={widget} challenge="/api/altcha/challenge" language={locale} name="altcha" type="native" workers={2}
        configuration={JSON.stringify({ humanInteractionSignature: false, serverVerificationFields: false, serverVerificationTimeZone: false })}
        style={{
          "--altcha-color-base": "var(--surface)",
          "--altcha-color-base-content": "var(--primary)",
          "--altcha-color-primary": "var(--accent)",
          "--altcha-color-primary-content": "var(--on-accent)",
          "--altcha-color-neutral": "var(--border-default)",
          "--altcha-color-neutral-content": "var(--primary)",
        }} />
      {failed && <p role="alert" className="mt-2 text-sm">{unavailable}</p>}
      <noscript><p className="mt-2 text-sm">{unavailable}</p></noscript>
    </div>
  );
}

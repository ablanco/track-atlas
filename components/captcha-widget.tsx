"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AltchaWidgetElement } from "altcha";
import type {} from "altcha/types/react";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function CaptchaWidget({
  locale,
  resetSignal,
  unavailable,
  challengeUrl = "/api/altcha/challenge",
}: {
  locale: string;
  resetSignal: object;
  unavailable: string;
  challengeUrl?: string;
}) {
  const widget = useRef<AltchaWidgetElement>(null);
  const [failed, setFailed] = useState(false);
  // A previously loaded widget upgrades new custom elements immediately. Keep
  // it out of SSR markup so it cannot mutate a streamed boundary before React
  // hydrates it (notably signup and the header modal on the same page).
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  useEffect(() => {
    let mounted = true;
    // Load only after hydration: the web component uses browser APIs. Bundle
    // its worker/translations locally rather than depending on a CDN.
    Promise.all([import("altcha"), import("altcha/i18n/es-es")]).catch(() => {
      if (mounted) setFailed(true);
    });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    widget.current?.reset?.();
  }, [resetSignal]);

  return (
    <div>
      {ready && (
        <altcha-widget
          ref={widget}
          challenge={challengeUrl}
          language={locale}
          name="altcha"
          type="native"
          workers={2}
          configuration={JSON.stringify({
            humanInteractionSignature: false,
            serverVerificationFields: false,
            serverVerificationTimeZone: false,
          })}
          style={{
            "--altcha-color-base": "var(--surface)",
            "--altcha-color-base-content": "var(--primary)",
            "--altcha-color-primary": "var(--accent)",
            "--altcha-color-primary-content": "var(--on-accent)",
            "--altcha-color-neutral": "var(--border-default)",
            "--altcha-color-neutral-content": "var(--primary)",
          }}
        />
      )}
      {failed && (
        <p role="alert" className="mt-2 text-sm">
          {unavailable}
        </p>
      )}
      <noscript>
        <p className="mt-2 text-sm">{unavailable}</p>
      </noscript>
    </div>
  );
}

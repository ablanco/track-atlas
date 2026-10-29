"use client";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { LoginModal, type AuthLabels } from "./auth-control";
import { Button } from "./ui/button";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** Mounted only after the server has established that this request is a guest. */
export function UploadLogin({
  locale,
  labels,
}: {
  locale: string;
  labels: AuthLabels;
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const params = useSearchParams();
  const [open, setOpen] = useState(params.get("login") === "1");
  const router = useRouter();
  const close = useCallback(() => setOpen(false), []);
  const success = useCallback(() => {
    setOpen(false);
    router.refresh();
  }, [router]);
  return (
    <>
      <Button
        disabled={!ready}
        onClick={() => setOpen(true)}
        className="min-h-11"
      >
        {labels.login}
      </Button>
      {open && ready && (
        <LoginModal
          locale={locale}
          labels={labels}
          onClose={close}
          onSuccess={success}
          onSubmit={() => {}}
          uploadIntent
        />
      )}
    </>
  );
}

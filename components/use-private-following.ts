"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "@/i18n/navigation";

type Failure = "unauthorized" | "unavailable";
/** Private browser state is discarded on hiding/navigation and reauthorized on return. */
export function usePrivateFollowing<T>(url: string) {
  const pathname = usePathname();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [hidden, setHidden] = useState(false);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  function reload() {
    setLoading(true);
    setRevision((v) => v + 1);
  }
  useEffect(() => {
    function discard() {
      read.current?.abort();
      write.current?.abort();
      write.current = null;
      setData(null);
      setError(null);
      setPending(false);
      setLoading(true);
    }
    function hide() {
      discard();
      setHidden(true);
    }
    function restore() {
      if (document.visibilityState === "hidden") return;
      discard();
      setHidden(false);
      setRevision((v) => v + 1);
    }
    function visibility() {
      if (document.visibilityState === "hidden") hide();
      else restore();
    }
    function show(event: PageTransitionEvent) {
      if (event.persisted) restore();
    }
    window.addEventListener("focus", restore);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      discard();
      window.removeEventListener("focus", restore);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [pathname]);
  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController();
    read.current = controller;
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw Error(response.status === 401 ? "unauthorized" : "unavailable");
        return response.json() as Promise<T>;
      })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError(null);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(
            cause.message === "unauthorized" ? "unauthorized" : "unavailable",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision, hidden]);
  async function put(path: string, input: unknown): Promise<unknown | null> {
    if (write.current) return null;
    read.current?.abort();
    const controller = new AbortController();
    write.current = controller;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw Error(response.status === 401 ? "unauthorized" : "unavailable");
      const value: unknown = await response.json();
      return controller.signal.aborted ? null : value;
    } catch (cause) {
      if (!controller.signal.aborted) {
        const code =
          cause instanceof Error && cause.message === "unauthorized"
            ? "unauthorized"
            : "unavailable";
        if (code === "unauthorized") setData(null);
        setError(code);
      }
      return null;
    } finally {
      if (write.current === controller) {
        write.current = null;
        setPending(false);
      }
    }
  }
  return { data, setData, error, loading, pending, reload, put };
}

"use client";

import { useEffect, useRef } from "react";

// The Navigation API covers browser Back/Forward where cancellation is supported;
// link capture handles Next navigation before it starts rendering another page.
type NavigationEvent = Event & {
  navigationType: string;
  destination: { url: string };
  downloadRequest: string | null;
};
export function useUnsavedChanges(
  dirty: boolean,
  message: string,
  discard: () => void,
) {
  const blocked = useRef(dirty);
  useEffect(() => {
    blocked.current = dirty;
  }, [dirty]);
  useEffect(() => {
    const currentUrl = location.href;
    const currentState = history.state;
    let restoring = false;
    function confirm(deferDiscard = false) {
      if (blocked.current && !window.confirm(message)) return false;
      blocked.current = false;
      if (deferDiscard) queueMicrotask(discard);
      else discard();
      return true;
    }
    function unload(event: BeforeUnloadEvent) {
      if (blocked.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    function click(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element).closest?.("a[href]");
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.download ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      const target = new URL(anchor.href);
      if (
        target.origin === location.origin &&
        target.pathname === location.pathname &&
        target.search === location.search
      )
        return;
      if (!confirm()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    function navigate(event: Event) {
      const navigation = event as NavigationEvent;
      if (
        restoring ||
        !event.cancelable ||
        navigation.navigationType === "reload" ||
        navigation.downloadRequest !== null
      )
        return;
      const target = new URL(navigation.destination.url);
      if (
        target.pathname === location.pathname &&
        target.search === location.search
      )
        return;
      // Next writes history in useInsertionEffect, which synchronously fires
      // this event. Decide cancellation now, but update React state after commit.
      if (!confirm(true)) event.preventDefault();
    }
    function popstate(event: PopStateEvent) {
      // Fallback for browsers without cancellable Navigation API traversal.
      // Capture before Next handles the traversal, then restore this entry if
      // the owner keeps the draft. Accepted traversal continues normally.
      if (
        !navigation &&
        blocked.current &&
        location.href === currentUrl &&
        history.state?.trackAtlasDraftGuard !== currentUrl
      ) {
        event.stopImmediatePropagation();
        if (confirm()) history.back();
        else
          history.pushState(
            { ...currentState, trackAtlasDraftGuard: currentUrl },
            "",
            currentUrl,
          );
        return;
      }
      if (location.href === currentUrl || confirm()) return;
      event.stopImmediatePropagation();
      restoring = true;
      history.pushState(currentState, "", currentUrl);
      restoring = false;
    }
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation;
    // A same-page history entry keeps legacy traversal on this Activity until
    // the owner decides. Reuse it across edits to avoid accumulating entries.
    const guardKey = "trackAtlasDraftGuard";
    if (!navigation && dirty && history.state?.[guardKey] !== currentUrl) {
      history.pushState(
        { ...currentState, [guardKey]: currentUrl },
        "",
        currentUrl,
      );
    }
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", popstate, true);
    navigation?.addEventListener("navigate", navigate);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", popstate, true);
      navigation?.removeEventListener("navigate", navigate);
    };
  }, [dirty, message, discard]);
  return () => {
    blocked.current = false;
  };
}

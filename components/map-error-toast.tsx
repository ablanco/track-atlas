"use client";

import { useEffect, useRef } from "react";
import { toast } from "./ui/toast";

/** One notification per failed layer attempt, even if many tiles fail. */
export function MapErrorToast({ message }: { message: string }) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast.add({ title: message, type: "error" });
  }, [message]);
  return null;
}

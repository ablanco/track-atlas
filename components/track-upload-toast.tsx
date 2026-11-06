"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";

export function TrackUploadToast({
  requestId,
  message,
}: {
  requestId: string;
  message: string;
}) {
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (shown.current === requestId) return;
    shown.current = requestId;
    toast.add({ title: message, type: "success" });
  }, [requestId, message]);
  return null;
}

"use client";
import type { TrackListErrorCode } from "@/tracks/list-types";

export class ListRequestError extends Error {
  constructor(public code: TrackListErrorCode) {
    super(code);
  }
}
export async function listRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const codes: TrackListErrorCode[] = [
      "invalidRequest",
      "unauthorized",
      "notFound",
      "duplicateName",
      "listLimit",
      "trackLimit",
      "unavailable",
    ];
    throw new ListRequestError(
      codes.includes(body.error) ? body.error : "unavailable",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function listError(error: unknown): TrackListErrorCode {
  return error instanceof ListRequestError ? error.code : "unavailable";
}

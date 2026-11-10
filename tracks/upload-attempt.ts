import {
  TrackError,
  trackIdPattern,
  validateTrackInput,
  type TrackField,
} from "./validation";

type Photo = { id: string; caption: string };
export type UploadDraft = {
  file: File | undefined;
  metadata: unknown;
  photos: readonly Photo[];
};
export type UploadFailure = {
  kind: "failure";
  code: string;
  fields?: Partial<Record<TrackField, boolean>>;
  track: number | null;
  segment: number | null;
};
export type UploadAcknowledgement =
  UploadFailure | { kind: "success"; destination: string };
export type UploadAttemptState = "editable" | "pending" | "uncertain";

// Only protocol error codes can release a frozen submission for correction.
// Unknown acknowledgements must remain resolvable using the original identity.
const rejectionCodes = new Set([
  "unauthorized",
  "emailUnconfirmed",
  "invalidRequest",
  "invalidMetadata",
  "invalidFile",
  "invalidSegment",
  "unsupportedStructure",
  "tooLarge",
  "tooManyPoints",
  "tooManyTracks",
  "tooManySegments",
  "notFound",
  "quotaExceeded",
  "forbidden",
  "conflict",
  "processingTimeout",
]);
const fields: TrackField[] = [
  "name",
  "description",
  "activity",
  "difficulty",
  "tags",
  "file",
  "visibility",
];

/** One logical Track creation, retaining its immutable submission until resolved.
 * The caller owns fetch and presentation; no photo drafts or committed outputs
 * are cleaned up here. Activity hide/show must retain this instance.
 */
export class UploadAttempt {
  #state: UploadAttemptState = "editable";
  #request: { payload: string; file: File; id: string } | null = null;

  get state() {
    return this.#state;
  }
  get canEdit() {
    return this.#state === "editable";
  }
  canSubmit(previewReady: boolean, photosBusy: boolean) {
    return (
      this.#state !== "pending" &&
      (this.#state === "uncertain" || (previewReady && !photosBusy))
    );
  }

  /** Start or retry. Pending duplicate activations are ignored. An uncertain
   * retry ignores the current draft, including expired/replaced photo leases.
   * Local validation throws TrackError before changing attempt state.
   */
  begin(draft: UploadDraft): FormData | null {
    if (this.#state === "pending") return null;
    if (this.#state !== "uncertain") {
      const metadata = validateTrackInput(draft.metadata);
      if (!draft.file)
        throw new TrackError("invalidMetadata", { file: "required" });
      if (draft.file.size > 10 * 1024 * 1024)
        throw new TrackError("tooLarge", { file: "invalid" });
      const payload = JSON.stringify({
        ...metadata,
        photos: draft.photos.map(({ id, caption }) => ({ id, caption })),
      });
      if (
        !this.#request ||
        this.#request.payload !== payload ||
        this.#request.file !== draft.file
      )
        this.#request = { payload, file: draft.file, id: crypto.randomUUID() };
    }
    if (!this.#request) throw new Error("Missing upload submission");
    const input = JSON.parse(this.#request.payload);
    const body = new FormData();
    for (const field of [
      "name",
      "description",
      "activity",
      "difficulty",
      "visibility",
    ])
      body.set(field, String(input[field]));
    body.set("tags", JSON.stringify(input.tags));
    body.set("photos", JSON.stringify(input.photos));
    body.set("requestId", this.#request.id);
    body.set("file", this.#request.file);
    this.#state = "pending";
    return body;
  }

  /** Decode an HTTP acknowledgement before permitting navigation or draft reset. */
  acknowledge(
    ok: boolean,
    value: unknown,
    ownerId: string,
  ): UploadAcknowledgement {
    if (this.#state !== "pending" || !this.#request)
      throw new Error("No pending upload");
    const result =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const ids = result.ids;
    if (
      ok &&
      typeof result.id === "string" &&
      trackIdPattern.test(result.id) &&
      Array.isArray(ids) &&
      ids.length >= 1 &&
      ids.length <= 100 &&
      ids.every((id) => typeof id === "string" && trackIdPattern.test(id)) &&
      new Set(ids).size === ids.length &&
      ids[0] === result.id
    ) {
      const destination =
        ids.length === 1
          ? `/tracks/${result.id}`
          : `/users/${ownerId}/tracks?created=${this.#request.id}`;
      this.#request = null;
      this.#state = "editable";
      return { kind: "success", destination };
    }
    // A malformed 2xx must never unlock edits, even if it contains an error key.
    const code =
      !ok &&
      typeof result.error === "string" &&
      (rejectionCodes.has(result.error) || result.error === "processing")
        ? result.error
        : "unavailable";
    this.#state =
      code === "unavailable" || code === "processing"
        ? "uncertain"
        : "editable";
    let invalid: UploadFailure["fields"];
    if (result.fieldErrors && typeof result.fieldErrors === "object") {
      invalid = {};
      for (const field of fields)
        if (field in result.fieldErrors) invalid[field] = true;
    }
    const ordinal = new TrackError("invalidSegment", undefined, result);
    return {
      kind: "failure",
      code,
      fields: invalid,
      track: ordinal.track ?? null,
      segment: code === "invalidSegment" ? (ordinal.segment ?? null) : null,
    };
  }

  /** Transport failures and unreadable JSON cannot prove whether creation committed. */
  unavailable(): UploadFailure {
    if (this.#state !== "pending") throw new Error("No pending upload");
    this.#state = "uncertain";
    return { kind: "failure", code: "unavailable", track: null, segment: null };
  }
}

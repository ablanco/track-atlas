"use client";
import type { GpxUploadPreview } from "@/tracks/gpx-preview";
import { PhotoPicker, type PhotoDraft } from "@/components/photo-picker";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import {
  type ActivityType,
  tagKey,
  trackIdPattern,
  TrackError,
  validateTrackInput,
  type TrackInput,
} from "@/tracks/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@/components/ui/field";
import { ActivityGrid } from "./activity-grid";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

type FieldName =
  | "name"
  | "description"
  | "file"
  | "activity"
  | "difficulty"
  | "tags"
  | "visibility";
const length = (value: string) => [...value].length;
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
export function UploadForm({ ownerId }: { ownerId: string }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const t = useTranslations("Tracks");
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    file: File;
    title: string;
    value?: GpxUploadPreview;
    error?: TrackError;
  } | null>(null);
  const [previewRun, setPreviewRun] = useState(0);
  const [photoGeneration, setPhotoGeneration] = useState(0);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [activity, setActivity] = useState<ActivityType | null>(null);
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [tagError, setTagError] = useState("");
  const [tagStatus, setTagStatus] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldName, boolean>>>({});
  const [error, setError] = useState("");
  const [invalidSegment, setInvalidSegment] = useState<number | null>(null);
  const [invalidTrack, setInvalidTrack] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const tagInput = useRef<HTMLInputElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const busy = useRef(false);
  const request = useRef<{ payload: string; file: File; id: string } | null>(
    null,
  );
  useEffect(() => {
    if (error && !pending) summary.current?.focus();
  }, [error, pending]);
  const currentPreview =
    preview?.file === selectedFile && preview?.title === name ? preview : null;
  useEffect(() => {
    if (!selectedFile) return;
    let live = true;
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../../../../tracks/gpx-preview.worker.ts", import.meta.url),
      );
    } catch {
      queueMicrotask(() => {
        if (live)
          setPreview({
            file: selectedFile,
            title: name,
            error: new TrackError("unavailable"),
          });
      });
      return () => {
        live = false;
      };
    }
    const finish = (result: {
      value?: GpxUploadPreview;
      error?: TrackError;
    }) => {
      if (!live) return;
      live = false;
      clearTimeout(timer);
      worker.terminate();
      setPreview({ file: selectedFile, title: name, ...result });
    };
    const timer = setTimeout(
      () => finish({ error: new TrackError("processingTimeout") }),
      10000,
    );
    worker.onmessage = ({ data }) =>
      finish(
        data.error
          ? { error: new TrackError(data.error.code, undefined, data.error) }
          : { value: data.preview },
      );
    worker.onerror = (event) => {
      event.preventDefault();
      finish({ error: new TrackError("unavailable") });
    };
    worker.postMessage({ file: selectedFile, title: name });
    // Activity hide, title/file replacement and unmount fence late replies and
    // terminate scanning, so only one preview worker can remain active.
    return () => {
      live = false;
      clearTimeout(timer);
      worker.terminate();
    };
  }, [selectedFile, name, previewRun]);
  function errorMessage(
    code: string,
    track: number | null = null,
    segment: number | null = null,
  ): string {
    const message =
      code === "invalidSegment" && segment !== null
        ? t("errors.invalidSegmentNumber", { segment })
        : t.has(`errors.${code}`)
          ? t(`errors.${code}`)
          : t("errors.unavailable");
    return track === null
      ? message
      : t("errors.trackNumber", { track, message });
  }
  function announce(
    code: string,
    segment: number | null = null,
    track: number | null = null,
  ) {
    setInvalidTrack(track);
    setInvalidSegment(segment);
    setError(code);
    // Repeated client validation can reuse the same message without a new effect.
    summary.current?.focus();
  }
  function addTag() {
    const value = draft.trim();
    if (!value || length(value) > 30 || tags.length >= 10) {
      setTagError(t("tagInvalid"));
      return;
    }
    if (tags.some((tag) => tagKey(tag) === tagKey(value))) {
      setTagError(t("duplicate"));
      return;
    }
    setTags([...tags, value]);
    setTagStatus(t("tagAdded", { tag: value }));
    setDraft("");
    setTagError("");
    setErrors((old) => ({ ...old, tags: false }));
    tagInput.current?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || (!uncertain && (photosBusy || !currentPreview?.value)))
      return;
    // Resolve a lost acknowledgement with the exact original photo identities,
    // even if the browser's staged-photo lease has expired in the meantime.
    const retry = uncertain ? request.current : null;
    const retryInput = retry ? JSON.parse(retry.payload) : null;
    const submittedPhotos: PhotoDraft[] = retryInput?.photos ?? photos;
    const selected = retry?.file ?? file.current?.files?.[0];
    let metadata: TrackInput | undefined;
    const invalid: Partial<Record<FieldName, boolean>> = { file: !selected };
    try {
      metadata = validateTrackInput(
        retryInput ?? {
          name,
          description,
          activity,
          difficulty: Number(difficulty),
          tags,
          visibility,
        },
      );
    } catch (cause) {
      if (cause instanceof TrackError && cause.fieldErrors) {
        for (const field of Object.keys(cause.fieldErrors) as FieldName[])
          invalid[field] = true;
      } else {
        announce("invalidMetadata");
        return;
      }
    }
    setErrors(invalid);
    if (Object.values(invalid).some(Boolean)) {
      announce("check");
      return;
    }
    if (!selected || !metadata) return;
    if (selected.size > 10 * 1024 * 1024) {
      setErrors({ file: true });
      announce("tooLarge");
      return;
    }
    const payload = JSON.stringify({ ...metadata, photos: submittedPhotos });
    if (
      !request.current ||
      request.current.payload !== payload ||
      request.current.file !== selected
    )
      request.current = { payload, file: selected, id: crypto.randomUUID() };
    const body = new FormData();
    body.set("photos", JSON.stringify(submittedPhotos));
    body.set("name", metadata.name);
    body.set("description", metadata.description);
    body.set("activity", metadata.activity);
    body.set("difficulty", String(metadata.difficulty));
    body.set("tags", JSON.stringify(metadata.tags));
    body.set("visibility", metadata.visibility);
    body.set("requestId", request.current.id);
    body.set("file", selected);
    busy.current = true;
    setPending(true);
    setUncertain(false);
    setError("");
    try {
      const response = await fetch("/api/tracks", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(90000),
      });
      const result: unknown = await response.json();
      if (
        response.ok &&
        typeof result === "object" &&
        result &&
        "id" in result &&
        typeof result.id === "string" &&
        trackIdPattern.test(result.id) &&
        "ids" in result &&
        Array.isArray(result.ids) &&
        result.ids.length >= 1 &&
        result.ids.length <= 100 &&
        result.ids.every(
          (id: unknown) => typeof id === "string" && trackIdPattern.test(id),
        ) &&
        new Set(result.ids).size === result.ids.length &&
        result.ids[0] === result.id
      ) {
        // Cache Components preserves this page across navigation. Only discard
        // the draft after confirmed success; failures must remain retryable.
        const destination =
          result.ids.length === 1
            ? `/tracks/${result.id}`
            : `/users/${ownerId}/tracks?created=${request.current.id}`;
        setPhotos([]);
        setPhotoGeneration((old) => old + 1);
        setName("");
        setDescription("");
        setActivity(null);
        setDifficulty(null);
        setVisibility("private");
        setTags([]);
        setDraft("");
        setTagError("");
        setTagStatus("");
        setErrors({});
        setError("");
        if (file.current) file.current.value = "";
        request.current = null;
        setSelectedFile(null);
        setPreview(null);
        router.push(destination);
        return;
      }
      let code = "unavailable";
      if (
        typeof result === "object" &&
        result &&
        "error" in result &&
        typeof result.error === "string" &&
        t.has(`errors.${result.error}`)
      )
        code = result.error;
      if (
        typeof result === "object" &&
        result &&
        "fieldErrors" in result &&
        result.fieldErrors &&
        typeof result.fieldErrors === "object"
      ) {
        const fields: Partial<Record<FieldName, boolean>> = {};
        for (const field of [
          "name",
          "description",
          "activity",
          "difficulty",
          "tags",
          "file",
        ] as const)
          if (field in result.fieldErrors) fields[field] = true;
        setErrors(fields);
      }
      const segment =
        code === "invalidSegment" &&
        result &&
        typeof result === "object" &&
        "segment" in result &&
        typeof result.segment === "number" &&
        Number.isInteger(result.segment) &&
        result.segment >= 1 &&
        result.segment <= 100
          ? result.segment
          : null;
      const ordinal = new TrackError(
        "invalidFile",
        undefined,
        result && typeof result === "object" ? result : undefined,
      );
      setUncertain(code === "unavailable" || code === "processing");
      announce(code, segment, ordinal.track ?? null);
    } catch {
      setUncertain(true);
      announce("unavailable");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const props = (field: FieldName) => ({
    id: `track-${field}`,
    "aria-invalid": !!errors[field],
    "aria-describedby": `track-${field}-hint track-${field}-error`,
  });
  const fieldError = (field: FieldName) => (
    <FieldError id={`track-${field}-error`}>
      {errors[field] ? t("invalid") : null}
    </FieldError>
  );
  return (
    <form
      aria-label={t("title")}
      noValidate
      onSubmit={submit}
      aria-busy={pending}
      className="mt-8"
    >
      {error && (
        <p
          ref={summary}
          role="alert"
          tabIndex={-1}
          className="mb-6 rounded-md border border-destructive p-4 text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {error === "check"
            ? t("check")
            : errorMessage(error, invalidTrack, invalidSegment)}
          {(error === "unauthorized" || error === "emailUnconfirmed") && (
            <Link href="/settings" className="ml-2 underline">
              {t("settings")}
            </Link>
          )}
        </p>
      )}
      <fieldset disabled={!ready || pending || uncertain} className="min-w-0">
        <FieldGroup>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="track-name">{t("name")}</FieldLabel>
            <Input
              {...props("name")}
              name="name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
            <FieldDescription id="track-name-hint">
              {t("nameHint")}
            </FieldDescription>
            {fieldError("name")}
          </Field>
          <Field data-invalid={!!errors.description}>
            <FieldLabel htmlFor="track-description">
              {t("description")}
            </FieldLabel>
            <Textarea
              {...props("description")}
              name="description"
              required
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <FieldDescription id="track-description-hint">
              {t("descriptionHint")}
            </FieldDescription>
            {fieldError("description")}
          </Field>
          <Field data-invalid={!!errors.file}>
            <FieldLabel htmlFor="track-file">{t("file")}</FieldLabel>
            <Input
              {...props("file")}
              ref={file}
              name="file"
              type="file"
              accept=".gpx,application/gpx+xml"
              required
              onChange={() => {
                request.current = null;
                setError("");
                setSelectedFile(file.current?.files?.[0] ?? null);
              }}
              className="min-h-11 min-w-0 max-w-full file:mr-3"
            />
            <FieldDescription id="track-file-hint">
              {t("fileHint")}
            </FieldDescription>
            {fieldError("file")}
          </Field>
          {selectedFile && (
            <section
              aria-label={t("preview.title")}
              className="space-y-3 rounded-md border p-4"
            >
              <h2 className="text-lg font-semibold">{t("preview.title")}</h2>
              {currentPreview?.value ? (
                <>
                  <p role="status">
                    {t("preview.count", {
                      count: currentPreview.value.trackCount,
                    })}
                  </p>
                  <ol
                    className="max-h-64 list-decimal space-y-1 overflow-auto break-words pl-6"
                    tabIndex={0}
                    aria-label={t("preview.titles")}
                  >
                    {currentPreview.value.titles.map((title, index) => (
                      <li key={index}>{title}</li>
                    ))}
                  </ol>
                  <p>{t("preview.photos")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("preview.shared")}
                  </p>
                </>
              ) : currentPreview?.error ? (
                <>
                  <p role="alert" className="text-destructive">
                    {errorMessage(
                      currentPreview.error.code,
                      currentPreview.error.track ?? null,
                      currentPreview.error.segment ?? null,
                    )}
                  </p>
                  {["processingTimeout", "unavailable"].includes(
                    currentPreview.error.code,
                  ) && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setPreview(null);
                        setPreviewRun((run) => run + 1);
                      }}
                    >
                      {t("preview.retry")}
                    </Button>
                  )}
                </>
              ) : (
                <p role="status">{t("preview.loading")}</p>
              )}
            </section>
          )}
          <Field data-invalid={!!errors.activity}>
            <FieldLabel id="track-activity-label">{t("activity")}</FieldLabel>
            <ActivityGrid
              value={activity}
              onValueChange={setActivity}
              disabled={!ready || pending || uncertain}
              invalid={!!errors.activity}
            />
            <FieldDescription id="track-activity-hint">
              {t("activityHint")}
            </FieldDescription>
            {fieldError("activity")}
          </Field>
          <Field data-invalid={!!errors.difficulty}>
            <FieldLabel id="track-difficulty-label">
              {t("difficulty")}
            </FieldLabel>
            <RadioGroup
              {...props("difficulty")}
              aria-labelledby="track-difficulty-label"
              aria-required="true"
              name="difficulty"
              value={difficulty}
              onValueChange={(value) => setDifficulty(String(value))}
              disabled={!ready || pending || uncertain}
              className="flex flex-wrap gap-3"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <FieldLabel
                  key={value}
                  className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-input px-3"
                >
                  <RadioGroupItem
                    value={String(value)}
                    aria-invalid={!!errors.difficulty}
                  />
                  {value}
                </FieldLabel>
              ))}
            </RadioGroup>
            <FieldDescription id="track-difficulty-hint">
              {t("difficultyHint")}
            </FieldDescription>
            {fieldError("difficulty")}
          </Field>
          <Field data-invalid={!!errors.tags || !!tagError}>
            <FieldLabel htmlFor="track-tags">{t("tags")}</FieldLabel>
            <div className="flex gap-2">
              <Input
                {...props("tags")}
                aria-invalid={!!errors.tags || !!tagError}
                ref={tagInput}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setTagError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={addTag}
                className="min-h-11"
              >
                {t("add")}
              </Button>
            </div>
            <FieldDescription id="track-tags-hint">
              {t("tagHint")}
            </FieldDescription>
            <FieldError id="track-tags-error" aria-live="polite">
              {tagError || (errors.tags ? t("tagInvalid") : null)}
            </FieldError>
            <p role="status" className="sr-only">
              {tagStatus}
            </p>
            {tags.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <li
                    key={tag}
                    className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted pl-3 text-sm"
                  >
                    <span className="min-w-0 break-words">{tag}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label={t("remove", { tag })}
                      onClick={() => {
                        setTags(tags.filter((item) => item !== tag));
                        setTagStatus(t("tagRemoved", { tag }));
                        setTagError("");
                        tagInput.current?.focus();
                      }}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <Field>
            <FieldLabel id="track-visibility-label">
              {t("visibility")}
            </FieldLabel>
            <RadioGroup
              value={visibility}
              onValueChange={(value) => {
                if (value === "private" || value === "public")
                  setVisibility(value);
              }}
              aria-labelledby="track-visibility-label"
              aria-describedby="track-visibility-hint"
            >
              {(["private", "public"] as const).map((value) => (
                <label key={value} className="flex min-h-11 items-center gap-3">
                  <RadioGroupItem value={value} />
                  {t(value)}
                </label>
              ))}
            </RadioGroup>
            <FieldDescription id="track-visibility-hint">
              {t(visibility === "public" ? "publicWarning" : "privateHint")}
            </FieldDescription>
          </Field>
          <PhotoPicker
            disabled={pending || uncertain}
            key={photoGeneration}
            value={photos}
            onChange={setPhotos}
            onBusy={setPhotosBusy}
          />
        </FieldGroup>
      </fieldset>
      {uncertain && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {t("uncertain")}
        </p>
      )}
      <Button
        type="submit"
        disabled={
          !ready ||
          pending ||
          (!uncertain && (photosBusy || !currentPreview?.value))
        }
        className="mt-6 min-h-11"
      >
        {pending ? t("pending") : t("submit")}
      </Button>
      <p role="status" className="mt-4 text-sm text-muted-foreground">
        {pending ? t("pending") : ""}
      </p>
    </form>
  );
}

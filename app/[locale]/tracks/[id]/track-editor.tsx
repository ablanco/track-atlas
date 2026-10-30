"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type RefCallback,
} from "react";
import { PhotoPicker, type PhotoDraft } from "@/components/photo-picker";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  activityTypes,
  tagKey,
  TrackError,
  validateTrackEditInput,
  type TrackInput,
  type TrackFieldErrors,
} from "@/tracks/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ActivityIcon } from "@/components/activity-icon";
import { ExploreEntryHint } from "@/components/explore-entry-hint";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useUnsavedChanges } from "./use-unsaved-changes";

type Field = keyof TrackInput;
type Editor = {
  saved: TrackInput;
  draft: TrackInput;
  editing: boolean;
  pending: boolean;
  photosBusy: boolean;
  canEdit: boolean;
  errors: TrackFieldErrors;
  tagDraft: string;
  setTagDraft: (value: string) => void;
  change: <K extends Field>(key: K, value: TrackInput[K]) => void;
  start: () => void;
  cancel: () => void;
  showDelete: () => void;
  formId: string;
  editRef: RefCallback<HTMLButtonElement>;
};
const Context = createContext<Editor | null>(null);
function useEditor() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing track editor");
  return value;
}

export function TrackEditor({
  id,
  initial,
  initialPhotos,
  canEdit,
  collectionHref,
  children,
}: {
  id: string;
  initialPhotos: PhotoDraft[];
  initial: TrackInput;
  canEdit: boolean;
  collectionHref: string;
  children: ReactNode;
}) {
  const t = useTranslations("Tracks");
  const router = useRouter();
  const formId = useId();
  const [photos, setPhotos] = useState(initialPhotos);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [errors, setErrors] = useState<TrackFieldErrors>({});
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const busy = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const focusEdit = useRef(false);
  const dirty =
    editing &&
    (JSON.stringify(photos) !== JSON.stringify(initialPhotos) ||
      JSON.stringify(draft) !== JSON.stringify(saved) ||
      !!tagDraft.trim());
  const discard = useCallback(() => {
    setEditing(false);
    setTagDraft("");
    setErrors({});
    setMessage("");
  }, []);
  const allowNavigation = useUnsavedChanges(dirty, t("edit.discard"), discard);
  useEffect(() => {
    if (message) alert.current?.focus();
  }, [message, errors]);
  function fail(error: unknown) {
    setSuccess(false);
    if (error instanceof TrackError && error.fieldErrors) {
      setErrors(error.fieldErrors);
      setMessage(t("check"));
    } else {
      const code = error instanceof TrackError ? error.code : "unavailable";
      setMessage(
        t(
          code === "unauthorized"
            ? "edit.unauthorized"
            : code === "notFound"
              ? "notFoundHint"
              : "errors.unavailable",
        ),
      );
    }
    alert.current?.focus();
  }
  async function mutate(remove: boolean) {
    if (busy.current || photosBusy || !editing || !canEdit) return;
    let input: TrackInput | undefined;
    if (!remove) {
      try {
        input = validateTrackEditInput({
          ...draft,
          tags: tagDraft.trim() ? [...draft.tags, tagDraft.trim()] : draft.tags,
        });
      } catch (error) {
        fail(error);
        return;
      }
    }
    busy.current = true;
    setPending(true);
    setMessage("");
    setErrors({});
    try {
      const response = await fetch(`/api/tracks/${id}`, {
        method: remove ? "DELETE" : "PATCH",
        headers: remove ? undefined : { "Content-Type": "application/json" },
        body: remove ? undefined : JSON.stringify({ ...input, photos }),
      });
      if (!response.ok) {
        const value = await response.json();
        throw new TrackError(value.error, value.fieldErrors);
      }
      allowNavigation();
      if (remove) {
        setDeleteOpen(false);
        discard();
        router.replace(collectionHref);
        router.refresh();
      } else {
        const value = validateTrackEditInput(await response.json());
        setSaved(value);
        setDraft(value);
        setTagDraft("");
        setEditing(false);
        setSuccess(true);
        focusEdit.current = true;
        startRefresh(() => router.refresh());
      }
    } catch (error) {
      fail(error);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const value: Editor = {
    saved,
    draft,
    editing,
    pending: pending || refreshing,
    photosBusy,
    canEdit,
    errors,
    tagDraft,
    setTagDraft,
    formId,
    editRef: (button) => {
      if (button && focusEdit.current && !button.disabled) {
        button.focus();
        focusEdit.current = false;
      }
    },
    change: (key, value) => {
      setDraft((old) => ({ ...old, [key]: value }));
      setErrors((old) => ({ ...old, [key]: undefined }));
    },
    start: () => {
      setPhotos(initialPhotos);
      setSaved(initial);
      setDraft(initial);
      setEditing(true);
      setSuccess(false);
      setMessage("");
      setErrors({});
    },
    cancel: () => {
      if (!dirty || window.confirm(t("edit.discard"))) {
        allowNavigation();
        discard();
        focusEdit.current = true;
      }
    },
    showDelete: () => {
      setMessage("");
      setDeleteOpen(true);
    },
  };
  return (
    <Context.Provider value={value}>
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void mutate(false);
        }}
        noValidate
      />
      <div className="space-y-3">
        <p
          ref={alert}
          tabIndex={-1}
          role="alert"
          className={
            message
              ? "rounded-md border border-destructive p-4 text-destructive"
              : "sr-only"
          }
        >
          {message}
        </p>
        {success && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("edit.saved")}
          </p>
        )}
        {children}
        {editing && (
          <PhotoPicker
            disabled={pending || refreshing}
            value={photos}
            onChange={setPhotos}
            onBusy={setPhotosBusy}
            trackId={id}
          />
        )}
      </div>
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!pending) setDeleteOpen(open);
        }}
      >
        <DialogContent
          showCloseButton={!pending}
          initialFocus={(type) =>
            type === "touch"
              ? false
              : document.querySelector<HTMLElement>("[data-delete-cancel]")
          }
        >
          <DialogTitle>
            {t("edit.deleteTitle", { name: saved.name })}
          </DialogTitle>
          <DialogDescription>{t("edit.deleteDescription")}</DialogDescription>
          {deleteOpen && message && (
            <p role="alert" className="text-destructive">
              {message}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              data-delete-cancel
              onClick={() => setDeleteOpen(false)}
            >
              {t("edit.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => void mutate(true)}
            >
              {t(pending ? "edit.deleting" : "edit.deletePermanently")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}

export function TrackEditControls() {
  const e = useEditor();
  const t = useTranslations("Tracks");
  if (!e.canEdit) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {e.editing ? (
        <>
          <Button
            key="save"
            type="submit"
            form={e.formId}
            disabled={e.pending || e.photosBusy}
            className="min-h-11"
          >
            {t(e.pending ? "edit.saving" : "edit.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={e.pending}
            onClick={e.cancel}
            className="min-h-11"
          >
            {t("edit.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={e.pending}
            onClick={e.showDelete}
            className="min-h-11"
          >
            <TrashIcon aria-hidden="true" />
            {t("edit.delete")}
          </Button>
        </>
      ) : (
        <Button
          key="edit"
          ref={(button) => e.editRef(button)}
          type="button"
          variant="outline"
          disabled={e.pending}
          onClick={e.start}
          className="min-h-11"
        >
          <PencilSimpleIcon aria-hidden="true" />
          {t("edit.start")}
        </Button>
      )}
    </div>
  );
}

export function TrackTagsSection() {
  const e = useEditor();
  const t = useTranslations("Tracks");
  if (!e.editing && e.saved.tags.length === 0) return null;
  return (
    <section aria-label={t("tags")} className="space-y-3">
      <h2 className="text-xl font-semibold">{t("tags")}</h2>
      <TrackEditField field="tags" />
    </section>
  );
}

export function TrackActivity() {
  const { saved } = useEditor();
  const t = useTranslations("Tracks");
  return (
    <ExploreEntryHint label={t(`activities.${saved.activity}`)} size="lg">
      <ActivityIcon activity={saved.activity} size="lg" />
    </ExploreEntryHint>
  );
}
export function TrackEditField({ field }: { field: Field }) {
  const e = useEditor();
  const t = useTranslations("Tracks");
  const id = `${e.formId}-${field}`;
  if (!e.editing) {
    switch (field) {
      case "activity":
        return t(`activities.${e.saved.activity}`);
      case "difficulty":
        return `${e.saved.difficulty} / 5`;
      case "visibility":
        return t(e.saved.visibility);
      case "tags":
        return (
          <ul className="flex flex-wrap gap-2">
            {e.saved.tags.map((tag) => (
              <li
                className="max-w-full rounded-md bg-muted px-3 py-2 text-sm break-words"
                key={tag}
              >
                {tag}
              </li>
            ))}
          </ul>
        );
      default:
        return e.saved[field];
    }
  }
  const props = {
    id,
    form: e.formId,
    disabled: e.pending,
    "aria-invalid": !!e.errors[field],
    "aria-describedby": `${id}-hint ${id}-error`,
  };
  const label = t(field);
  const selectClass =
    "min-h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <span className="block space-y-2 text-base font-normal tracking-normal">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {field === "name" ? (
        <Input
          {...props}
          autoFocus
          value={e.draft.name}
          required
          onChange={(event) => e.change("name", event.target.value)}
          className="min-h-11"
        />
      ) : field === "description" ? (
        <Textarea
          {...props}
          value={e.draft.description}
          required
          rows={5}
          onChange={(event) => e.change("description", event.target.value)}
        />
      ) : field === "tags" ? (
        <TagsInput id={id} />
      ) : (
        <select
          {...props}
          className={selectClass}
          value={e.draft[field]}
          onChange={(event) => {
            if (field === "difficulty")
              e.change(field, Number(event.target.value));
            else if (field === "activity")
              e.change(field, event.target.value as TrackInput["activity"]);
            else
              e.change(field, event.target.value as TrackInput["visibility"]);
          }}
        >
          {field === "activity"
            ? activityTypes.map((activity) => (
                <option key={activity} value={activity}>
                  {t(`activities.${activity}`)}
                </option>
              ))
            : field === "difficulty"
              ? [1, 2, 3, 4, 5].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))
              : ["private", "public"].map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {t(visibility)}
                  </option>
                ))}
        </select>
      )}
      <span id={`${id}-hint`} className="block text-sm text-muted-foreground">
        {field === "visibility"
          ? t(
              e.draft.visibility === "public"
                ? "publicWarning"
                : "edit.privateWarning",
            )
          : t(field === "tags" ? "tagHint" : `${field}Hint`)}
      </span>
      <span id={`${id}-error`} className="block text-sm text-destructive">
        {e.errors[field]
          ? t(field === "tags" ? "tagInvalid" : "invalid")
          : null}
      </span>
    </span>
  );
}
function TagsInput({ id }: { id: string }) {
  const e = useEditor();
  const t = useTranslations("Tracks");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  function add() {
    const label = e.tagDraft.trim();
    if (!label || [...label].length > 30 || e.draft.tags.length >= 10) {
      setError(t("tagInvalid"));
      return;
    }
    if (e.draft.tags.some((tag) => tagKey(tag) === tagKey(label))) {
      setError(t("duplicate"));
      return;
    }
    e.change("tags", [...e.draft.tags, label]);
    e.setTagDraft("");
    setError("");
    input.current?.focus();
  }
  return (
    <span className="block space-y-2">
      <span className="flex gap-2">
        <Input
          ref={input}
          id={id}
          value={e.tagDraft}
          disabled={e.pending}
          aria-invalid={!!error || !!e.errors.tags}
          aria-describedby={`${id}-hint ${id}-error ${id}-draft-error`}
          onChange={(event) => {
            e.setTagDraft(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              add();
            }
          }}
          className="min-h-11"
        />
        <Button
          type="button"
          variant="outline"
          disabled={e.pending}
          onClick={add}
          className="min-h-11"
        >
          {t("add")}
        </Button>
      </span>
      <span
        id={`${id}-draft-error`}
        role="status"
        className="block text-sm text-destructive"
      >
        {error}
      </span>
      <span className="flex flex-wrap gap-2">
        {e.draft.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex max-w-full items-center rounded-md bg-muted pl-3 text-sm"
          >
            <span className="min-w-0 break-words">{tag}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              disabled={e.pending}
              aria-label={t("remove", { tag })}
              onClick={() =>
                e.change(
                  "tags",
                  e.draft.tags.filter((value) => value !== tag),
                )
              }
            >
              <XIcon aria-hidden="true" />
            </Button>
          </span>
        ))}
      </span>
    </span>
  );
}

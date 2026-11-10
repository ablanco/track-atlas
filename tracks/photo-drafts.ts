export type PhotoDraft = { id: string; caption: string };
export type PhotoRow = {
  key: string;
  caption: string;
  preview?: string;
  status: "queued" | "uploading" | "failed" | "ready";
  progress: number;
  expired?: boolean;
};
type Entry = PhotoRow & { file?: File; id?: string; expiresAt?: number };
/** Internal platform seam: browser resources and transport, never draft rules. */
export type PhotoPlatform = {
  now: () => number;
  key: () => string;
  preview: (file: File) => string;
  revoke: (url: string) => void;
  upload: (
    file: File,
    progress: (value: number) => void,
    finish: (status: number, body: string) => void,
  ) => () => void;
};
const fileId =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Mutable photos own their identities and resources; submission() returns a detached value. */
export class PhotoDrafts {
  private entries: Entry[] = [];
  private baseline = "[]";
  private active = false;
  private requests = new Map<string, { cancel?: () => void }>();
  private listeners = new Set<() => void>();
  private state: { rows: PhotoRow[]; ready: boolean; dirty: boolean } = {
    rows: [],
    ready: true,
    dirty: false,
  };
  constructor(
    initial: PhotoDraft[],
    private platform: PhotoPlatform,
    private trackId?: string,
  ) {
    this.reset(initial);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.state = {
      rows: this.entries.map((p) => ({
        key: p.key,
        caption: p.caption,
        preview:
          p.preview ??
          (!p.file && this.trackId
            ? `/api/tracks/${this.trackId}/photos/${p.id}?size=thumbnail`
            : undefined),
        status: p.status,
        progress: p.progress,
        expired: p.expired,
      })),
      ready: this.entries.every((p) => p.status === "ready"),
      dirty:
        JSON.stringify(
          this.entries.map((p) => ({ id: p.id ?? p.key, caption: p.caption })),
        ) !== this.baseline,
    };
    this.listeners.forEach((listener) => listener());
  }
  submission(): PhotoDraft[] | null {
    this.expire();
    return this.state.ready
      ? this.entries.map((p) => ({ id: p.id!, caption: p.caption }))
      : null;
  }
  reset(initial: PhotoDraft[] = []) {
    this.release();
    this.entries = initial.map((p) => ({
      ...p,
      key: p.id,
      status: "ready",
      progress: 100,
    }));
    this.baseline = JSON.stringify(initial);
    this.publish();
  }
  add(files: Iterable<File>) {
    this.entries.push(
      ...Array.from(files)
        .slice(0, 20 - this.entries.length)
        .map((file) => ({
          key: this.platform.key(),
          file,
          preview: this.active ? this.platform.preview(file) : undefined,
          caption: "",
          status: "queued" as const,
          progress: 0,
        })),
    );
    this.publish();
    this.schedule();
  }
  caption(key: string, caption: string) {
    this.entries = this.entries.map((p) =>
      p.key === key ? { ...p, caption } : p,
    );
    this.publish();
  }
  move(key: string, target: number) {
    const index = this.entries.findIndex((p) => p.key === key);
    if (index < 0 || target < 0 || target >= this.entries.length) return;
    const [entry] = this.entries.splice(index, 1);
    this.entries.splice(target, 0, entry);
    this.publish();
  }
  remove(key: string) {
    const entry = this.entries.find((p) => p.key === key);
    const request = this.requests.get(key);
    this.requests.delete(key);
    request?.cancel?.();
    if (entry?.preview) this.platform.revoke(entry.preview);
    this.entries = this.entries.filter((p) => p.key !== key);
    this.publish();
    this.schedule();
  }
  retry(key: string) {
    this.entries = this.entries.map((p) =>
      p.key === key && p.file && p.status === "failed"
        ? {
            ...p,
            id: undefined,
            expiresAt: undefined,
            expired: false,
            status: "queued",
            progress: 0,
          }
        : p,
    );
    this.publish();
    this.schedule();
  }
  expire = () => {
    let changed = false;
    this.entries = this.entries.map((p) => {
      if (
        p.status !== "ready" ||
        p.expiresAt === undefined ||
        p.expiresAt > this.platform.now()
      )
        return p;
      changed = true;
      return { ...p, status: "failed", progress: 0, expired: true };
    });
    if (changed) this.publish();
  };
  resume() {
    if (this.active) return;
    this.active = true;
    this.entries = this.entries.map((p) =>
      p.file ? { ...p, preview: this.platform.preview(p.file) } : p,
    );
    this.expire();
    this.publish();
    this.schedule();
  }
  suspend() {
    this.active = false;
    this.release();
    this.entries = this.entries.map((p) => ({
      ...p,
      preview: undefined,
      status: p.status === "uploading" ? "failed" : p.status,
    }));
    this.publish();
  }
  private release() {
    const requests = [...this.requests.values()];
    this.requests.clear();
    requests.forEach((request) => request.cancel?.());
    this.entries.forEach((p) => {
      if (p.preview) this.platform.revoke(p.preview);
    });
  }
  private schedule() {
    if (!this.active) return;
    for (const entry of this.entries) {
      if (this.requests.size >= 2) break;
      if (entry.status !== "queued" || !entry.file) continue;
      const request: { cancel?: () => void } = {};
      this.requests.set(entry.key, request);
      entry.status = "uploading";
      const expiresAt = this.platform.now() + 14 * 60 * 1000;
      const current = () => this.requests.get(entry.key) === request;
      const finish = (status: number, body: string) => {
        if (!current()) return;
        let id: string | undefined;
        try {
          const value: unknown = JSON.parse(body);
          if (
            status === 201 &&
            value &&
            typeof value === "object" &&
            "id" in value &&
            typeof value.id === "string" &&
            fileId.test(value.id)
          )
            id = value.id;
        } catch {}
        this.requests.delete(entry.key);
        this.entries = this.entries.map((p) =>
          p.key === entry.key
            ? {
                ...p,
                id,
                expiresAt: id ? expiresAt : undefined,
                status: id ? "ready" : "failed",
                progress: id ? 100 : p.progress,
              }
            : p,
        );
        this.expire();
        this.publish();
        this.schedule();
      };
      this.publish();
      try {
        request.cancel = this.platform.upload(
          entry.file,
          (progress) => {
            if (!current()) return;
            this.entries = this.entries.map((p) =>
              p.key === entry.key ? { ...p, progress } : p,
            );
            this.publish();
          },
          finish,
        );
      } catch {
        finish(0, "");
      }
    }
  }
}

"use client";
import { useEffect, useState, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { activityTypes } from "@/tracks/validation";
import {
  adminModels,
  adminEditableFields as editable,
  type AdminModel,
} from "@/admin/models";
import type {
  AdminPage,
  AdminRecord,
  AdminValue,
  AdminMutationRequest,
} from "@/admin/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";

type Snapshot = Partial<AdminPage> & {
  record?: AdminRecord;
  data?: unknown[];
  cards?: { model: string; filters: Record<string, string>; count: number }[];
  storage?: { files: number; bytes: string };
};
const columns: Record<string, string[]> = {
  users: [
    "first_name",
    "last_name",
    "email",
    "active",
    "admin",
    "email_confirmed",
    "created_at",
  ],
  tracks: [
    "name",
    "owner_id",
    "activity",
    "visibility",
    "distance_meters",
    "created_at",
  ],
  stored_files: [
    "id",
    "owner_id",
    "purpose",
    "status",
    "byte_size",
    "created_at",
  ],
  track_lists: ["name", "owner_id", "membership_count", "created_at"],
  track_list_memberships: ["list_id", "track_id", "created_at"],
  sessions: ["user_id", "expires_at", "created_at"],
  account_action_tokens: [
    "user_id",
    "purpose",
    "expires_at",
    "consumed_at",
    "revoked_at",
  ],
};

const control =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm";
export function AdminPanel() {
  const pathname = usePathname(),
    query = useSearchParams();
  return <AdminPanelState key={pathname + "?" + query.toString()} />;
}
function AdminPanelState() {
  const t = useTranslations("Admin"),
    locale = useLocale(),
    router = useRouter(),
    pathname = usePathname(),
    query = useSearchParams();
  const parts = pathname.split("/").filter(Boolean),
    model = parts[1] as AdminModel | undefined,
    id = parts[2] ? decodeURIComponent(parts[2]) : undefined;
  const valid = !!model && Object.hasOwn(adminModels, model),
    registry = valid ? adminModels[model!] : undefined;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [revision, setRevision] = useState(0),
    [pending, setPending] = useState(false),
    [confirm, setConfirm] = useState<AdminMutationRequest | null>(null),
    [notice, setNotice] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const mutationRequest = useRef<AbortController | null>(null);
  const key = pathname + "?" + query.toString();
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const clear = () => {
      mutationRequest.current?.abort();
      setPending(false);
      setSnapshot(null);
      setSelected([]);
      setConfirm(null);
      setLabels({});
    };
    clear();
    // Discard errors with the authorized snapshot whenever the request changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError("");
    async function load() {
      try {
        const endpoint = model
          ? `/api/admin/${encodeURIComponent(model)}${id ? "/" + encodeURIComponent(id) : ""}`
          : "/api/admin/overview";
        const params = id
          ? new URLSearchParams({
              page: query.get("page") ?? "1",
              pageSize: query.get("pageSize") ?? "25",
            })
          : new URLSearchParams(query.toString());
        const response = await fetch(endpoint + "?" + params, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30000),
          ]),
        });
        const body = await response.json();
        if (!response.ok) throw Error(body.error ?? "unavailable");
        if (!alive) return;
        setSnapshot(body);
        const records: AdminRecord[] =
          body.rows ?? (body.record ? [body.record] : []);
        const related = records
          .flatMap((r) => r.related)
          .filter((r) => ["users", "track_lists", "tracks"].includes(r.model));
        const names: Record<string, string> = {};
        await Promise.all(
          related.map(async (r) => {
            const response = await fetch(
              `/api/admin/${r.model}/${encodeURIComponent(r.id)}`,
              { cache: "no-store", signal: controller.signal },
            );
            if (response.status === 401 || response.status === 403)
              throw Error("forbidden");
            if (response.ok) {
              const { record } = await response.json();
              const v = record.values;
              names[r.model + r.id] = String(
                v.display_name ||
                  v.name ||
                  [v.first_name, v.last_name].filter(Boolean).join(" ") ||
                  v.email ||
                  r.id,
              );
            }
          }),
        );
        if (alive) setLabels(names);
      } catch (e) {
        if (alive && !controller.signal.aborted) {
          setSnapshot(null);
          setError(e instanceof Error ? e.message : "unavailable");
        }
      }
    }
    void load();
    const hidden = () => {
      if (document.hidden) {
        alive = false;
        controller.abort();
        clear();
      } else {
        setRevision((v) => v + 1);
        router.refresh();
      }
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        clear();
        setRevision((v) => v + 1);
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pageshow", restore);
    return () => {
      alive = false;
      controller.abort();
      mutationRequest.current?.abort();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pageshow", restore);
    };
  }, [key, revision, model, id, query, router]);
  const message = (code: string) =>
    t.has("errors." + code) ? t("errors." + code) : t("errors.unavailable");
  const field = (name: string) =>
    t.has("fields." + name) ? t("fields." + name) : name.replaceAll("_", " ");
  const modelName = (name: string) =>
    t.has("models." + name) ? t("models." + name) : name;
  const value = (v: AdminValue | undefined, fieldName?: string) =>
    v == null
      ? "—"
      : typeof v === "boolean"
        ? t(v ? "yes" : "no")
        : typeof v === "object"
          ? JSON.stringify(v)
          : typeof v === "string" &&
              ["activity", "visibility", "status", "state", "purpose"].includes(
                fieldName ?? "",
              ) &&
              t.has("options." + v)
            ? t("options." + v)
            : String(v);
  function href(changes: Record<string, string>) {
    const next = new URLSearchParams(query.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return pathname + "?" + next;
  }
  async function mutate() {
    if (!confirm) return;
    const controller = new AbortController();
    mutationRequest.current = controller;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin/mutations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Locale": locale,
        },
        body: JSON.stringify(confirm),
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(30000),
        ]),
      });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw Error(body.error ?? "unavailable");
      setConfirm(null);
      setSelected([]);
      setRevision((v) => v + 1);
      setNotice(body.warning ? t("deliveryWarning") : t("saved"));
    } catch (e) {
      if (controller.signal.aborted) return;
      const code = e instanceof Error ? e.message : "unavailable";
      setError(code);
      if (["unauthorized", "forbidden"].includes(code)) {
        setSnapshot(null);
        setConfirm(null);
        setSelected([]);
        router.refresh();
      }
    } finally {
      if (mutationRequest.current === controller) setPending(false);
    }
  }
  const rowLabel = (r: AdminRecord) =>
    String(r.values.name || r.values.email || r.values.id || r.id);
  const back = query.get("back") ?? "";
  return (
    <div className="mx-auto grid w-full max-w-screen-2xl gap-8 px-4 py-8 md:grid-cols-[220px_minmax(0,1fr)] md:px-8">
      <aside className="rounded-xl border bg-card p-4 md:sticky md:top-6 md:self-start">
        <div className="mb-4 flex items-center gap-2 font-semibold">
          <SquaresFourIcon aria-hidden size={22} />
          {t("title")}
        </div>
        <details open className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground md:hidden">
            {t("navigation")}
          </summary>
          <nav
            aria-label={t("navigation")}
            className="mt-3 flex flex-col gap-1"
          >
            <Link
              prefetch={false}
              href="/admin"
              aria-current={!model ? "page" : undefined}
              className="rounded-lg p-2 text-sm hover:bg-muted aria-[current=page]:bg-muted"
            >
              {t("overview")}
            </Link>
            {Object.keys(adminModels).map((name) => (
              <Link
                prefetch={false}
                key={name}
                href={"/admin/" + name}
                aria-current={model === name ? "page" : undefined}
                className="rounded-lg p-2 text-sm hover:bg-muted aria-[current=page]:bg-muted"
              >
                {modelName(name)}
              </Link>
            ))}
          </nav>
        </details>
      </aside>
      <section className="min-w-0 space-y-6" aria-busy={!snapshot && !error}>
        <header>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {t("title")}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {model ? modelName(model) : t("overview")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
        </header>
        {error && (
          <p role="alert" className="rounded-lg border border-destructive p-4">
            {message(error)}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {!snapshot && !error && <p role="status">{t("loading")}</p>}
        {snapshot?.cards && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {snapshot.cards.map((card, i) => (
                <Link
                  prefetch={false}
                  href={
                    "/admin/" +
                    card.model +
                    "?" +
                    new URLSearchParams(card.filters)
                  }
                  key={i}
                  className="rounded-xl border bg-card p-5 shadow-sm transition-colors hover:bg-muted"
                >
                  <p className="text-sm text-muted-foreground">
                    {modelName(card.model)}
                  </p>
                  <p className="my-3 text-3xl font-semibold tabular-nums">
                    {card.count.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Object.entries(card.filters)
                      .map(
                        ([k, v]) =>
                          field(k) +
                          ": " +
                          (v === "true"
                            ? t("yes")
                            : v === "false"
                              ? t("no")
                              : value(v, k)),
                      )
                      .join(", ") || t("all")}
                  </p>
                </Link>
              ))}
            </div>
            <p className="rounded-xl border bg-card p-5">
              {t("storage", {
                files: snapshot.storage?.files ?? 0,
                bytes: Number(snapshot.storage?.bytes ?? 0).toLocaleString(),
              })}
            </p>
          </>
        )}
        {registry && !id && (
          <form
            key={key}
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget),
                params = new URLSearchParams();
              for (const [k, v] of data) if (v) params.set(k, String(v));
              router.push(pathname + "?" + params);
            }}
          >
            <label className="grid gap-1 text-xs">
              {t("search")}
              <input
                className={control}
                name="q"
                maxLength={200}
                defaultValue={query.get("q") ?? ""}
              />
            </label>
            {registry.filters.map((f) => (
              <label key={f} className="grid gap-1 text-xs">
                {field(f)}
                <input
                  className={control}
                  name={f}
                  defaultValue={query.get(f) ?? ""}
                />
              </label>
            ))}
            <label className="grid gap-1 text-xs">
              {t("sort")}
              <select
                className={control}
                name="sort"
                defaultValue={query.get("sort") ?? "created_at"}
              >
                {registry.fields.map((f) => (
                  <option key={f} value={f}>
                    {field(f)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              {t("direction")}
              <select
                name="direction"
                className={control}
                defaultValue={query.get("direction") ?? "desc"}
              >
                <option value="desc">{t("descending")}</option>
                <option value="asc">{t("ascending")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              {t("pageSize")}
              <select
                className={control}
                name="pageSize"
                defaultValue={query.get("pageSize") ?? "25"}
              >
                {[25, 50, 100].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <Button type="submit">{t("apply")}</Button>
            <Link href={pathname} prefetch={false}>
              {t("reset")}
            </Link>
          </form>
        )}
        {snapshot?.rows && registry && (
          <>
            {registry.operation && registry.operation !== "update" && (
              <div className="flex items-center gap-3">
                <span className="text-sm">
                  {t("selected", { count: selected.length })}
                </span>
                <Button
                  variant="destructive"
                  disabled={!selected.length}
                  onClick={() =>
                    setConfirm({
                      model: model!,
                      operation: registry.operation as "delete" | "revoke",
                      ids: selected,
                    })
                  }
                >
                  {t(registry.operation)}
                </Button>
              </div>
            )}
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    {registry.operation && registry.operation !== "update" && (
                      <th className="p-3">
                        <input
                          type="checkbox"
                          aria-label={t("selectPage")}
                          checked={
                            !!snapshot.rows.length &&
                            selected.length ===
                              snapshot.rows.filter((r) => r.selectable).length
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? snapshot
                                    .rows!.filter((r) => r.selectable)
                                    .map((r) => r.id)
                                : [],
                            )
                          }
                        />
                      </th>
                    )}
                    {(columns[model!] ?? registry.fields).map((f) => (
                      <th className="p-3 font-medium" key={f}>
                        {field(f)}
                      </th>
                    ))}
                    <th className="p-3">{t("details")}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.rows.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-muted/40">
                      {registry.operation &&
                        registry.operation !== "update" && (
                          <td className="p-3">
                            {r.selectable && (
                              <input
                                type="checkbox"
                                aria-label={t("selectRecord", {
                                  name: rowLabel(r),
                                })}
                                checked={selected.includes(r.id)}
                                onChange={(e) =>
                                  setSelected(
                                    e.target.checked
                                      ? [...selected, r.id]
                                      : selected.filter((v) => v !== r.id),
                                  )
                                }
                              />
                            )}
                          </td>
                        )}
                      {(columns[model!] ?? registry.fields).map((f) => {
                        const rel = r.related.find((x) => x.field === f);
                        return (
                          <td
                            key={f}
                            className="max-w-64 truncate p-3"
                            title={value(r.values[f], f)}
                          >
                            {rel ? (
                              <Link
                                prefetch={false}
                                className="underline underline-offset-4"
                                href={
                                  "/admin/" +
                                  rel.model +
                                  "/" +
                                  encodeURIComponent(rel.id)
                                }
                              >
                                {labels[rel.model + rel.id] ??
                                  value(r.values[f], f)}
                              </Link>
                            ) : (
                              value(r.values[f], f)
                            )}
                          </td>
                        );
                      })}
                      <td className="p-3">
                        <Link
                          prefetch={false}
                          className="underline"
                          href={
                            pathname +
                            "/" +
                            encodeURIComponent(r.id) +
                            "?" +
                            new URLSearchParams({ back: query.toString() })
                          }
                        >
                          {t("details")}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!snapshot.rows.length && (
                <p className="p-8 text-center text-muted-foreground">
                  {t("empty")}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <Link
                prefetch={false}
                aria-disabled={snapshot.page === 1}
                href={href({
                  page: String(Math.max(1, (snapshot.page ?? 1) - 1)),
                })}
              >
                {t("previous")}
              </Link>
              <span>
                {t("pagination", {
                  page: snapshot.page ?? 1,
                  total: snapshot.total ?? 0,
                })}
              </span>
              <Link
                prefetch={false}
                href={href({ page: String((snapshot.page ?? 1) + 1) })}
              >
                {t("next")}
              </Link>
            </div>
          </>
        )}
        {snapshot?.record && (
          <>
            <Link
              className="text-sm underline"
              prefetch={false}
              href={"/admin/" + model + (back ? "?" + back : "")}
            >
              {t("back")}
            </Link>
            <dl className="divide-y rounded-xl border bg-card px-5">
              {Object.entries(snapshot.record.values).map(([f, v]) => {
                const rel = snapshot.record!.related.find((r) => r.field === f);
                return (
                  <div
                    className="grid gap-2 py-4 sm:grid-cols-[180px_minmax(0,1fr)]"
                    key={f}
                  >
                    <dt className="text-sm text-muted-foreground">
                      {field(f)}
                    </dt>
                    <dd className="break-all text-sm">
                      {rel ? (
                        <Link
                          prefetch={false}
                          className="underline"
                          href={
                            "/admin/" +
                            rel.model +
                            "/" +
                            encodeURIComponent(rel.id)
                          }
                        >
                          {labels[rel.model + rel.id] ?? value(v, f)}
                        </Link>
                      ) : (
                        value(v, f)
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {editable[model!] && (
              <EditForm
                key={snapshot.record.id + revision}
                model={model!}
                record={snapshot.record}
                onSave={(values) =>
                  setConfirm({
                    model: model!,
                    operation: "update",
                    ids: [snapshot.record!.id],
                    values,
                  })
                }
              />
            )}
            {registry?.operation && registry.operation !== "update" && (
              <Button
                variant="destructive"
                onClick={() =>
                  setConfirm({
                    model: model!,
                    operation: registry.operation as "delete" | "revoke",
                    ids: [snapshot.record!.id],
                  })
                }
              >
                {t(registry.operation)}
              </Button>
            )}
            {snapshot.data && (
              <>
                <pre className="max-h-96 overflow-auto rounded-xl border bg-muted p-4 text-xs">
                  {JSON.stringify(snapshot.data, null, 2)}
                </pre>
                <div className="flex gap-6">
                  <Link
                    prefetch={false}
                    href={href({
                      page: String(Math.max(1, (snapshot.page ?? 1) - 1)),
                    })}
                  >
                    {t("previous")}
                  </Link>
                  <span>{snapshot.page}</span>
                  {snapshot.data.length === (snapshot.pageSize ?? 25) && (
                    <Link
                      prefetch={false}
                      href={href({ page: String((snapshot.page ?? 1) + 1) })}
                    >
                      {t("next")}
                    </Link>
                  )}
                </div>
              </>
            )}
          </>
        )}
        {confirm && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open && !pending) setConfirm(null);
            }}
          >
            <DialogContent
              aria-labelledby="admin-confirm-title"
              closeButtonProps={{ disabled: pending }}
            >
              <h2 id="admin-confirm-title" className="text-xl font-semibold">
                {t("confirm")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  confirm.operation === "update"
                    ? "updateConsequences"
                    : confirm.operation === "revoke"
                      ? "revokeConsequences"
                      : "deleteConsequences",
                )}
              </p>
              <ul className="max-h-48 overflow-auto text-sm">
                {confirm.ids.map((id) => (
                  <li key={id} className="break-all">
                    {rowLabel(
                      snapshot?.rows?.find((r) => r.id === id) ??
                        snapshot?.record ?? {
                          id,
                          values: {},
                          related: [],
                          selectable: false,
                        },
                    )}
                  </li>
                ))}
              </ul>
              {confirm.values && (
                <dl className="max-h-48 overflow-auto text-sm">
                  {Object.entries(confirm.values).map(([k, v]) => (
                    <div key={k}>
                      <dt>{field(k)}</dt>
                      <dd>{value(v, k)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {error && <p role="alert">{message(error)}</p>}
              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => setConfirm(null)}
                >
                  {t("cancel")}
                </Button>
                <Button disabled={pending} onClick={() => void mutate()}>
                  {t(pending ? "saving" : "confirm")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </section>
    </div>
  );
}
function EditForm({
  model,
  record,
  onSave,
}: {
  model: string;
  record: AdminRecord;
  onSave(values: Record<string, AdminValue>): void;
}) {
  const t = useTranslations("Admin");
  const tags = Array.isArray(record.values.tags)
    ? record.values.tags.map(String)
    : [];

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget),
          values: Record<string, AdminValue> = {};
        for (const f of editable[model]) {
          const v = String(data.get(f) ?? "");
          values[f] = ["active", "admin"].includes(f)
            ? v === "true"
            : f === "difficulty"
              ? Number(v)
              : f === "tags"
                ? v
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : f === "display_name"
                  ? v || null
                  : v;
        }
        onSave(values);
      }}
    >
      <h2 className="text-lg font-semibold">{t("edit")}</h2>
      {editable[model].map((f) => (
        <label key={f} className="grid gap-2 text-sm">
          {t("fields." + f)}
          {["active", "admin"].includes(f) ? (
            <select
              className={control}
              name={f}
              defaultValue={String(record.values[f])}
            >
              <option value="true">{t("yes")}</option>
              <option value="false">{t("no")}</option>
            </select>
          ) : f === "activity" || f === "visibility" ? (
            <select
              className={control}
              name={f}
              defaultValue={String(record.values[f])}
            >
              {(f === "activity" ? activityTypes : ["private", "public"]).map(
                (option) => (
                  <option key={option} value={option}>
                    {t("options." + option)}
                  </option>
                ),
              )}
            </select>
          ) : f === "tags" ? (
            <textarea
              key={tags.join("\n")}
              className={control}
              name={f}
              defaultValue={tags.join("\n")}
              placeholder={t("tagsHint")}
            />
          ) : (
            <input
              className={control}
              name={f}
              type={
                f === "email"
                  ? "email"
                  : f === "date_of_birth"
                    ? "date"
                    : f === "difficulty"
                      ? "number"
                      : "text"
              }
              min={f === "difficulty" ? 1 : undefined}
              max={f === "difficulty" ? 5 : undefined}
              defaultValue={String(record.values[f] ?? "").slice(
                0,
                f === "date_of_birth" ? 10 : undefined,
              )}
            />
          )}
        </label>
      ))}
      <Button type="submit">{t("save")}</Button>
    </form>
  );
}

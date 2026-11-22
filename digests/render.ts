import "server-only";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import pt from "../messages/pt.json";
import de from "../messages/de.json";
import it from "../messages/it.json";
import type { SupportedLocale } from "../i18n/locales";
const catalogs = { en, es, fr, pt, de, it };
export const digestCopy = (locale: SupportedLocale) => catalogs[locale];
export const plain = (text: string) =>
  [...text.replace(/[\r\n\t{}\u0000-\u001f\u007f]/g, " ")]
    .slice(0, 160)
    .join("");
export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export type DigestEntry = {
  id: string;
  uploaderId: string;
  displayName: string;
  title: string;
  activity: string;
  distanceMeters: number;
  ascentMeters: number | null;
};
export function renderDigestEmail(input: {
  locale: SupportedLocale;
  origin: string;
  entries: DigestEntry[];
  total: number;
  uploaders: { id: string; name: string }[];
  token: string;
}) {
  const { locale } = input;
  const t = (
    key: keyof typeof en.DigestEmail,
    args: Record<string, number> = {},
  ) =>
    Object.entries(args).reduce(
      (text, [key, value]) => text.replace(`{${key}}`, String(value)),
      catalogs[locale].DigestEmail[key],
    );
  const activities: Record<string, string> = catalogs[locale].Tracks.activities;
  const url = (path: string) => new URL(`/${locale}${path}`, input.origin).href;
  const following = url("/following");
  const optOut = new URL(url("/digest-opt-out"));
  optOut.searchParams.set("token", input.token);
  let count = Math.min(50, input.entries.length);
  for (;;) {
    const lines = [t("intro", { total: input.total })];
    const html = [
      `<h1>${escapeHtml(t("subject"))}</h1><p>${escapeHtml(lines[0])}</p>`,
    ];
    let previous = "";
    for (const e of input.entries.slice(0, count)) {
      if (e.uploaderId !== previous) {
        const name = plain(e.displayName);
        lines.push(name);
        html.push(`<h2>${escapeHtml(name)}</h2>`);
        previous = e.uploaderId;
      }
      const label = activities[e.activity] ?? plain(e.activity);
      const metrics = `${label} · ${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(e.distanceMeters / 1000)} km${e.ascentMeters === null ? "" : ` · ${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(e.ascentMeters)} m ↑`}`;
      const link = url(`/tracks/${e.id}`),
        title = plain(e.title);
      lines.push(`${title} — ${metrics}\n${link}`);
      html.push(
        `<p><a href="${escapeHtml(link)}">${escapeHtml(title)}</a> — ${escapeHtml(metrics)}</p>`,
      );
    }
    if (input.total > count) {
      const overflow = t("overflow", { count: input.total - count });
      lines.push(overflow);
      html.push(`<p>${escapeHtml(overflow)}</p>`);
      for (const u of input.uploaders.slice(0, 10)) {
        const link = url(`/users/${u.id}/tracks`),
          name = plain(u.name);
        lines.push(`${name}: ${link}`);
        html.push(
          `<p><a href="${escapeHtml(link)}">${escapeHtml(name)}</a></p>`,
        );
      }
      lines.push(`${t("collection")}: ${url("/explore")}`);
      html.push(
        `<p><a href="${escapeHtml(url("/explore"))}">${escapeHtml(t("collection"))}</a></p>`,
      );
    }
    lines.push(
      `${t("following")}: ${following}`,
      `${t("optOut")}: ${optOut.href}`,
    );
    html.push(
      `<p><a href="${escapeHtml(following)}">${escapeHtml(t("following"))}</a></p><p><a href="${escapeHtml(optOut.href)}">${escapeHtml(t("optOut"))}</a></p>`,
    );
    const result = {
      subject: t("subject"),
      text: lines.join("\n\n"),
      html: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"></head><body>${html.join("")}</body></html>`,
    };
    if (Buffer.byteLength(result.html + result.text) <= 128 * 1024)
      return result;
    if (!count) throw Error("Digest content unavailable");
    count--;
  }
}

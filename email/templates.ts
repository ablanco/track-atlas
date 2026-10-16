import "server-only";
import en from "../messages/en.json";
import es from "../messages/es.json";
import type { AccountEmailPurpose, EmailLocale, EmailMessage } from "./types";
const escape = (value: string) => value.replace(/[&<>"'{}]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "{": "&#123;", "}": "&#125;" })[c]!);
export function buildAccountEmailUrl(origin: string, locale: EmailLocale, purpose: AccountEmailPurpose, token: string): string {
  const url = new URL(`/${locale}/${purpose === "email-confirmation" ? "confirm-email" : "reset-password"}`, origin);
  url.searchParams.set("token", token); return url.href;
}
export function renderAccountEmail(purpose: AccountEmailPurpose, locale: EmailLocale, firstName: string, url: string): Pick<EmailMessage, "subject" | "html" | "text"> {
  const labels = (locale === "es" ? es : en).AccountEmails;
  const copy = purpose === "email-confirmation" ? labels.confirmation : labels.reset;
  // Neutralize template delimiters in plain text too: account text is never provider code.
  const name = firstName.replace(/[\r\n]/g, " ").replace(/[{}]/g, c => c === "{" ? "（" : "）");
  const greeting = `${labels.greeting} ${name},`;
  return { subject: copy.subject, text: `${greeting}\n\n${copy.body}\n\n${copy.button}: ${url}\n\n${copy.expiry}\n\n${copy.ignore}`,
    html: `<!DOCTYPE html><html lang="${locale}"><head><meta charset="utf-8"></head><body style="margin:0;background:#f7f7f0;color:#233c33;font-family:Arial,sans-serif"><table role="presentation" style="width:100%;max-width:560px;margin:auto;padding:28px;background:#fff"><tr><td><p style="font-weight:bold;letter-spacing:2px">TRACK ATLAS</p><h1 style="font-size:26px">${escape(copy.subject)}</h1><p>${escape(greeting)}</p><p>${escape(copy.body)}</p><p style="margin:28px 0"><a href="${escape(url)}" style="background:#2e6348;color:#fff;padding:14px 18px;border-radius:6px;display:inline-block;text-decoration:none">${escape(copy.button)}</a></p><p>${escape(copy.expiry)}</p><p>${escape(copy.ignore)}</p><hr><p style="font-size:13px">${escape(labels.fallback)}<br><a style="color:#2e6348;word-break:break-all" href="${escape(url)}">${escape(url)}</a></p></td></tr></table></body></html>` };
}

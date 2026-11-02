import "server-only";
import type { EmailLocale, EmailMessage } from "./types";

export type DiscussionNotificationKind = "comment" | "reply";
const copy = {
  en: {
    comment: "New comment on your track",
    reply: "New reply to your comment",
    commentBody: "left a comment on",
    replyBody: "replied to your comment on",
    button: "View comment",
    deactivated: "Deactivated user",
  },
  es: {
    comment: "Nuevo comentario en tu recorrido",
    reply: "Nueva respuesta a tu comentario",
    commentBody: "ha dejado un comentario en",
    replyBody: "ha respondido a tu comentario en",
    button: "Ver comentario",
    deactivated: "Usuario desactivado",
  },
};
const plain = (value: string) =>
  value
    .replace(/[\r\n]/g, " ")
    .replace(/[{}]/g, (c) => (c === "{" ? "（" : "）"));
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function renderDiscussionEmail(input: {
  kind: DiscussionNotificationKind;
  locale: EmailLocale;
  sender: string | null;
  track: string;
  origin: string;
  trackId: string;
  commentId: string;
}): Pick<EmailMessage, "subject" | "html" | "text"> {
  const labels = copy[input.locale];
  const url = new URL(`/${input.locale}/tracks/${input.trackId}`, input.origin);
  url.searchParams.set("comment", input.commentId);
  const body = `${plain(input.sender ?? labels.deactivated)} ${input.kind === "comment" ? labels.commentBody : labels.replyBody} “${plain(input.track)}”.`;
  return {
    subject: labels[input.kind],
    text: `${body}\n\n${labels.button}: ${url.href}`,
    html: `<!DOCTYPE html><html lang="${input.locale}"><head><meta charset="utf-8"></head><body><p>TRACK ATLAS</p><h1>${labels[input.kind]}</h1><p>${escape(body)}</p><p><a href="${escape(url.href)}">${labels.button}</a></p></body></html>`,
  };
}

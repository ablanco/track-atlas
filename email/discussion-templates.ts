import "server-only";
import type { EmailLocale, EmailMessage } from "./types";

export type DiscussionNotificationKind = "comment" | "reply";
const copy = {
  fr: {
    comment: "Nouveau commentaire sur votre trace",
    reply: "Nouvelle réponse à votre commentaire",
    commentBody: "a laissé un commentaire sur",
    replyBody: "a répondu à votre commentaire sur",
    button: "Voir le commentaire",
    deactivated: "Utilisateur désactivé",
  },
  pt: {
    comment: "Novo comentário no seu percurso",
    reply: "Nova resposta ao seu comentário",
    commentBody: "deixou um comentário em",
    replyBody: "respondeu ao seu comentário em",
    button: "Ver comentário",
    deactivated: "Utilizador desativado",
  },
  de: {
    comment: "Neuer Kommentar zu deinem Track",
    reply: "Neue Antwort auf deinen Kommentar",
    commentBody: "hat einen Kommentar hinterlassen zu",
    replyBody: "hat auf deinen Kommentar geantwortet zu",
    button: "Kommentar ansehen",
    deactivated: "Deaktivierter Nutzer",
  },
  it: {
    comment: "Nuovo commento al tuo percorso",
    reply: "Nuova risposta al tuo commento",
    commentBody: "ha lasciato un commento su",
    replyBody: "ha risposto al tuo commento su",
    button: "Visualizza commento",
    deactivated: "Utente disattivato",
  },
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

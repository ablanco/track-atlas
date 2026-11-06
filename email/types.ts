import type { SupportedLocale } from "../i18n/locales";
export type EmailLocale = SupportedLocale;
export type AccountEmailPurpose = "email-confirmation" | "password-reset";
export type EmailMessage = {
  to: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
};
export type EmailSendResult =
  { ok: true; messageId: string } | { ok: false; reason: "unavailable" };
export type SendEmail = (message: EmailMessage) => Promise<EmailSendResult>;

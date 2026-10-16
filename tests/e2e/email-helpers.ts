import { readFile } from "node:fs/promises";
import type { AccountEmailPurpose, EmailMessage } from "../../email/types";
export async function capturedEmails(): Promise<EmailMessage[]> {
  if (!process.env.EMAIL_TEST_METADATA) throw Error("Email tests require the private capture harness; do not use a live provider");
  const sink = JSON.parse(await readFile(process.env.EMAIL_TEST_METADATA, "utf8"));
  return (await fetch(sink.url, { headers: { authorization: `Bearer ${sink.token}` } })).json();
}
export async function waitForCapturedEmail(email: string, purpose: AccountEmailPurpose): Promise<EmailMessage> {
  for (let i = 0; i < 100; i++) {
    const messages = await capturedEmails();
    const message = messages.filter(m => m.to.email === email && m.text.includes(purpose === "email-confirmation" ? "confirm-email?" : "reset-password?")).at(-1);
    if (message) return message;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error("Expected captured account email missing");
}
export function emailLink(message: EmailMessage): string {
  const link = message.text.match(/https?:\/\/[^\s]+\?token=[A-Za-z0-9_-]+/);
  if (!link) throw Error("Missing email link"); return link[0];
}

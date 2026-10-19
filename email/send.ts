import "server-only";
import { getEmailConfig } from "./config";
import { sendBrevoEmail } from "./brevo";
import { captureEmail } from "./capture";
import type { EmailMessage, EmailSendResult } from "./types";
export async function sendEmail(
  message: EmailMessage,
): Promise<EmailSendResult> {
  try {
    const config = getEmailConfig();
    return config.mode === "brevo"
      ? await sendBrevoEmail(config, message)
      : await captureEmail(config, message);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

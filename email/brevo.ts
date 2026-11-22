import "server-only";
import type { BrevoConfig } from "./config";
import type { EmailMessage, EmailSendResult } from "./types";
export async function sendBrevoEmail(
  config: BrevoConfig,
  message: EmailMessage,
  fetcher: typeof fetch = fetch,
): Promise<EmailSendResult> {
  try {
    const name = message.to.name;
    const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        "api-key": config.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: config.sender,
        to: [
          {
            email: message.to.email,
            ...([...name].length <= 70 && !/[\r\n{}]/.test(name)
              ? { name }
              : {}),
          },
        ],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
    });
    // Brevo documents 400 as invalid request and 429 as rate-limit rejection.
    // Other statuses (especially 5xx) do not prove nonacceptance.
    if (response.status === 400 || response.status === 429) {
      await response.body?.cancel();
      return {
        ok: false,
        reason: "unavailable",
        delivery: "rejected",
        retryable: response.status === 429,
      };
    }
    if (response.status !== 201 || !response.body)
      return {
        ok: false,
        reason: "unavailable",
        delivery: "unknown",
        retryable: false,
      };
    const reader = response.body.getReader();
    let body = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        body += new TextDecoder().decode(chunk.value);
        if (body.length > 4096) {
          await reader.cancel();
          return {
            ok: false,
            reason: "unavailable",
            delivery: "unknown",
            retryable: false,
          };
        }
      }
    } finally {
      reader.releaseLock();
    }
    const data = JSON.parse(body);
    return typeof data.messageId === "string" &&
      /^[^\s\x00-\x1f\x7f]{1,512}$/.test(data.messageId)
      ? { ok: true, messageId: data.messageId }
      : {
          ok: false,
          reason: "unavailable",
          delivery: "unknown",
          retryable: false,
        };
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      delivery: "unknown",
      retryable: false,
    };
  }
}

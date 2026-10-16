import "server-only";
export type BrevoConfig = { mode: "brevo"; origin: string; rateSecret: string; apiKey: string; sender: { email: string; name: string } };
export type CaptureConfig = { mode: "capture"; origin: string; rateSecret: string; directory: string; sink?: { url: string; token: string } };
export type EmailConfig = BrevoConfig | CaptureConfig;
export function getEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const production = env.NODE_ENV === "production";
  const mode = env.EMAIL_DELIVERY_MODE ?? (production ? "brevo" : "capture");
  const origin = new URL(env.APP_ORIGIN ?? (production ? "" : "http://localhost:3000"));
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      (origin.protocol !== "https:" && !(origin.protocol === "http:" && !production && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))) throw Error("Invalid email origin");
  const rateSecret = env.EMAIL_RATE_LIMIT_SECRET ?? "";
  if (Buffer.byteLength(rateSecret) < 32) throw Error("Email rate-limit secret required");
  if (production && (mode === "capture" || env.EMAIL_TEST_SINK_URL || env.EMAIL_TEST_SINK_TOKEN)) throw Error("Capture is development-only");
  if (mode === "capture") {
    let sink: CaptureConfig["sink"];
    if (env.EMAIL_TEST_SINK_URL || env.EMAIL_TEST_SINK_TOKEN) {
      const url = new URL(env.EMAIL_TEST_SINK_URL ?? "");
      if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || !env.EMAIL_TEST_SINK_TOKEN) throw Error("Private loopback capture required");
      sink = { url: url.href, token: env.EMAIL_TEST_SINK_TOKEN };
    }
    return { mode, origin: origin.origin, rateSecret, directory: env.EMAIL_CAPTURE_DIR ?? ".superpowers/mail", sink };
  }
  if (mode !== "brevo" || !env.BREVO_API_KEY || !env.EMAIL_FROM_ADDRESS || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM_ADDRESS) ||
      !env.EMAIL_FROM_NAME || [...env.EMAIL_FROM_NAME].length > 70 || /[\r\n]/.test(env.EMAIL_FROM_NAME)) throw Error("Brevo configuration required");
  return { mode, origin: origin.origin, rateSecret, apiKey: env.BREVO_API_KEY, sender: { email: env.EMAIL_FROM_ADDRESS, name: env.EMAIL_FROM_NAME } };
}

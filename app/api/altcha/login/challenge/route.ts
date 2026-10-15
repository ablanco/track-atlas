import { connection } from "next/server";
import { getCaptchaSecret, issueAuthChallenge } from "@/auth/captcha";

export async function GET() {
  await connection();
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    return Response.json(await issueAuthChallenge(getCaptchaSecret(), "login"), { headers });
  } catch {
    return Response.json({ error: "Verification is temporarily unavailable" }, { status: 503, headers });
  }
}

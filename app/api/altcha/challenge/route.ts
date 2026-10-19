import { connection } from "next/server";
import { getCaptchaSecret, issueSignupChallenge } from "@/auth/captcha";

export async function GET() {
  await connection();
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    return Response.json(await issueSignupChallenge(getCaptchaSecret()), {
      headers,
    });
  } catch {
    return Response.json(
      { error: "Verification is temporarily unavailable" },
      { status: 503, headers },
    );
  }
}

"use server";

import { hasUploadIntent, UPLOAD_INTENT_COOKIE } from "@/auth/upload-intent";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { getCaptchaSecret, verifySignupCaptcha } from "@/auth/captcha";
import {
  getCurrentUser,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/auth/session";
import { registerUser } from "@/auth/signup";
import { handleSignup, type SignupActionState } from "@/auth/signup-action";
import { redirect } from "@/i18n/navigation";
import { getEmailConfig } from "@/email/config";
import { sendEmail } from "@/email/send";
import { getEmailRateKey } from "@/auth/email-rate-limit";
import { deliverIssuedAccountEmail } from "@/auth/account-email";

export async function signup(
  locale: string,
  _previous: SignupActionState,
  form: FormData,
): Promise<SignupActionState> {
  return handleSignup(locale, form, {
    currentUser: getCurrentUser,
    verifyCaptcha: (form) =>
      verifySignupCaptcha(getDb(), form, getCaptchaSecret()),
    register: async (input) =>
      registerUser(
        getDb(),
        input,
        await getEmailRateKey(
          getDb(),
          input.email,
          getEmailConfig().rateSecret,
        ),
      ),
    sendConfirmation: async (issued, language) => {
      await deliverIssuedAccountEmail(getDb(), issued, language, sendEmail);
    },
    setSession: async ({ token, expiresAt }) => {
      if (hasUploadIntent(form.get("intent")))
        (await cookies()).set(UPLOAD_INTENT_COOKIE, "upload", {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 86400,
        });
      (await cookies()).set(
        SESSION_COOKIE_NAME,
        token,
        sessionCookieOptions(expiresAt, process.env.NODE_ENV === "production"),
      );
    },
    redirectHome: (supportedLocale) =>
      redirect({
        href: hasUploadIntent(form.get("intent")) ? "/tracks/upload" : "/",
        locale: supportedLocale,
      }),
  });
}

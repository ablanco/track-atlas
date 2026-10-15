"use server";

import { cookies } from "next/headers";
import { getDb } from "@/db";
import { getCaptchaSecret, verifySignupCaptcha } from "@/auth/captcha";
import { getCurrentUser, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/auth/session";
import { registerUser } from "@/auth/signup";
import { handleSignup, type SignupActionState } from "@/auth/signup-action";
import { redirect } from "@/i18n/navigation";

export async function signup(locale: string, _previous: SignupActionState, form: FormData): Promise<SignupActionState> {
  return handleSignup(locale, form, {
    currentUser: getCurrentUser,
    verifyCaptcha: (form) => verifySignupCaptcha(getDb(), form, getCaptchaSecret()),
    register: (input) => registerUser(getDb(), input),
    setSession: async ({ token, expiresAt }) => {
      (await cookies()).set(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt, process.env.NODE_ENV === "production"));
    },
    redirectHome: (supportedLocale) => redirect({ href: "/", locale: supportedLocale }),
  });
}

"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { getDb } from "@/db";
import { getCaptchaSecret, verifyAuthCaptcha } from "@/auth/captcha";
import { handleLogin, type LoginActionState } from "@/auth/login-action";
import { loginUser } from "@/auth/login";
import { handleLogout, type LogoutActionState } from "@/auth/logout-action";
import { revokeSession, isSessionToken } from "@/auth/session-store";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/auth/session";

export async function login(locale: string, _previous: LoginActionState, form: FormData): Promise<LoginActionState> {
  return handleLogin(locale, form, {
    verifyCaptcha: (form) => verifyAuthCaptcha(getDb(), form, getCaptchaSecret(), "login"),
    authenticate: async (input) => loginUser(getDb(), input, (await cookies()).get(SESSION_COOKIE_NAME)?.value),
    setSession: async ({ token, expiresAt }) => {
      (await cookies()).set(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt, process.env.NODE_ENV === "production"));
    },
  });
}

export async function logout(): Promise<LogoutActionState> {
  return handleLogout({
    revokeCurrent: async () => {
      const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
      if (isSessionToken(token)) await revokeSession(getDb(), token);
    },
    clearSession: async () => { (await cookies()).delete(SESSION_COOKIE_NAME); },
  });
}

export async function retryAuth(): Promise<void> { refresh(); }

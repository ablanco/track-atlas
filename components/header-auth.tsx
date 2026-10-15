import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/auth/session";
import { AuthControl, type AuthLabels } from "./auth-control";

export async function HeaderAuth() {
  await connection();
  const locale = await getLocale();
  const t = await getTranslations("Auth");
  const labels: AuthLabels = {
    login: t("login"), logout: t("logout"), loggingOut: t("loggingOut"), unavailable: t("unavailable"), retry: t("retry"), close: t("close"),
    form: {
      title: t("title"), description: t("description"), email: t("email"), password: t("password"), submit: t("login"), pending: t("pending"),
      signupPrompt: t("signupPrompt"), signup: t("signup"), check: t("check"), captcha: t("captcha"), invalidCredentials: t("invalidCredentials"), unavailable: t("unavailable"),
      errors: { required: t("errors.required"), invalid: t("errors.invalid"), tooLong: t("errors.tooLong"), future: t("errors.invalid") },
    },
  };
  let status: "guest" | "authenticated" | "unavailable";
  try { status = await getCurrentUser() ? "authenticated" : "guest"; }
  catch { status = "unavailable"; }
  return <AuthControl key={locale} status={status} locale={locale} labels={labels} />;
}

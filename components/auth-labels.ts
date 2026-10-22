import "server-only";
import { getTranslations } from "next-intl/server";
import type { AuthLabels } from "./auth-control";
export async function getAuthLabels(): Promise<AuthLabels> {
  const t = await getTranslations("Auth");
  return {
    login: t("login"),
    logout: t("logout"),
    settings: t("settings"),
    uploadTrack: t("uploadTrack"),
    myTracks: t("myTracks"),
    loggingOut: t("loggingOut"),
    unavailable: t("unavailable"),
    retry: t("retry"),
    form: {
      title: t("title"),
      description: t("description"),
      email: t("email"),
      password: t("password"),
      submit: t("login"),
      pending: t("pending"),
      signupPrompt: t("signupPrompt"),
      signup: t("signup"),
      check: t("check"),
      captcha: t("captcha"),
      invalidCredentials: t("invalidCredentials"),
      unavailable: t("unavailable"),
      errors: {
        required: t("errors.required"),
        invalid: t("errors.invalid"),
        tooLong: t("errors.tooLong"),
        future: t("errors.invalid"),
      },
    },
  };
}

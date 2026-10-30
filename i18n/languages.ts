import { routing } from "./routing";

export type SupportedLocale = (typeof routing.locales)[number];

export const languageNames: Record<SupportedLocale, string> = {
  en: "English",
  es: "Español",
};

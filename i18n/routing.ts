import { locales } from "./locales";
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "always",
});

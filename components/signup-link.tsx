import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/auth/session";
import { Link } from "@/i18n/navigation";

export async function SignupLink() {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return null;
  }
  if (user) return null;
  const t = await getTranslations("Signup");
  return (
    <Link
      href="/signup"
      className="mt-6 inline-flex min-h-11 items-center rounded-md bg-accent px-5 py-3 text-sm font-semibold text-on-accent"
    >
      {t("submit")}
    </Link>
  );
}

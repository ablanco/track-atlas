import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/auth/session";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";

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
      className={buttonVariants({
        size: "lg",
        className: "mt-6 min-h-11 px-5",
      })}
    >
      {t("submit")}
    </Link>
  );
}

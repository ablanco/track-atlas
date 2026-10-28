import { Suspense } from "react";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/admin/auth";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { AdminPanel } from "@/components/admin/panel";
export const metadata = {
  title: "Track Atlas",
  robots: { index: false, follow: false },
};
async function Content() {
  await connection();
  const t = await getTranslations("Admin");
  try {
    await requireAdmin(
      getDb(),
      (await cookies()).get(SESSION_COOKIE_NAME)?.value,
    );
  } catch {
    return (
      <section className="mx-auto max-w-xl px-6 py-24">
        <h1 className="text-2xl font-semibold">{t("access")}</h1>
        <p className="mt-3 text-muted-foreground">{t("accessHint")}</p>
      </section>
    );
  }
  return <AdminPanel />;
}
export default function Page() {
  return (
    // Keep overlays' outside-element markers on the hydrated shell, not streamed content.
    <div>
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </div>
  );
}

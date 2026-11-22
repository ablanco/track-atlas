import { getDb } from "@/db";
import { appOrigin } from "@/seo/config";
import { isSupportedLocale } from "@/i18n/locales";
import { handleDigestOptOut } from "@/digests/opt-out-http";
async function handle(
  request: Request,
  context: { params: Promise<{ locale: string }> },
) {
  const { locale } = await context.params;
  if (!isSupportedLocale(locale)) return new Response(null, { status: 404 });
  return handleDigestOptOut(request, {
    db: getDb(),
    origin: appOrigin(),
    locale,
  });
}
export { handle as GET, handle as POST };

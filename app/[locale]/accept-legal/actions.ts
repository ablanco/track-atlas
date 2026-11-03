"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { renewLegalAcceptance } from "@/legal/renewal";
import { safeLegalDestination } from "@/legal/destination";
export async function acceptLegal(
  locale: string,
  returnTo: string,
  _state: string,
  form: FormData,
): Promise<string> {
  let result;
  try {
    result = await renewLegalAcceptance(
      getDb(),
      (await cookies()).get(SESSION_COOKIE_NAME)?.value,
      locale,
      form,
    );
  } catch {
    return "unavailable";
  }
  if (result !== "accepted") return result;
  revalidatePath("/", "layout");
  redirect(safeLegalDestination(returnTo, locale));
}

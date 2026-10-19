"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { getDb } from "@/db";
import { redirect } from "@/i18n/navigation";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import {
  updateProfile,
  updatePassword,
  deactivateAccount,
} from "@/auth/settings";
import {
  handleProfileUpdate,
  handlePasswordUpdate,
  handleDeactivation,
  type ProfileActionState,
  type PasswordActionState,
  type DeactivateActionState,
} from "@/auth/settings-action";

async function requestToken() {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value;
}

export async function saveProfile(
  locale: string,
  _previous: ProfileActionState,
  form: FormData,
): Promise<ProfileActionState> {
  return handleProfileUpdate(locale, form, {
    token: requestToken,
    update: (token, input) => updateProfile(getDb(), token, input),
    refresh,
  });
}

export async function changePassword(
  locale: string,
  _previous: PasswordActionState,
  form: FormData,
): Promise<PasswordActionState> {
  return handlePasswordUpdate(locale, form, {
    token: requestToken,
    update: (token, input) => updatePassword(getDb(), token, input),
    refresh,
  });
}

export async function disableAccount(
  locale: string,
  _previous: DeactivateActionState,
): Promise<DeactivateActionState> {
  // Previous action state is client-controlled and must not authorize anything.
  void _previous;
  return handleDeactivation(locale, {
    token: requestToken,
    deactivate: (token) => deactivateAccount(getDb(), token),
    clearSession: async () => {
      (await cookies()).delete(SESSION_COOKIE_NAME);
    },
    redirectHome: (locale) => redirect({ href: "/", locale }),
  });
}

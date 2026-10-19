"use server";
import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { getDb } from "@/db";
import { getEmailConfig } from "@/email/config";
import { sendEmail } from "@/email/send";
import {
  requestPasswordReset,
  requestEmailConfirmation,
} from "@/auth/account-email";
import { confirmAccountEmail } from "@/auth/account-confirmation";
import { resetAccountPassword } from "@/auth/password-recovery";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import {
  handleRecoveryRequest,
  handleConfirmationRequest,
  handleConfirmLink,
  handleResetLink,
  type RecoveryActionState,
  type ConfirmationActionState,
  type ConfirmLinkActionState,
  type ResetLinkActionState,
} from "@/auth/account-email-action";
export async function requestPasswordResetEmail(
  locale: string,
  _previous: RecoveryActionState,
  form: FormData,
) {
  return handleRecoveryRequest(locale, form, {
    prepare: () => {
      getEmailConfig();
    },
    request: (email, language) =>
      requestPasswordReset(getDb(), email, language, sendEmail),
  });
}
export async function resendEmailConfirmation(
  locale: string,
  _previous: ConfirmationActionState,
  _form: FormData,
) {
  void _previous;
  void _form;
  return handleConfirmationRequest(locale, {
    token: async () => (await cookies()).get(SESSION_COOKIE_NAME)?.value,
    request: (token, language) =>
      requestEmailConfirmation(getDb(), token, language, sendEmail),
    refresh,
  });
}
export async function confirmEmailLink(
  locale: string,
  _previous: ConfirmLinkActionState,
  form: FormData,
) {
  return handleConfirmLink(locale, form, {
    confirm: (token) => confirmAccountEmail(getDb(), token),
    refresh,
  });
}
export async function resetPasswordFromLink(
  locale: string,
  _previous: ResetLinkActionState,
  form: FormData,
) {
  return handleResetLink(locale, form, {
    reset: (token, input) => resetAccountPassword(getDb(), token, input),
    clearSession: async () => {
      (await cookies()).delete(SESSION_COOKIE_NAME);
    },
    refresh,
  });
}

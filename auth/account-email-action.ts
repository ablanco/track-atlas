import "server-only";
import type { EmailLocale } from "../email/types";
import type { AccountLinkResult } from "./account-token-store";
import type { ConfirmationRequestResult } from "./account-email";
import { isAccountToken } from "./account-token";
import { validateLogin } from "./login-validation";
import { validatePassword, type PasswordErrors, type PasswordInput } from "./settings-validation";
export type RecoveryActionState = { values: { email: string }; fieldErrors: { email?: "required" | "invalid" | "tooLong" }; requested?: true; formError?: "unavailable" };
export type ConfirmationActionState = { success?: true; retryAfterSeconds?: number; formError?: "unauthorized" | "unavailable" | "throttled" };
export type ConfirmLinkActionState = { confirmed?: true; formError?: "invalid" | "unavailable" };
export type ResetLinkActionState = { completed?: true; fieldErrors: PasswordErrors; formError?: "invalid" | "unavailable" };
const validLocale = (locale: string): locale is EmailLocale => locale === "en" || locale === "es";
function tokenField(form: FormData) { const values = form.getAll("token"); return values.length === 1 && isAccountToken(values[0]) ? values[0] : null; }
export async function handleRecoveryRequest(locale: string, form: FormData, deps: { prepare(): void; request(email: string, locale: EmailLocale): Promise<void> }): Promise<RecoveryActionState> {
  const parsed = validateLogin(form), state: RecoveryActionState = { values: parsed.values, fieldErrors: {} };
  if (!validLocale(locale)) return { ...state, formError: "unavailable" };
  if (!parsed.ok && parsed.errors.email) return { ...state, fieldErrors: { email: parsed.errors.email === "required" || parsed.errors.email === "tooLong" ? parsed.errors.email : "invalid" } };
  try { deps.prepare(); } catch { return { ...state, formError: "unavailable" }; }
  try { await deps.request(parsed.values.email, locale); } catch { /* Keep account-specific infrastructure failures indistinguishable. */ }
  return { ...state, requested: true };
}
export async function handleConfirmationRequest(locale: string, deps: { token(): Promise<string | undefined>; request(token: string, locale: EmailLocale): Promise<ConfirmationRequestResult>; refresh(): void }): Promise<ConfirmationActionState> {
  if (!validLocale(locale)) return { formError: "unavailable" };
  try {
    const token = await deps.token(); if (!token) return { formError: "unauthorized" };
    const result = await deps.request(token, locale);
    if (!result.ok) return { formError: result.reason, retryAfterSeconds: result.retryAfterSeconds };
    try { deps.refresh(); } catch { /* The request already completed. */ }
    return { success: true, retryAfterSeconds: result.retryAfterSeconds };
  } catch { return { formError: "unavailable" }; }
}
export async function handleConfirmLink(locale: string, form: FormData, deps: { confirm(token: string): Promise<AccountLinkResult>; refresh(): void }): Promise<ConfirmLinkActionState> {
  const token = tokenField(form); if (!validLocale(locale) || !token) return { formError: "invalid" };
  try { const result = await deps.confirm(token); if (!result.ok) return { formError: result.reason }; }
  catch { return { formError: "unavailable" }; }
  try { deps.refresh(); } catch { /* Commit is complete. */ } return { confirmed: true };
}
export async function handleResetLink(locale: string, form: FormData, deps: { reset(token: string, input: PasswordInput): Promise<AccountLinkResult>; clearSession(): Promise<void>; refresh(): void }): Promise<ResetLinkActionState> {
  const token = tokenField(form); if (!validLocale(locale) || !token) return { fieldErrors: {}, formError: "invalid" };
  const parsed = validatePassword(form); if (!parsed.ok) return { fieldErrors: parsed.errors };
  try { const result = await deps.reset(token, parsed.input); if (!result.ok) return { fieldErrors: {}, formError: result.reason }; }
  catch { return { fieldErrors: {}, formError: "unavailable" }; }
  try { await deps.clearSession(); } catch { /* Password and session revocation are committed. */ }
  try { deps.refresh(); } catch { /* Never report an apparent rollback. */ }
  return { fieldErrors: {}, completed: true };
}

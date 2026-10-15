import "server-only";
import { routing } from "../i18n/routing";
import { validateSignup, type SignupField, type SignupInput, type SignupValues, type ValidationCode } from "./validation";
import type { IssuedSession, SessionIdentity } from "./session-store";
import type { SignupResult } from "./signup";

export type SignupActionState = {
  values: SignupValues;
  fieldErrors: Partial<Record<SignupField, ValidationCode | "emailTaken">>;
  formError?: "unavailable" | "captcha";
};
export type SignupDependencies = {
  currentUser(): Promise<SessionIdentity | null>;
  verifyCaptcha(form: FormData): Promise<boolean>;
  register(input: SignupInput): Promise<SignupResult>;
  setSession(session: IssuedSession): Promise<void>;
  redirectHome(locale: (typeof routing.locales)[number]): never;
};

// The Next.js adapter supplies request/cookie/redirect effects; these are never
// accepted as arguments to the public Server Action.
export async function handleSignup(locale: string, form: FormData, dependencies: SignupDependencies): Promise<SignupActionState> {
  const supportedLocale = routing.locales.find((value) => value === locale);
  const parsed = validateSignup(form, new Date().toISOString().slice(0, 10));
  const state: SignupActionState = { values: parsed.values, fieldErrors: {} };
  if (!supportedLocale) return { ...state, formError: "unavailable" };
  let currentUser;
  try { currentUser = await dependencies.currentUser(); }
  catch { return { ...state, formError: "unavailable" }; }
  if (currentUser) dependencies.redirectHome(supportedLocale);
  if (!parsed.ok) return { ...state, fieldErrors: parsed.errors };
  try {
    if (!(await dependencies.verifyCaptcha(form))) return { ...state, formError: "captcha" };
    const result = await dependencies.register(parsed.input);
    if (!result.ok) return result.reason === "emailTaken"
      ? { ...state, fieldErrors: { email: "emailTaken" } }
      : { ...state, formError: "unavailable" };
    await dependencies.setSession(result.session);
  } catch { return { ...state, formError: "unavailable" }; }
  dependencies.redirectHome(supportedLocale);
}

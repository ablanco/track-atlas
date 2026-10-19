import "server-only";
import { routing } from "../i18n/routing";
import {
  validateLogin,
  type LoginField,
  type LoginInput,
  type LoginValues,
} from "./login-validation";
import type { ValidationCode } from "./validation";
import type { IssuedSession } from "./session-store";
import type { LoginResult } from "./login";

export type LoginActionState = {
  values: LoginValues;
  fieldErrors: Partial<Record<LoginField, ValidationCode>>;
  formError?: "captcha" | "invalidCredentials" | "unavailable";
  success?: boolean;
};
export type LoginDependencies = {
  verifyCaptcha(form: FormData): Promise<boolean>;
  authenticate(input: LoginInput): Promise<LoginResult>;
  setSession(session: IssuedSession): Promise<void>;
};

export async function handleLogin(
  locale: string,
  form: FormData,
  dependencies: LoginDependencies,
): Promise<LoginActionState> {
  const parsed = validateLogin(form);
  const state: LoginActionState = { values: parsed.values, fieldErrors: {} };
  if (!routing.locales.some((value) => value === locale))
    return { ...state, formError: "unavailable" };
  if (!parsed.ok) return { ...state, fieldErrors: parsed.errors };
  try {
    if (!(await dependencies.verifyCaptcha(form)))
      return { ...state, formError: "captcha" };
    const result = await dependencies.authenticate(parsed.input);
    if (!result.ok) return { ...state, formError: result.reason };
    await dependencies.setSession(result.session);
    return { ...state, success: true };
  } catch {
    return { ...state, formError: "unavailable" };
  }
}

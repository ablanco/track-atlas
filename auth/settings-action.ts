import "server-only";
import { routing } from "../i18n/routing";
import { isSessionToken } from "./session-store";
import {
  validatePassword,
  validateProfile,
  type PasswordErrors,
  type PasswordInput,
  type ProfileErrors,
  type ProfileInput,
  type ProfileValues,
} from "./settings-validation";
import type { SettingsResult } from "./settings";

type FormError = "unauthorized" | "unavailable";
type Locale = (typeof routing.locales)[number];
export type ProfileActionState = {
  values: ProfileValues;
  fieldErrors: ProfileErrors;
  formError?: FormError;
  success?: boolean;
};
export type PasswordActionState = {
  fieldErrors: PasswordErrors;
  formError?: FormError;
  success?: boolean;
};
export type DeactivateActionState = {
  formError?: FormError;
  deactivated?: true;
};
type RequestDependencies = { token(): Promise<string | undefined> };
export type ProfileDependencies = RequestDependencies & {
  update(token: string, input: ProfileInput): Promise<SettingsResult>;
  refresh(): void;
};
export type PasswordDependencies = RequestDependencies & {
  update(token: string, input: PasswordInput): Promise<SettingsResult>;
  refresh(): void;
};
export type DeactivateDependencies = RequestDependencies & {
  deactivate(token: string): Promise<SettingsResult>;
  clearSession(): Promise<void>;
  redirectHome(locale: Locale): never;
};

export async function handleProfileUpdate(
  locale: string,
  form: FormData,
  dependencies: ProfileDependencies,
): Promise<ProfileActionState> {
  const parsed = validateProfile(form);
  const state: ProfileActionState = { values: parsed.values, fieldErrors: {} };
  if (!routing.locales.some((value) => value === locale))
    return { ...state, formError: "unavailable" };
  if (!parsed.ok) return { ...state, fieldErrors: parsed.errors };
  try {
    const token = await dependencies.token();
    if (!isSessionToken(token)) return { ...state, formError: "unauthorized" };
    const result = await dependencies.update(token, parsed.input);
    if (!result.ok) return { ...state, formError: result.reason };
    dependencies.refresh();
    return { ...state, success: true };
  } catch {
    return { ...state, formError: "unavailable" };
  }
}

export async function handlePasswordUpdate(
  locale: string,
  form: FormData,
  dependencies: PasswordDependencies,
): Promise<PasswordActionState> {
  const state: PasswordActionState = { fieldErrors: {} };
  if (!routing.locales.some((value) => value === locale))
    return { ...state, formError: "unavailable" };
  const parsed = validatePassword(form);
  if (!parsed.ok) return { fieldErrors: parsed.errors };
  try {
    const token = await dependencies.token();
    if (!isSessionToken(token)) return { ...state, formError: "unauthorized" };
    const result = await dependencies.update(token, parsed.input);
    if (!result.ok) return { ...state, formError: result.reason };
    dependencies.refresh();
    return { ...state, success: true };
  } catch {
    return { ...state, formError: "unavailable" };
  }
}

export async function handleDeactivation(
  locale: string,
  dependencies: DeactivateDependencies,
): Promise<DeactivateActionState> {
  const supported = routing.locales.find((value) => value === locale);
  if (!supported) return { formError: "unavailable" };
  try {
    const token = await dependencies.token();
    if (!isSessionToken(token)) return { formError: "unauthorized" };
    const result = await dependencies.deactivate(token);
    if (!result.ok) return { formError: result.reason };
  } catch {
    return { formError: "unavailable" };
  }
  // The account is already disabled. A failed cookie effect cannot undo that.
  try {
    await dependencies.clearSession();
  } catch {
    return { deactivated: true };
  }
  dependencies.redirectHome(supported);
}

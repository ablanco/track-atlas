export type ProfileValues = { firstName: string; lastName: string; displayName: string };
export type ProfileInput = Omit<ProfileValues, "displayName"> & { displayName: string | null };
export type PasswordInput = { password: string };
export type SettingsValidationCode = "required" | "invalid" | "tooLong" | "mismatch";
export type ProfileErrors = Partial<Record<keyof ProfileValues, SettingsValidationCode>>;
export type PasswordErrors = Partial<Record<"password" | "passwordConfirmation", SettingsValidationCode>>;

export function validateProfile(form: FormData):
  | { ok: true; input: ProfileInput; values: ProfileValues }
  | { ok: false; errors: ProfileErrors; values: ProfileValues } {
  const values: ProfileValues = { firstName: "", lastName: "", displayName: "" };
  const errors: ProfileErrors = {};
  for (const field of ["firstName", "lastName", "displayName"] as const) {
    const entries = form.getAll(field);
    if (!entries.length) { if (field !== "displayName") errors[field] = "required"; continue; }
    if (entries.length !== 1 || typeof entries[0] !== "string") { errors[field] = "invalid"; continue; }
    const value = entries[0].trim();
    values[field] = Array.from(value).slice(0, 200).join("");
    if (!value && field !== "displayName") errors[field] = "required";
    else if (Array.from(value).length > 200) errors[field] = "tooLong";
  }
  if (Object.keys(errors).length) return { ok: false, errors, values };
  return { ok: true, input: { ...values, displayName: values.displayName || null }, values };
}

export function validatePassword(form: FormData):
  | { ok: true; input: PasswordInput }
  | { ok: false; errors: PasswordErrors } {
  const errors: PasswordErrors = {};
  const values = { password: "", passwordConfirmation: "" };
  for (const field of ["password", "passwordConfirmation"] as const) {
    const entries = form.getAll(field);
    if (!entries.length) { errors[field] = "required"; continue; }
    if (entries.length !== 1 || typeof entries[0] !== "string") { errors[field] = "invalid"; continue; }
    const value = entries[0];
    if (!value) errors[field] = "required";
    else if (new TextEncoder().encode(value).length > 1024) errors[field] = "tooLong";
    else values[field] = value;
  }
  if (!Object.keys(errors).length && values.password !== values.passwordConfirmation) errors.passwordConfirmation = "mismatch";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, input: { password: values.password } };
}

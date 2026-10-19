import type { ValidationCode } from "./validation";

export type LoginInput = { email: string; password: string };
export type LoginField = keyof LoginInput;
export type LoginValues = { email: string };
export type LoginValidation =
  | { ok: true; input: LoginInput; values: LoginValues }
  | {
      ok: false;
      errors: Partial<Record<LoginField, ValidationCode>>;
      values: LoginValues;
    };

export function validateLogin(form: FormData): LoginValidation {
  const values = { email: "" };
  const errors: Partial<Record<LoginField, ValidationCode>> = {};
  let password = "";
  for (const field of ["email", "password"] as const) {
    const entries = form.getAll(field);
    if (entries.length === 0) {
      errors[field] = "required";
      continue;
    }
    if (entries.length !== 1 || typeof entries[0] !== "string") {
      errors[field] = "invalid";
      continue;
    }
    const value = field === "email" ? entries[0].trim() : entries[0];
    if (!value) errors[field] = "required";
    if (field === "email") {
      values.email = Array.from(value).slice(0, 254).join("");
      if (Array.from(value).length > 254) errors.email = "tooLong";
    } else {
      password = value;
      if (new TextEncoder().encode(value).length > 1024)
        errors.password = "tooLong";
    }
  }
  if (
    !errors.email &&
    !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(
      values.email,
    )
  )
    errors.email = "invalid";
  return Object.keys(errors).length
    ? { ok: false, errors, values }
    : { ok: true, input: { email: values.email, password }, values };
}

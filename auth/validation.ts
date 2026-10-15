export type SignupValues = {
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  dateOfBirth: string;
};
export type SignupInput = Omit<SignupValues, "displayName"> & { displayName: string | null; password: string };
export type SignupField = keyof SignupValues | "password";
export type ValidationCode = "required" | "tooLong" | "invalid" | "future";
export type SignupValidation =
  | { ok: true; input: SignupInput; values: SignupValues }
  | { ok: false; errors: Partial<Record<SignupField, ValidationCode>>; values: SignupValues };

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function validateSignup(form: FormData, today: string): SignupValidation {
  const values: SignupValues = { firstName: "", lastName: "", displayName: "", email: "", dateOfBirth: "" };
  const errors: Partial<Record<SignupField, ValidationCode>> = {};
  let password = "";
  for (const field of ["firstName", "lastName", "displayName", "email", "dateOfBirth", "password"] as const) {
    const entries = form.getAll(field);
    if (field === "displayName" && entries.length === 0) continue;
    if (entries.length === 0) { errors[field] = "required"; continue; }
    if (entries.length !== 1 || typeof entries[0] !== "string") { errors[field] = "invalid"; continue; }
    const value = field === "password" ? entries[0] : entries[0].trim();
    const limit = field === "email" ? 254 : field === "dateOfBirth" ? 10 : 200;
    if (field === "password") {
      password = value;
      if (!value) errors.password = "required";
      else if (new TextEncoder().encode(value).length > 1024) errors.password = "tooLong";
    } else {
      // Keep action-state echoes bounded even when a malicious client skips HTML limits.
      values[field] = Array.from(value).slice(0, limit).join("");
      if (!value && field !== "displayName") errors[field] = "required";
      else if (Array.from(value).length > limit) errors[field] = "tooLong";
    }
  }
  if (!errors.email && !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(values.email)) errors.email = "invalid";
  if (!errors.dateOfBirth) {
    if (!isCalendarDate(values.dateOfBirth)) errors.dateOfBirth = "invalid";
    else if (values.dateOfBirth > today) errors.dateOfBirth = "future";
  }
  if (Object.keys(errors).length) return { ok: false, errors, values };
  return { ok: true, input: { ...values, displayName: values.displayName || null, password }, values };
}

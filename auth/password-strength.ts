export const minimumPasswordScore = 3;
export const maximumPasswordBytes = 1024;
export type PasswordScore = 0 | 1 | 2 | 3 | 4;
export type PasswordStrengthError = "required" | "tooLong" | "weak";

// Keep the large dictionaries out of initial browser bundles. Both runtimes load
// the same factory, independently of the interface language.
export async function measurePassword(
  password: string,
): Promise<PasswordScore> {
  if (
    !password ||
    new TextEncoder().encode(password).length > maximumPasswordBytes
  )
    return 0;
  const { passwordEstimator } = await import("./password-estimator");
  return passwordEstimator.check(password, ["Track Atlas", "trackatlas"]).score;
}

export async function passwordStrengthError(
  password: string,
): Promise<PasswordStrengthError | undefined> {
  if (!password) return "required";
  if (new TextEncoder().encode(password).length > maximumPasswordBytes)
    return "tooLong";
  if ((await measurePassword(password)) < minimumPasswordScore) return "weak";
}

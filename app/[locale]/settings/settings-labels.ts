import type { SettingsValidationCode } from "@/auth/settings-validation";

export type SettingsLabels = {
  common: { check: string; unavailable: string; unauthorized: string; goHome: string; close: string; cancel: string; optional: string; errors: Record<SettingsValidationCode, string>; passwordTooLong: string };
  profile: { title: string; description: string; firstName: string; lastName: string; displayName: string; email: string; emailHint: string; dateOfBirth: string; dateOfBirthHint: string; submit: string; pending: string; success: string };
  avatar: { title: string; file: string; optional: string; hint: string; metadata: string; empty: string; imageAlt: string; imageUnavailable: string; submit: string; pending: string; success: string; errors: Record<"invalidFile" | "tooLarge" | "quotaExceeded" | "unauthorized" | "unavailable", string> };
  password: { title: string; description: string; password: string; passwordConfirmation: string; hint: string; submit: string; pending: string; success: string; confirmTitle: string; confirmDescription: string };
  deactivate: { title: string; description: string; submit: string; pending: string; confirmTitle: string; confirmDescription: string; completed: string };
};

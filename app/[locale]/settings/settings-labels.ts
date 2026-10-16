import type { SettingsValidationCode } from "@/auth/settings-validation";

export type SettingsLabels = {
  common: { check: string; unavailable: string; unauthorized: string; goHome: string; close: string; cancel: string; optional: string; errors: Record<SettingsValidationCode, string>; passwordTooLong: string };
  profile: { title: string; description: string; firstName: string; lastName: string; displayName: string; email: string; emailHint: string; dateOfBirth: string; dateOfBirthHint: string; submit: string; pending: string; success: string };
  password: { title: string; description: string; password: string; passwordConfirmation: string; hint: string; submit: string; pending: string; success: string; confirmTitle: string; confirmDescription: string };
  deactivate: { title: string; description: string; submit: string; pending: string; confirmTitle: string; confirmDescription: string; completed: string };
};

import "server-only";

export type LogoutActionState = {
  success?: boolean;
  formError?: "unavailable";
};
export type LogoutDependencies = {
  revokeCurrent(): Promise<void>;
  clearSession(): Promise<void>;
};

export async function handleLogout(
  dependencies: LogoutDependencies,
): Promise<LogoutActionState> {
  try {
    await dependencies.revokeCurrent();
    await dependencies.clearSession();
    return { success: true };
  } catch {
    return { formError: "unavailable" };
  }
}

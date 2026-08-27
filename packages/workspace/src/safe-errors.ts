const SAFE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  LibraryIntegrityFailedPreserved: "This Library failed integrity checks and was preserved unchanged. Open a backup or copy; no repair was attempted.",
  RevisionConflict: "This Asset changed elsewhere. Reload it before saving your edits.",
  RootPermissionRequired: "This Root needs permission before it can be scanned.",
  SessionClosed: "This Library session is closed. Open the Library again.",
  CoreUnavailable: "Reference Core is unavailable. Restart it to continue.",
});

export function safeErrorMessage(reason: unknown, fallback: string): string {
  if (reason && typeof reason === "object" && "code" in reason) {
    const code = String((reason as { code?: unknown }).code ?? "");
    if (SAFE_MESSAGES[code]) return SAFE_MESSAGES[code];
  }
  return fallback;
}

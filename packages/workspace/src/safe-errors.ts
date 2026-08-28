const SAFE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  LibraryIntegrityFailedPreserved: "This Library failed integrity checks and was preserved unchanged. Open a backup or copy; no repair was attempted.",
  RevisionConflict: "This Asset changed elsewhere. Reload it before saving your edits.",
  RootPermissionRequired: "This Root needs permission before it can be scanned.",
  SessionClosed: "This Library session is closed. Open the Library again.",
  CoreUnavailable: "Reference Core is unavailable. Restart it to continue.",
  RootScanCapacityReached: "Two Roots are already scanning. Wait for one to finish or cancel it.",
  RenditionQueueFull: "Preview work is busy. Wait for current thumbnails to finish, then retry.",
  RenditionTimedOut: "Preview generation took too long. Retry; the original file is unchanged.",
  SourceRevisionChanged: "This source changed while it was being read. Rescan its Root, then retry.",
  ResourceTooLarge: "This file is too large for a safe Preview. Use Reveal Source for the original.",
});

export function safeErrorMessage(reason: unknown, fallback: string): string {
  if (reason && typeof reason === "object" && "code" in reason) {
    const code = String((reason as { code?: unknown }).code ?? "");
    if (SAFE_MESSAGES[code]) return SAFE_MESSAGES[code];
  }
  return fallback;
}

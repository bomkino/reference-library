const CORE_MESSAGES = Object.freeze({
  LibraryDestinationExists: "A Library already exists at that destination.",
  LibraryManifestInvalid: "The selected Library package is invalid.",
  LibrarySchemaUnsupported: "This Library was created by a newer Reference Library version.",
  LibraryLockedByOtherWriter: "This Library is open in another writer.",
  LibraryDatabaseIntegrityInvalid: "This Library failed integrity checks and was preserved unchanged. Open a backup or copy; no repair was attempted.",
  LibraryMigrationLedgerInvalid: "This Library migration ledger is invalid and was preserved unchanged. Open a backup or copy; no repair was attempted.",
  LibraryIntegrityFailedPreserved: "This Library failed integrity checks and was preserved unchanged. Open a backup or copy; no repair was attempted.",
  SessionClosed: "The Library session is closed.",
  RootPermissionRequired: "The Source Root needs permission.",
  RootNotFound: "The Source Root was not found.",
  RootScanInProgress: "That Source Root is already scanning.",
  RootIdentityMismatch: "The selected folder does not match this Source Root.",
  QueryInvalid: "The Asset query is invalid.",
  AssetNotFound: "The Asset was not found.",
  AssetRevisionConflict: "The Asset changed. Refresh it before saving again.",
  CollectionNotFound: "The Collection was not found.",
  CollectionNameConflict: "That Collection name is already in use.",
  CollectionMembershipInvalid: "The Collection membership change is invalid.",
  LocationNotFound: "The Asset location was not found.",
  LocationMissing: "The Asset location is unavailable.",
  SourceRevisionChanged: "The source changed. Rescan before previewing it.",
  UnsupportedPreview: "Preview is unavailable for this media type.",
  ResourceTooLarge: "This Asset is too large to preview.",
  RenditionQueueFull: "Preview generation is busy. Try again shortly.",
  RawPathResourceDenied: "The Asset resource request was denied.",
  ProtocolVersionUnsupported: "The native shell and Reference Core versions do not match.",
  CoreFailure: "Reference Core could not complete the operation.",
});

const SAFE_SHELL_MESSAGES = new Set([
  "SessionClosed",
  "Reference Core must restart before writes continue",
  "Reference Core is not running",
]);

export function rendererSafeError(error) {
  if (error instanceof TypeError) return new TypeError(bounded(error.message));
  const code = typeof error?.code === "string" ? error.code : null;
  const message = code ? CORE_MESSAGES[code] : null;
  if (message) return namedError(message, code);
  if (SAFE_SHELL_MESSAGES.has(error?.message)) {
    return namedError(error.message === "SessionClosed" ? CORE_MESSAGES.SessionClosed : error.message);
  }
  return namedError("The native Reference Library operation failed.");
}

export function rendererSafeCoreRestartEvent() {
  return { event: "core_needs_restart", value: {
    reason: "Reference Core stopped. Writes are frozen until restart.",
  } };
}

function namedError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function bounded(message) {
  return typeof message === "string" && message && message.length <= 300
    ? message : "The native operation received an invalid argument.";
}

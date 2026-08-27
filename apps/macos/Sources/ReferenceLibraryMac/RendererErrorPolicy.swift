import Foundation

enum RendererErrorPolicy {
    private static let messages: [String: String] = [
        "LibraryIntegrityFailedPreserved": "This Library failed integrity checks and was preserved unchanged. Open a backup or copy; no repair was attempted.",
        "LibraryDatabaseIntegrityInvalid": "This Library failed integrity checks and was preserved unchanged. Open a backup or copy; no repair was attempted.",
        "LibraryMigrationLedgerInvalid": "This Library migration ledger is invalid and was preserved unchanged. Open a backup or copy; no repair was attempted.",
        "LibraryManifestInvalid": "The selected Library package is invalid.",
        "LibrarySchemaUnsupported": "This Library was created by a newer Reference Library version.",
        "LibraryLockedByOtherWriter": "This Library is open in another writer.",
        "SessionClosed": "The Library session is closed.",
        "RootPermissionRequired": "The Source Root needs permission.",
        "RootIdentityMismatch": "The selected folder does not match this Source Root.",
        "AssetRevisionConflict": "The Asset changed. Refresh it before saving again.",
        "RenditionQueueFull": "Preview generation is busy. Try again shortly.",
        "ProtocolVersionUnsupported": "The native shell and Reference Core versions do not match."
    ]

    static func message(code: String) -> String {
        messages[code] ?? "Reference Core could not complete the operation."
    }

    static let restartReason = "Reference Core stopped. Writes are frozen until restart."
}

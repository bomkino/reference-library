use std::{io, path::PathBuf};

use reference_protocol::ProtocolError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("manifest JSON error: {0}")]
    ManifestJson(#[from] serde_json::Error),
    #[error("Library destination already exists: {0}")]
    DestinationExists(PathBuf),
    #[error("Library path must end in .pitchlibrary: {0}")]
    InvalidPackageExtension(PathBuf),
    #[error("Library manifest is invalid: {0}")]
    InvalidManifest(String),
    #[error("Library database integrity check failed: {0}")]
    DatabaseIntegrity(String),
    #[error("migration ledger does not match embedded schema {0}")]
    MigrationLedgerInvalid(u32),
    #[error("Library schema {actual} is newer than supported schema {supported}")]
    SchemaUnsupported { actual: u32, supported: u32 },
    #[error("Library is locked by another writer")]
    LibraryLockedByOtherWriter,
    #[error("unknown or closed session")]
    SessionClosed,
    #[error("Root path is not an authorized readable directory")]
    RootPermissionRequired,
    #[error("Root was not found")]
    RootNotFound,
    #[error("Root already has a scan in progress")]
    RootScanInProgress,
    #[error("Root scan capacity is currently full")]
    RootScanCapacityReached,
    #[error("Root scan exceeded a bounded directory traversal limit")]
    RootScanLimitExceeded,
    #[error("Library has reached the V1 Root limit")]
    RootLimitReached,
    #[error("selected directory does not match the Root's known file evidence")]
    RootIdentityMismatch,
    #[error("query page size {0} exceeds limit")]
    QueryPageTooLarge(u32),
    #[error("query is invalid: {0}")]
    QueryInvalid(String),
    #[error("query snapshot changed: expected Library revision {expected}, actual {actual}")]
    QuerySnapshotChanged { expected: u64, actual: u64 },
    #[error("a query record cannot fit the bounded protocol frame")]
    QueryResultTooLarge,
    #[error("Asset was not found")]
    AssetNotFound,
    #[error("Asset revision conflict: expected {expected}, actual {actual}")]
    AssetRevisionConflict { expected: u64, actual: u64 },
    #[error("Collection was not found")]
    CollectionNotFound,
    #[error("Collection name is already in use")]
    CollectionNameConflict,
    #[error("Collection revision conflict: expected {expected}, actual {actual}")]
    CollectionRevisionConflict { expected: u64, actual: u64 },
    #[error("Collection membership is invalid: {0}")]
    CollectionMembershipInvalid(String),
    #[error("Library has reached the V1 Collection limit")]
    CollectionLimitReached,
    #[error("Asset has reached the V1 Collection membership limit")]
    AssetCollectionLimitReached,
    #[error("Location was not found")]
    LocationNotFound,
    #[error("Location is missing or outside its authorized Root")]
    LocationMissing,
    #[error("source bytes no longer match the indexed SourceRevision; rescan required")]
    SourceRevisionChanged,
    #[error("preview is unsupported for this media type")]
    UnsupportedPreview,
    #[error("Asset resource exceeds the T01 512 MiB output limit")]
    ResourceTooLarge,
    #[error("image bytes are invalid or do not match the indexed media type")]
    RenditionInputInvalid,
    #[error("image exceeds bounded rendition limits")]
    RenditionLimitExceeded,
    #[error("bounded rendition timed out")]
    RenditionTimedOut,
    #[error("rendition cache is unavailable")]
    RenditionCacheFailure,
    #[error("rendition cache resolved inside canonical Library bytes")]
    RenditionCacheUnsafe,
    #[error("rendition authorization queue is full")]
    RenditionQueueFull,
    #[error("rendition generation was cancelled")]
    RenditionCancelled,
    #[error("raw paths are not valid resource identifiers")]
    RawPathResourceDenied,
    #[error("protocol version {0} is unsupported")]
    ProtocolVersionUnsupported(u32),
    #[error("canonical snapshot changed; request a new digest")]
    CanonicalSnapshotChanged,
    #[error("legacy canonical dump is too large; use canonical digest and pages")]
    CanonicalDumpTooLarge,
    #[error("test-only command is disabled")]
    TestCommandDisabled,
}

impl CoreError {
    pub fn to_protocol_error(&self) -> ProtocolError {
        let (code, retryable) = match self {
            Self::DestinationExists(_) => ("LibraryDestinationExists", false),
            Self::InvalidPackageExtension(_) | Self::InvalidManifest(_) => {
                ("LibraryManifestInvalid", false)
            }
            Self::DatabaseIntegrity(_) | Self::MigrationLedgerInvalid(_) => {
                ("LibraryIntegrityFailedPreserved", false)
            }
            Self::SchemaUnsupported { .. } => ("LibrarySchemaUnsupported", false),
            Self::LibraryLockedByOtherWriter => ("LibraryLockedByOtherWriter", true),
            Self::SessionClosed => ("SessionClosed", false),
            Self::RootPermissionRequired => ("RootPermissionRequired", true),
            Self::RootNotFound => ("RootNotFound", false),
            Self::RootScanInProgress => ("RootScanInProgress", true),
            Self::RootScanCapacityReached => ("RootScanCapacityReached", true),
            Self::RootScanLimitExceeded => ("RootScanLimitExceeded", false),
            Self::RootLimitReached => ("RootLimitReached", false),
            Self::RootIdentityMismatch => ("RootIdentityMismatch", false),
            Self::QueryPageTooLarge(_) | Self::QueryInvalid(_) => ("QueryInvalid", false),
            Self::QuerySnapshotChanged { .. } => ("QuerySnapshotChanged", true),
            Self::QueryResultTooLarge => ("QueryResultTooLarge", false),
            Self::AssetNotFound => ("AssetNotFound", false),
            Self::AssetRevisionConflict { .. } => ("AssetRevisionConflict", true),
            Self::CollectionNotFound => ("CollectionNotFound", false),
            Self::CollectionNameConflict => ("CollectionNameConflict", false),
            Self::CollectionRevisionConflict { .. } => ("CollectionRevisionConflict", true),
            Self::CollectionMembershipInvalid(_) => ("CollectionMembershipInvalid", false),
            Self::CollectionLimitReached => ("CollectionLimitReached", false),
            Self::AssetCollectionLimitReached => ("AssetCollectionLimitReached", false),
            Self::LocationNotFound => ("LocationNotFound", false),
            Self::LocationMissing => ("LocationMissing", true),
            Self::SourceRevisionChanged => ("SourceRevisionChanged", true),
            Self::UnsupportedPreview => ("UnsupportedPreview", false),
            Self::ResourceTooLarge => ("ResourceTooLarge", false),
            Self::RenditionInputInvalid => ("RenditionInputInvalid", false),
            Self::RenditionLimitExceeded => ("RenditionLimitExceeded", false),
            Self::RenditionTimedOut => ("RenditionTimedOut", true),
            Self::RenditionCacheFailure => ("RenditionCacheFailure", true),
            Self::RenditionCacheUnsafe => ("RenditionCacheUnsafe", false),
            Self::RenditionQueueFull => ("RenditionQueueFull", true),
            Self::RenditionCancelled => ("RenditionCancelled", true),
            Self::RawPathResourceDenied => ("RawPathResourceDenied", false),
            Self::ProtocolVersionUnsupported(_) => ("ProtocolVersionUnsupported", false),
            Self::CanonicalSnapshotChanged => ("CanonicalSnapshotChanged", true),
            Self::CanonicalDumpTooLarge => ("CanonicalDumpTooLarge", false),
            Self::TestCommandDisabled => ("TestCommandDisabled", false),
            Self::Io(_) | Self::Database(_) | Self::ManifestJson(_) => ("CoreFailure", true),
        };
        let message = match self {
            Self::DestinationExists(_) => "Library destination already exists".into(),
            Self::InvalidPackageExtension(_) => "Library path must end in .pitchlibrary".into(),
            Self::Io(_) | Self::Database(_) | Self::ManifestJson(_) => {
                "Core operation failed without changing source files".into()
            }
            _ => self.to_string(),
        };
        ProtocolError::new(code, message, retryable)
    }
}

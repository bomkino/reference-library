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
    #[error("Library schema {actual} is newer than supported schema {supported}")]
    SchemaUnsupported { actual: u32, supported: u32 },
    #[error("Library is locked by another writer")]
    LibraryLockedByOtherWriter,
    #[error("unknown or closed session")]
    SessionClosed,
    #[error("Root path is not an authorized readable directory")]
    RootPermissionRequired,
    #[error("query page size {0} exceeds limit")]
    QueryPageTooLarge(u32),
    #[error("Asset was not found")]
    AssetNotFound,
    #[error("Location was not found")]
    LocationNotFound,
    #[error("Location is missing or outside its authorized Root")]
    LocationMissing,
    #[error("preview is unsupported for this media type")]
    UnsupportedPreview,
    #[error("raw paths are not valid resource identifiers")]
    RawPathResourceDenied,
    #[error("protocol version {0} is unsupported")]
    ProtocolVersionUnsupported(u32),
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
            Self::SchemaUnsupported { .. } => ("LibrarySchemaUnsupported", false),
            Self::LibraryLockedByOtherWriter => ("LibraryLockedByOtherWriter", true),
            Self::SessionClosed => ("SessionClosed", false),
            Self::RootPermissionRequired => ("RootPermissionRequired", true),
            Self::QueryPageTooLarge(_) => ("QueryInvalid", false),
            Self::AssetNotFound => ("AssetNotFound", false),
            Self::LocationNotFound => ("LocationNotFound", false),
            Self::LocationMissing => ("LocationMissing", true),
            Self::UnsupportedPreview => ("UnsupportedPreview", false),
            Self::RawPathResourceDenied => ("RawPathResourceDenied", false),
            Self::ProtocolVersionUnsupported(_) => ("ProtocolVersionUnsupported", false),
            Self::TestCommandDisabled => ("TestCommandDisabled", false),
            Self::Io(_) | Self::Database(_) | Self::ManifestJson(_) => ("CoreFailure", true),
        };
        ProtocolError::new(code, self.to_string(), retryable)
    }
}

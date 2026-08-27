use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{SCHEMA_VERSION, error::CoreError, now_ms};
use reference_protocol::MAX_LIBRARY_NAME_CHARS;

pub const DOCUMENT_TYPE: &str = "io.pitchdog.reference-library";
pub const MANIFEST_VERSION: u32 = 1;
pub const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub document_type: String,
    pub manifest_version: u32,
    pub schema_version: u32,
    pub library_id: String,
    pub name: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

impl Manifest {
    pub fn new(name: String) -> Self {
        let timestamp = now_ms();
        Self {
            document_type: DOCUMENT_TYPE.into(),
            manifest_version: MANIFEST_VERSION,
            schema_version: SCHEMA_VERSION,
            library_id: Uuid::new_v4().to_string(),
            name,
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
        }
    }

    pub fn read(package_path: &Path) -> Result<Self, CoreError> {
        let path = package_path.join("manifest.json");
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_MANIFEST_BYTES
        {
            return Err(CoreError::InvalidManifest(
                "manifest storage is invalid or exceeds its byte limit".into(),
            ));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        open_manifest_nofollow(&path)?
            .take(MAX_MANIFEST_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(CoreError::InvalidManifest(
                "manifest exceeds its byte limit".into(),
            ));
        }
        let manifest: Self = serde_json::from_slice(&bytes)?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<(), CoreError> {
        if self.document_type != DOCUMENT_TYPE {
            return Err(CoreError::InvalidManifest("unknown documentType".into()));
        }
        if self.manifest_version != MANIFEST_VERSION {
            return Err(CoreError::InvalidManifest(format!(
                "unsupported manifestVersion {}",
                self.manifest_version
            )));
        }
        if self.schema_version > SCHEMA_VERSION {
            return Err(CoreError::SchemaUnsupported {
                actual: self.schema_version,
                supported: SCHEMA_VERSION,
            });
        }
        Uuid::parse_str(&self.library_id)
            .map_err(|_| CoreError::InvalidManifest("libraryId is not a UUID".into()))?;
        if self.name.trim().is_empty()
            || self.name.contains('\0')
            || self.name.chars().count() > MAX_LIBRARY_NAME_CHARS
        {
            return Err(CoreError::InvalidManifest("name is invalid".into()));
        }
        Ok(())
    }

    pub fn write_atomic(&self, package_path: &Path) -> Result<(), CoreError> {
        let target = package_path.join("manifest.json");
        let temporary = package_path.join(format!(".manifest-{}.tmp", Uuid::new_v4()));
        let bytes = serde_json::to_vec_pretty(self)?;
        if bytes.len() as u64 + 1 > MAX_MANIFEST_BYTES {
            return Err(CoreError::InvalidManifest(
                "manifest exceeds its byte limit".into(),
            ));
        }
        let mut file = fs::File::create(&temporary)?;
        file.write_all(&bytes)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        fs::rename(&temporary, &target)?;
        sync_directory(package_path)?;
        Ok(())
    }
}

fn open_manifest_nofollow(path: &Path) -> Result<File, CoreError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let file = options.open(path).map_err(|_| {
        CoreError::InvalidManifest("manifest storage could not be opened safely".into())
    })?;
    if !file
        .metadata()
        .map_err(|_| CoreError::InvalidManifest("manifest storage is invalid".into()))?
        .is_file()
    {
        return Err(CoreError::InvalidManifest(
            "manifest storage is invalid".into(),
        ));
    }
    Ok(file)
}

pub fn validate_package_extension(path: &Path) -> Result<(), CoreError> {
    if path.extension().and_then(|value| value.to_str()) != Some("pitchlibrary") {
        return Err(CoreError::InvalidPackageExtension(path.to_path_buf()));
    }
    Ok(())
}

pub fn staging_path(destination: &Path) -> PathBuf {
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Library.pitchlibrary");
    destination.with_file_name(format!(".{name}.creating-{}", Uuid::new_v4()))
}

fn sync_directory(path: &Path) -> Result<(), CoreError> {
    let directory = fs::File::open(path)?;
    directory.sync_all()?;
    Ok(())
}

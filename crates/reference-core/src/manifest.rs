use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{SCHEMA_VERSION, error::CoreError, now_ms};

pub const DOCUMENT_TYPE: &str = "io.pitchdog.reference-library";
pub const MANIFEST_VERSION: u32 = 1;

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
        let bytes = fs::read(package_path.join("manifest.json"))?;
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
        if self.name.trim().is_empty() {
            return Err(CoreError::InvalidManifest("name is empty".into()));
        }
        Ok(())
    }

    pub fn write_atomic(&self, package_path: &Path) -> Result<(), CoreError> {
        let target = package_path.join("manifest.json");
        let temporary = package_path.join(format!(".manifest-{}.tmp", Uuid::new_v4()));
        let bytes = serde_json::to_vec_pretty(self)?;
        let mut file = fs::File::create(&temporary)?;
        file.write_all(&bytes)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        fs::rename(&temporary, &target)?;
        sync_directory(package_path)?;
        Ok(())
    }
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

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::ffi::{OsStrExt, OsStringExt};

use reference_protocol::{
    AssetPage, AssetProjection, AssetSummary, MAX_PAGE_SIZE, NativeLocation, ResourceDescriptor,
    ResourceProfile, SessionOpened,
};
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

use crate::{
    canonical,
    discovery::ScanPlan,
    error::CoreError,
    manifest::{Manifest, staging_path, validate_package_extension},
    now_ms, schema,
};

pub struct LibrarySession {
    session_id: String,
    package_path: PathBuf,
    manifest: Manifest,
    connection: Option<Connection>,
    lock_file: Option<File>,
    closed: bool,
}

impl LibrarySession {
    pub fn create(destination: impl AsRef<Path>, name: String) -> Result<Self, CoreError> {
        let destination = destination.as_ref();
        validate_package_extension(destination)?;
        if destination.exists() {
            return Err(CoreError::DestinationExists(destination.to_path_buf()));
        }
        let parent = destination.parent().ok_or_else(|| {
            CoreError::InvalidManifest("Library destination has no parent".into())
        })?;
        fs::create_dir_all(parent)?;
        let staging = staging_path(destination);
        let build_result = (|| -> Result<(), CoreError> {
            fs::create_dir(&staging)?;
            fs::create_dir(staging.join("embedded"))?;
            let manifest = Manifest::new(name);
            manifest.write_atomic(&staging)?;
            let connection = schema::create_database(&staging.join("library.sqlite"), &manifest)?;
            connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            drop(connection);
            fs::write(
                staging.join("README.txt"),
                "Reference Library package. Open with pitch.dog Reference Library.\n",
            )?;
            File::open(&staging)?.sync_all()?;
            fs::rename(&staging, destination)?;
            File::open(parent)?.sync_all()?;
            Ok(())
        })();
        if build_result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        build_result?;
        Self::open(destination)
    }

    pub fn open(package_path: impl AsRef<Path>) -> Result<Self, CoreError> {
        let package_path = package_path.as_ref();
        validate_package_extension(package_path)?;
        let manifest = Manifest::read(package_path)?;
        let lock_path = package_path.join(".writer.lock");
        let mut lock_file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&lock_path)?;
        lock_file
            .try_lock()
            .map_err(|_| CoreError::LibraryLockedByOtherWriter)?;
        lock_file.set_len(0)?;
        writeln!(
            lock_file,
            "{{\"libraryId\":\"{}\",\"processId\":{},\"openedAtMs\":{}}}",
            manifest.library_id,
            std::process::id(),
            now_ms()
        )?;
        lock_file.sync_all()?;

        let connection =
            match schema::open_database(&package_path.join("library.sqlite"), &manifest) {
                Ok(connection) => connection,
                Err(error) => {
                    let _ = lock_file.unlock();
                    return Err(error);
                }
            };
        recover_interrupted_scan(&connection)?;
        Ok(Self {
            session_id: Uuid::new_v4().to_string(),
            package_path: package_path.to_path_buf(),
            manifest,
            connection: Some(connection),
            lock_file: Some(lock_file),
            closed: false,
        })
    }

    pub fn opened(&self) -> SessionOpened {
        SessionOpened {
            session_id: self.session_id.clone(),
            library_id: self.manifest.library_id.clone(),
            schema_version: self.manifest.schema_version,
            name: self.manifest.name.clone(),
        }
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn package_path(&self) -> &Path {
        &self.package_path
    }

    pub fn add_root(
        &self,
        authorized_path: impl AsRef<Path>,
        display_name: String,
    ) -> Result<ScanPlan, CoreError> {
        let connection = self.connection()?;
        let root_path = authorized_path
            .as_ref()
            .canonicalize()
            .map_err(|_| CoreError::RootPermissionRequired)?;
        if !root_path.is_dir() || display_name.trim().is_empty() {
            return Err(CoreError::RootPermissionRequired);
        }
        let path_text = root_path.to_string_lossy().into_owned();
        let root_id: Option<String> = connection
            .query_row(
                "SELECT id FROM roots
                 WHERE library_id = ?1 AND last_known_display_path = ?2
                 ORDER BY created_at_ms LIMIT 1",
                params![self.manifest.library_id, path_text],
                |row| row.get(0),
            )
            .optional()?;
        let root_id = root_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let job_id = Uuid::new_v4().to_string();
        let timestamp = now_ms() as i64;
        let transaction = connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO roots (
                id, library_id, display_name, root_kind, last_known_display_path,
                state, scan_policy_json, created_at_ms, updated_at_ms, last_seen_at_ms
             ) VALUES (?1, ?2, ?3, 'linked', ?4, 'scanning', '{}', ?5, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET
                display_name = excluded.display_name,
                last_known_display_path = excluded.last_known_display_path,
                state = 'scanning', updated_at_ms = excluded.updated_at_ms,
                last_seen_at_ms = excluded.last_seen_at_ms",
            params![
                root_id,
                self.manifest.library_id,
                display_name,
                path_text,
                timestamp
            ],
        )?;
        transaction.execute(
            "INSERT INTO jobs (
                id, library_id, job_kind, state, progress_json,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'initial_scan', 'running',
                       '{\"observedCount\":0}', ?3, ?3)",
            params![job_id, self.manifest.library_id, timestamp],
        )?;
        bump_revision(&transaction, timestamp)?;
        transaction.commit()?;
        Ok(ScanPlan {
            package_path: self.package_path.clone(),
            root_path,
            library_id: self.manifest.library_id.clone(),
            root_id,
            job_id,
        })
    }

    pub fn query_assets(
        &self,
        offset: u64,
        limit: u32,
        _projection: AssetProjection,
    ) -> Result<AssetPage, CoreError> {
        if limit == 0 || limit > MAX_PAGE_SIZE {
            return Err(CoreError::QueryPageTooLarge(limit));
        }
        let connection = self.connection()?;
        let total = connection.query_row(
            "SELECT COUNT(*) FROM assets WHERE library_id = ?1",
            params![self.manifest.library_id],
            |row| row.get::<_, i64>(0),
        )? as u64;
        let mut statement = connection.prepare(
            "SELECT a.id, l.id, l.relative_path_display, s.media_family,
                    l.state, a.review_state
             FROM assets a
             JOIN asset_origins ao ON ao.asset_id = a.id
             JOIN sources s ON s.id = ao.source_id
             JOIN locations l ON l.source_id = s.id
             WHERE a.library_id = ?1
             ORDER BY a.created_at_ms, a.id
             LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![self.manifest.library_id, limit as i64, offset as i64],
                |row| {
                    Ok(AssetSummary {
                        asset_id: row.get(0)?,
                        location_id: row.get(1)?,
                        display_name: row.get(2)?,
                        media_family: row.get(3)?,
                        availability: row.get(4)?,
                        review_state: row.get(5)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let library_revision = connection.query_row(
            "SELECT library_revision FROM library_meta LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )? as u64;
        let returned = items.len() as u64;
        Ok(AssetPage {
            offset,
            limit,
            total,
            items,
            next_offset: (offset + returned < total).then_some(offset + returned),
            library_revision,
        })
    }

    pub fn authorize_resource(
        &self,
        asset_id: &str,
        profile: ResourceProfile,
    ) -> Result<ResourceDescriptor, CoreError> {
        reject_path_shaped_id(asset_id)?;
        Uuid::parse_str(asset_id).map_err(|_| CoreError::AssetNotFound)?;
        let connection = self.connection()?;
        let record = connection
            .query_row(
                "SELECT l.id, r.last_known_display_path, l.relative_path_bytes,
                        sr.mime_detected, sr.byte_size, l.state
                 FROM assets a
                 JOIN asset_origins ao ON ao.asset_id = a.id
                 JOIN sources s ON s.id = ao.source_id
                 JOIN source_revisions sr ON sr.id = s.current_revision_id
                 JOIN locations l ON l.source_id = s.id
                 JOIN roots r ON r.id = l.root_id
                 WHERE a.id = ?1
                 ORDER BY CASE l.state WHEN 'present' THEN 0 ELSE 1 END, l.created_at_ms
                 LIMIT 1",
                params![asset_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)? as u64,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or(CoreError::AssetNotFound)?;
        let (location_id, root_path, relative_bytes, mime_type, content_length, state) = record;
        if state != "present" {
            return Err(CoreError::LocationMissing);
        }
        if !matches!(
            mime_type.as_str(),
            "image/jpeg" | "image/png" | "image/webp"
        ) {
            return Err(CoreError::UnsupportedPreview);
        }
        let native_path = resolve_authorized_path(root_path, relative_bytes)?;
        let observed_length = native_path.metadata()?.len();
        if observed_length != content_length {
            return Err(CoreError::LocationMissing);
        }
        Ok(ResourceDescriptor {
            resource_token: Uuid::new_v4().to_string(),
            session_id: self.session_id.clone(),
            asset_id: asset_id.into(),
            location_id,
            profile,
            mime_type,
            content_length,
            native_path_for_handler: native_path.to_string_lossy().into_owned(),
        })
    }

    pub fn resolve_location(&self, location_id: &str) -> Result<NativeLocation, CoreError> {
        reject_path_shaped_id(location_id)?;
        Uuid::parse_str(location_id).map_err(|_| CoreError::LocationNotFound)?;
        let connection = self.connection()?;
        let record = connection
            .query_row(
                "SELECT r.last_known_display_path, l.relative_path_bytes, l.state
                 FROM locations l JOIN roots r ON r.id = l.root_id
                 WHERE l.id = ?1",
                params![location_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or(CoreError::LocationNotFound)?;
        if record.2 != "present" {
            return Err(CoreError::LocationMissing);
        }
        let path = resolve_authorized_path(record.0, record.1)?;
        Ok(NativeLocation {
            location_id: location_id.into(),
            native_path_for_shell: path.to_string_lossy().into_owned(),
        })
    }

    pub fn canonical_dump(&self) -> Result<serde_json::Value, CoreError> {
        canonical::generate(self.connection()?)
    }

    pub fn job_state(&self, job_id: &str) -> Result<Option<String>, CoreError> {
        Ok(self
            .connection()?
            .query_row(
                "SELECT state FROM jobs WHERE id = ?1",
                params![job_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn close(&mut self) -> Result<(), CoreError> {
        if self.closed {
            return Ok(());
        }
        if let Some(connection) = self.connection.take() {
            connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            drop(connection);
        }
        self.manifest.updated_at_ms = now_ms();
        self.manifest.write_atomic(&self.package_path)?;
        if let Some(file) = self.lock_file.take() {
            file.unlock()?;
        }
        let _ = fs::remove_file(self.package_path.join(".writer.lock"));
        self.closed = true;
        Ok(())
    }

    fn connection(&self) -> Result<&Connection, CoreError> {
        if self.closed {
            return Err(CoreError::SessionClosed);
        }
        self.connection.as_ref().ok_or(CoreError::SessionClosed)
    }
}

impl Drop for LibrarySession {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

fn recover_interrupted_scan(connection: &Connection) -> Result<(), CoreError> {
    let timestamp = now_ms() as i64;
    let changed_jobs = connection.execute(
        "UPDATE jobs SET state = 'failed', error_code = 'CoreRestarted',
                         updated_at_ms = ?1, finished_at_ms = ?1
         WHERE state IN ('queued', 'running')",
        params![timestamp],
    )?;
    let changed_roots = connection.execute(
        "UPDATE roots SET state = 'error', updated_at_ms = ?1 WHERE state = 'scanning'",
        params![timestamp],
    )?;
    if changed_jobs > 0 || changed_roots > 0 {
        bump_revision(connection, timestamp)?;
    }
    Ok(())
}

pub(crate) fn bump_revision(connection: &Connection, timestamp: i64) -> Result<u64, CoreError> {
    Ok(connection.query_row(
        "UPDATE library_meta
         SET library_revision = library_revision + 1, updated_at_ms = ?1
         RETURNING library_revision",
        params![timestamp],
        |row| row.get::<_, i64>(0),
    )? as u64)
}

fn reject_path_shaped_id(value: &str) -> Result<(), CoreError> {
    if value.contains('/') || value.contains('\\') || value.contains("..") || value.contains(':') {
        return Err(CoreError::RawPathResourceDenied);
    }
    Ok(())
}

fn resolve_authorized_path(
    root_path: Option<String>,
    relative_bytes: Vec<u8>,
) -> Result<PathBuf, CoreError> {
    let root_path = root_path.ok_or(CoreError::RootPermissionRequired)?;
    let root = PathBuf::from(root_path)
        .canonicalize()
        .map_err(|_| CoreError::RootPermissionRequired)?;
    #[cfg(unix)]
    let relative = PathBuf::from(std::ffi::OsString::from_vec(relative_bytes));
    #[cfg(not(unix))]
    let relative = PathBuf::from(String::from_utf8_lossy(&relative_bytes).into_owned());
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(CoreError::LocationMissing);
    }
    let candidate = root.join(relative);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| CoreError::LocationMissing)?;
    if !canonical.starts_with(&root) || !canonical.is_file() {
        return Err(CoreError::LocationMissing);
    }
    Ok(canonical)
}

#[cfg(unix)]
pub(crate) fn relative_path_bytes(path: &Path) -> Vec<u8> {
    path.as_os_str().as_bytes().to_vec()
}

#[cfg(not(unix))]
pub(crate) fn relative_path_bytes(path: &Path) -> Vec<u8> {
    path.to_string_lossy().as_bytes().to_vec()
}

pub(crate) fn read_prefix(path: &Path, maximum: usize) -> Result<Vec<u8>, CoreError> {
    let mut file = File::open(path)?;
    let mut bytes = vec![0; maximum];
    let read = file.read(&mut bytes)?;
    bytes.truncate(read);
    Ok(bytes)
}

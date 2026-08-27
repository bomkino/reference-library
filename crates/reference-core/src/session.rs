use std::{
    cell::RefCell,
    collections::HashMap,
    ffi::CString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
};

#[cfg(unix)]
use std::{
    os::fd::{AsRawFd, FromRawFd},
    os::unix::{
        ffi::{OsStrExt, OsStringExt},
        fs::MetadataExt,
    },
};

use reference_protocol::{
    AssetDetail, AssetPage, AssetPatch, AssetProjection, AssetQuery, CollectionSummary, JobPage,
    JobQuery, NativeLocation, ResourceDescriptor, ResourceProfile, ReviewState, RootSummary,
    SessionOpened, TextPatch,
};
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

use crate::{
    canonical,
    discovery::ScanPlan,
    editorial,
    error::CoreError,
    manifest::{Manifest, staging_path, validate_package_extension},
    now_ms,
    rendition::{self, ResourcePlan},
    schema,
};

pub struct LibrarySession {
    session_id: String,
    package_path: PathBuf,
    manifest: Manifest,
    connection: Option<Connection>,
    lock_file: Option<File>,
    authorized_roots: RefCell<HashMap<String, AuthorizedRoot>>,
    closed: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct AuthorizedRoot {
    canonical_path: PathBuf,
    #[cfg(unix)]
    directory: Arc<File>,
}

impl AuthorizedRoot {
    pub(crate) fn open(path: &Path) -> Result<Self, CoreError> {
        let canonical_path = path
            .canonicalize()
            .map_err(|_| CoreError::RootPermissionRequired)?;
        let expected =
            fs::metadata(&canonical_path).map_err(|_| CoreError::RootPermissionRequired)?;
        if !expected.is_dir() {
            return Err(CoreError::RootPermissionRequired);
        }
        #[cfg(unix)]
        {
            let directory = open_canonical_directory(&canonical_path)?;
            let actual = directory
                .metadata()
                .map_err(|_| CoreError::RootPermissionRequired)?;
            if actual.dev() != expected.dev() || actual.ino() != expected.ino() {
                return Err(CoreError::RootIdentityMismatch);
            }
            Ok(Self {
                canonical_path,
                directory: Arc::new(directory),
            })
        }
        #[cfg(not(unix))]
        Ok(Self { canonical_path })
    }

    pub(crate) fn path(&self) -> &Path {
        &self.canonical_path
    }

    #[cfg(unix)]
    pub(crate) fn directory(&self) -> Arc<File> {
        Arc::clone(&self.directory)
    }

    pub(crate) fn open_file(&self, relative_bytes: &[u8]) -> Result<File, CoreError> {
        let relative = relative_path_from_bytes(relative_bytes)?;
        validate_relative(&relative)?;
        #[cfg(unix)]
        {
            open_relative_file(self.directory.as_ref(), &relative)
                .map_err(|_| CoreError::LocationMissing)
        }
        #[cfg(not(unix))]
        {
            let candidate = self.canonical_path.join(&relative);
            let before =
                fs::symlink_metadata(&candidate).map_err(|_| CoreError::LocationMissing)?;
            if !before.is_file() || before.file_type().is_symlink() {
                return Err(CoreError::LocationMissing);
            }
            let file = File::open(&candidate).map_err(|_| CoreError::LocationMissing)?;
            let after = file.metadata().map_err(|_| CoreError::LocationMissing)?;
            if before.len() != after.len() {
                return Err(CoreError::LocationMissing);
            }
            Ok(file)
        }
    }

    fn same_directory(&self, other: &Self) -> bool {
        #[cfg(unix)]
        {
            let (Ok(left), Ok(right)) = (self.directory.metadata(), other.directory.metadata())
            else {
                return false;
            };
            left.dev() == right.dev() && left.ino() == right.ino()
        }
        #[cfg(not(unix))]
        {
            self.canonical_path == other.canonical_path
        }
    }
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
            authorized_roots: RefCell::new(HashMap::new()),
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
        let authority = AuthorizedRoot::open(authorized_path.as_ref())?;
        let root_path = authority.path().to_path_buf();
        if display_name.trim().is_empty() {
            return Err(CoreError::RootPermissionRequired);
        }
        let path_text = root_path.to_string_lossy().into_owned();
        let mut root_id = self
            .authorized_roots
            .borrow()
            .iter()
            .find(|(_, existing)| existing.same_directory(&authority))
            .map(|(root_id, _)| root_id.clone());
        if root_id.is_none() {
            let candidates = {
                let mut statement = connection.prepare(
                    "SELECT id FROM roots WHERE library_id=?1 AND last_known_display_path=?2
                     ORDER BY created_at_ms,id",
                )?;
                statement
                    .query_map(params![self.manifest.library_id, path_text], |row| {
                        row.get(0)
                    })?
                    .collect::<Result<Vec<String>, _>>()?
            };
            let matches = candidates
                .into_iter()
                .filter(|candidate| {
                    validate_root_evidence(connection, candidate, &authority).is_ok()
                })
                .collect::<Vec<_>>();
            if let [matched] = matches.as_slice() {
                root_id = Some(matched.clone());
            }
        }
        let root_id = root_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let active: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM jobs
             WHERE root_id = ?1 AND state IN ('queued', 'running'))",
            params![root_id],
            |row| row.get(0),
        )?;
        if active {
            return Err(CoreError::RootScanInProgress);
        }
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
                id, library_id, job_kind, state, progress_json, root_id,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'initial_scan', 'running',
                       '{\"observedCount\":0,\"unsupportedCount\":0}', ?3, ?4, ?4)",
            params![job_id, self.manifest.library_id, root_id, timestamp],
        )?;
        bump_revision(&transaction, timestamp)?;
        transaction.commit()?;
        self.authorized_roots
            .borrow_mut()
            .insert(root_id.clone(), authority.clone());
        Ok(ScanPlan {
            package_path: self.package_path.clone(),
            root_path,
            library_id: self.manifest.library_id.clone(),
            root_id,
            job_id,
            #[cfg(unix)]
            root_directory: authority.directory(),
        })
    }

    pub fn list_roots(&self) -> Result<Vec<RootSummary>, CoreError> {
        let connection = self.connection()?;
        let authorized = self.authorized_roots.borrow();
        let mut statement = connection.prepare(
            "SELECT r.id, r.display_name, r.root_kind, r.state,
                    CASE WHEN j.state IN ('queued', 'running') THEN j.id END,
                    j.progress_json
             FROM roots r
             LEFT JOIN jobs j ON j.id = (
                 SELECT id FROM jobs
                 WHERE root_id = r.id
                 ORDER BY created_at_ms DESC, id DESC LIMIT 1
             )
             WHERE r.library_id = ?1 ORDER BY r.created_at_ms, r.id",
        )?;
        Ok(statement
            .query_map(params![self.manifest.library_id], |row| {
                let root_id: String = row.get(0)?;
                let progress = row
                    .get::<_, Option<String>>(5)?
                    .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
                    .unwrap_or_default();
                Ok(RootSummary {
                    authorized: authorized.contains_key(&root_id),
                    root_id,
                    display_name: row.get(1)?,
                    root_kind: row.get(2)?,
                    state: row.get(3)?,
                    active_job_id: row.get(4)?,
                    observed_count: progress["observedCount"].as_u64().unwrap_or_default(),
                    unsupported_count: progress["unsupportedCount"].as_u64().unwrap_or_default(),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn query_roots(&self) -> Result<Vec<RootSummary>, CoreError> {
        self.list_roots()
    }

    pub fn bind_root(
        &self,
        root_id: &str,
        authorized_path: impl AsRef<Path>,
    ) -> Result<RootSummary, CoreError> {
        validate_uuid(root_id, CoreError::RootNotFound)?;
        let connection = self.connection()?;
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM roots WHERE id = ?1 AND library_id = ?2)",
            params![root_id, self.manifest.library_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(CoreError::RootNotFound);
        }
        let active: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM jobs WHERE root_id=?1 AND state IN ('queued','running'))",
            params![root_id],
            |row| row.get(0),
        )?;
        if active {
            return Err(CoreError::RootScanInProgress);
        }
        let authority = AuthorizedRoot::open(authorized_path.as_ref())?;
        validate_root_evidence(connection, root_id, &authority)?;
        let timestamp = now_ms() as i64;
        let transaction = connection.unchecked_transaction()?;
        let active: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM jobs WHERE root_id=?1 AND state IN ('queued','running'))",
            params![root_id],
            |row| row.get(0),
        )?;
        if active {
            return Err(CoreError::RootScanInProgress);
        }
        transaction.execute(
            "UPDATE roots SET last_known_display_path = ?1, state = 'connected',
                              updated_at_ms = ?2, last_seen_at_ms = ?2 WHERE id = ?3",
            params![authority.path().to_string_lossy(), timestamp, root_id],
        )?;
        bump_revision(&transaction, timestamp)?;
        transaction.commit()?;
        self.authorized_roots
            .borrow_mut()
            .insert(root_id.to_owned(), authority);
        self.list_roots()?
            .into_iter()
            .find(|root| root.root_id == root_id)
            .ok_or(CoreError::RootNotFound)
    }

    pub fn reauthorize_root(
        &self,
        root_id: &str,
        authorized_path: impl AsRef<Path>,
    ) -> Result<RootSummary, CoreError> {
        self.bind_root(root_id, authorized_path)
    }

    pub fn scan_bound_root(&self, root_id: &str) -> Result<ScanPlan, CoreError> {
        validate_uuid(root_id, CoreError::RootNotFound)?;
        let connection = self.connection()?;
        let authority = self
            .authorized_roots
            .borrow()
            .get(root_id)
            .cloned()
            .ok_or(CoreError::RootPermissionRequired)?;
        let active: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM jobs
             WHERE root_id = ?1 AND state IN ('queued', 'running'))",
            params![root_id],
            |row| row.get(0),
        )?;
        if active {
            return Err(CoreError::RootScanInProgress);
        }
        let job_id = Uuid::new_v4().to_string();
        let timestamp = now_ms() as i64;
        let transaction = connection.unchecked_transaction()?;
        let changed = transaction.execute(
            "UPDATE roots SET state = 'scanning', updated_at_ms = ?1
             WHERE id = ?2 AND library_id = ?3",
            params![timestamp, root_id, self.manifest.library_id],
        )?;
        if changed == 0 {
            return Err(CoreError::RootNotFound);
        }
        transaction.execute(
            "INSERT INTO jobs (
                id, library_id, job_kind, state, progress_json, root_id,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'initial_scan', 'running',
                       '{\"observedCount\":0,\"unsupportedCount\":0}', ?3, ?4, ?4)",
            params![job_id, self.manifest.library_id, root_id, timestamp],
        )?;
        bump_revision(&transaction, timestamp)?;
        transaction.commit()?;
        Ok(ScanPlan {
            package_path: self.package_path.clone(),
            root_path: authority.path().to_path_buf(),
            library_id: self.manifest.library_id.clone(),
            root_id: root_id.to_owned(),
            job_id,
            #[cfg(unix)]
            root_directory: authority.directory(),
        })
    }

    pub fn rescan_root(&self, root_id: &str) -> Result<ScanPlan, CoreError> {
        self.scan_bound_root(root_id)
    }

    pub fn query_assets(
        &self,
        offset: u64,
        limit: u32,
        _projection: AssetProjection,
    ) -> Result<AssetPage, CoreError> {
        editorial::query_assets(
            self.connection()?,
            &self.manifest.library_id,
            offset,
            limit,
            _projection,
            &AssetQuery::default(),
        )
    }

    pub fn query_asset_index(
        &self,
        offset: u64,
        limit: u32,
        projection: AssetProjection,
        query: &AssetQuery,
    ) -> Result<AssetPage, CoreError> {
        editorial::query_assets(
            self.connection()?,
            &self.manifest.library_id,
            offset,
            limit,
            projection,
            query,
        )
    }

    pub fn get_asset(&self, asset_id: &str) -> Result<AssetDetail, CoreError> {
        editorial::get_asset(self.connection()?, &self.manifest.library_id, asset_id)
    }

    pub fn update_asset(
        &self,
        asset_id: &str,
        expected_revision: u64,
        patch: AssetPatch,
    ) -> Result<(AssetDetail, u64), CoreError> {
        editorial::update_asset(
            self.connection()?,
            &self.manifest.library_id,
            asset_id,
            expected_revision,
            patch,
        )
    }

    pub fn update_asset_review(
        &self,
        asset_id: &str,
        expected_revision: u64,
        review_state: ReviewState,
    ) -> Result<(AssetDetail, u64), CoreError> {
        self.update_asset(
            asset_id,
            expected_revision,
            AssetPatch {
                custom_title: TextPatch::Unchanged,
                review_state: Some(review_state),
                note: TextPatch::Unchanged,
            },
        )
    }

    pub fn update_asset_title(
        &self,
        asset_id: &str,
        expected_revision: u64,
        title: Option<&str>,
    ) -> Result<(AssetDetail, u64), CoreError> {
        self.update_asset(
            asset_id,
            expected_revision,
            AssetPatch {
                custom_title: title
                    .map(|value| TextPatch::Set(value.to_owned()))
                    .unwrap_or(TextPatch::Clear),
                review_state: None,
                note: TextPatch::Unchanged,
            },
        )
    }

    pub fn update_asset_note(
        &self,
        asset_id: &str,
        expected_revision: u64,
        note: Option<&str>,
    ) -> Result<(AssetDetail, u64), CoreError> {
        self.update_asset(
            asset_id,
            expected_revision,
            AssetPatch {
                custom_title: TextPatch::Unchanged,
                review_state: None,
                note: note
                    .map(|value| TextPatch::Set(value.to_owned()))
                    .unwrap_or(TextPatch::Clear),
            },
        )
    }

    pub fn query_jobs(
        &self,
        offset: u64,
        limit: u32,
        query: &JobQuery,
    ) -> Result<JobPage, CoreError> {
        editorial::query_jobs(
            self.connection()?,
            &self.manifest.library_id,
            offset,
            limit,
            query,
        )
    }

    pub fn list_collections(&self) -> Result<Vec<CollectionSummary>, CoreError> {
        editorial::list_collections(self.connection()?, &self.manifest.library_id)
    }

    pub fn create_collection(&self, name: &str) -> Result<(CollectionSummary, u64), CoreError> {
        editorial::create_collection(self.connection()?, &self.manifest.library_id, name)
    }

    pub fn rename_collection(
        &self,
        collection_id: &str,
        expected_revision: u64,
        name: &str,
    ) -> Result<(CollectionSummary, u64), CoreError> {
        editorial::rename_collection(
            self.connection()?,
            &self.manifest.library_id,
            collection_id,
            expected_revision,
            name,
        )
    }

    pub fn delete_collection(&self, collection_id: &str) -> Result<u64, CoreError> {
        editorial::delete_collection(self.connection()?, &self.manifest.library_id, collection_id)
    }

    pub fn set_collection_membership(
        &self,
        collection_id: &str,
        asset_ids: &[String],
        member: bool,
    ) -> Result<(u64, u64), CoreError> {
        editorial::set_collection_membership(
            self.connection()?,
            &self.manifest.library_id,
            collection_id,
            asset_ids,
            member,
        )
    }

    pub fn add_assets_to_collection(
        &self,
        collection_id: &str,
        asset_ids: &[String],
    ) -> Result<(u64, u64), CoreError> {
        self.set_collection_membership(collection_id, asset_ids, true)
    }

    pub fn remove_assets_from_collection(
        &self,
        collection_id: &str,
        asset_ids: &[String],
    ) -> Result<(u64, u64), CoreError> {
        self.set_collection_membership(collection_id, asset_ids, false)
    }

    pub fn authorize_resource(
        &self,
        asset_id: &str,
        profile: ResourceProfile,
    ) -> Result<ResourceDescriptor, CoreError> {
        let plan = self.resource_plan(asset_id, profile, None)?;
        rendition::authorize(plan, &AtomicBool::new(false))
    }

    pub fn start_resource_authorization(
        &self,
        asset_id: &str,
        profile: ResourceProfile,
    ) -> Result<(String, ResourcePlan), CoreError> {
        let job_id = Uuid::new_v4().to_string();
        let plan = self.resource_plan(asset_id, profile, Some(job_id.clone()))?;
        let timestamp = now_ms() as i64;
        let transaction = self.connection()?.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO jobs (id,library_id,job_kind,state,progress_json,root_id,created_at_ms,updated_at_ms)
             VALUES (?1,?2,'rendition_generation','queued','{\"phase\":\"queued\"}',?3,?4,?4)",
            params![job_id, self.manifest.library_id, plan.root_id, timestamp],
        )?;
        rendition::prune_jobs(&transaction)?;
        transaction.commit()?;
        Ok((job_id, plan))
    }

    pub fn fail_resource_job(&self, job_id: &str, error: &CoreError) -> Result<(), CoreError> {
        let timestamp = now_ms() as i64;
        self.connection()?.execute(
            "UPDATE jobs SET state='failed',error_code=?1,updated_at_ms=?2,finished_at_ms=?2
             WHERE id=?3 AND job_kind='rendition_generation'",
            params![error.to_protocol_error().code, timestamp, job_id],
        )?;
        Ok(())
    }

    fn resource_plan(
        &self,
        asset_id: &str,
        profile: ResourceProfile,
        job_id: Option<String>,
    ) -> Result<ResourcePlan, CoreError> {
        reject_path_shaped_id(asset_id)?;
        Uuid::parse_str(asset_id).map_err(|_| CoreError::AssetNotFound)?;
        let connection = self.connection()?;
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1 AND library_id=?2)",
            params![asset_id, self.manifest.library_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(CoreError::AssetNotFound);
        }
        let records = {
            let mut statement = connection.prepare(
                "SELECT l.id,l.root_id,l.relative_path_bytes,l.state,sr.id,sr.mime_detected,
                        sr.byte_size,sr.quick_fingerprint
                 FROM asset_origins ao JOIN sources s ON s.id=ao.source_id
                 JOIN source_revisions sr ON sr.id=s.current_revision_id
                 JOIN locations l ON l.source_id=s.id WHERE ao.asset_id=?1
                 ORDER BY CASE l.state WHEN 'present' THEN 0 ELSE 1 END,l.created_at_ms,l.id",
            )?;
            statement
                .query_map(params![asset_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, i64>(6)? as u64,
                        row.get::<_, Option<String>>(7)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        let authorized = self.authorized_roots.borrow();
        let mut saw_present = false;
        for (
            location_id,
            root_id,
            relative_bytes,
            state,
            source_revision_id,
            mime_type,
            source_length,
            fingerprint,
        ) in records
        {
            if state != "present" {
                continue;
            }
            saw_present = true;
            if !matches!(
                mime_type.as_str(),
                "image/jpeg" | "image/png" | "image/webp"
            ) {
                return Err(CoreError::UnsupportedPreview);
            }
            if source_length > rendition::MAX_SOURCE_BYTES {
                return Err(CoreError::ResourceTooLarge);
            }
            let Some(authority) = authorized.get(&root_id) else {
                continue;
            };
            let source_file = authority.open_file(&relative_bytes)?;
            return Ok(ResourcePlan {
                package_path: self.package_path.clone(),
                library_id: self.manifest.library_id.clone(),
                session_id: self.session_id.clone(),
                asset_id: asset_id.into(),
                location_id,
                root_id,
                source_revision_id,
                profile,
                source_mime_type: mime_type,
                source_length,
                expected_fingerprint: fingerprint.ok_or(CoreError::SourceRevisionChanged)?,
                source_file,
                job_id,
            });
        }
        if saw_present {
            Err(CoreError::RootPermissionRequired)
        } else {
            Err(CoreError::UnsupportedPreview)
        }
    }

    pub fn resolve_location(&self, location_id: &str) -> Result<NativeLocation, CoreError> {
        reject_path_shaped_id(location_id)?;
        Uuid::parse_str(location_id).map_err(|_| CoreError::LocationNotFound)?;
        let connection = self.connection()?;
        let record = connection
            .query_row(
                "SELECT l.root_id,l.relative_path_bytes,l.state FROM locations l WHERE l.id=?1",
                params![location_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
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
        let authority = self
            .authorized_roots
            .borrow()
            .get(&record.0)
            .cloned()
            .ok_or(CoreError::RootPermissionRequired)?;
        let _verified = authority.open_file(&record.1)?;
        let relative = relative_path_from_bytes(&record.1)?;
        validate_relative(&relative)?;
        let path = authority.path().join(relative);
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

fn validate_uuid(value: &str, error: CoreError) -> Result<(), CoreError> {
    if reject_path_shaped_id(value).is_err() || Uuid::parse_str(value).is_err() {
        return Err(error);
    }
    Ok(())
}

fn validate_root_evidence(
    connection: &Connection,
    root_id: &str,
    authority: &AuthorizedRoot,
) -> Result<(), CoreError> {
    let total = connection.query_row(
        "SELECT COUNT(*) FROM locations WHERE root_id = ?1",
        params![root_id],
        |row| row.get::<_, i64>(0),
    )? as usize;
    if total == 0 {
        return Ok(());
    }
    let offsets = if total <= 8 {
        (0..total).collect::<Vec<_>>()
    } else {
        (0..8)
            .map(|index| index * (total - 1) / 7)
            .collect::<Vec<_>>()
    };
    let mut evidence = Vec::with_capacity(offsets.len());
    let mut statement = connection.prepare(
        "SELECT l.relative_path_bytes,sr.byte_size,sr.quick_fingerprint FROM locations l
         JOIN sources s ON s.id=l.source_id JOIN source_revisions sr ON sr.id=s.current_revision_id
         WHERE l.root_id=?1 ORDER BY CASE l.state WHEN 'present' THEN 0 ELSE 1 END,l.id
         LIMIT 1 OFFSET ?2",
    )?;
    for offset in offsets {
        evidence.push(statement.query_row(params![root_id, offset as i64], |row| {
            Ok((
                row.get::<_, Vec<u8>>(0)?,
                row.get::<_, i64>(1)? as u64,
                row.get::<_, Option<String>>(2)?,
            ))
        })?);
    }
    let required = usize::min(2, total);
    let mut matched = 0_usize;
    for (relative, expected_size, expected_fingerprint) in evidence {
        let Ok(mut file) = authority.open_file(&relative) else {
            continue;
        };
        let metadata = file
            .metadata()
            .map_err(|_| CoreError::RootIdentityMismatch)?;
        if metadata.len() != expected_size {
            return Err(CoreError::RootIdentityMismatch);
        }
        if let Some(expected_fingerprint) = expected_fingerprint
            && full_fingerprint(&mut file, expected_size)? != expected_fingerprint
        {
            return Err(CoreError::RootIdentityMismatch);
        }
        matched += 1;
    }
    if matched < required {
        return Err(CoreError::RootIdentityMismatch);
    }
    Ok(())
}

pub(crate) fn full_fingerprint(file: &mut File, size: u64) -> Result<String, CoreError> {
    use sha2::{Digest, Sha256};
    use std::io::{Seek, SeekFrom};

    file.seek(SeekFrom::Start(0))?;
    let mut hasher = Sha256::new();
    hasher.update(size.to_be_bytes());
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256-full:{}", hex(&hasher.finalize())))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

fn relative_path_from_bytes(bytes: &[u8]) -> Result<PathBuf, CoreError> {
    #[cfg(unix)]
    {
        Ok(PathBuf::from(std::ffi::OsString::from_vec(bytes.to_vec())))
    }
    #[cfg(not(unix))]
    {
        String::from_utf8(bytes.to_vec())
            .map(PathBuf::from)
            .map_err(|_| CoreError::LocationMissing)
    }
}

fn validate_relative(path: &Path) -> Result<(), CoreError> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(CoreError::LocationMissing);
    }
    Ok(())
}

#[cfg(unix)]
fn open_canonical_directory(path: &Path) -> Result<File, CoreError> {
    let mut current = File::open("/").map_err(|_| CoreError::RootPermissionRequired)?;
    for component in path.components() {
        match component {
            Component::RootDir => continue,
            Component::Normal(name) => {
                current = openat(
                    &current,
                    name.as_bytes(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
                .map_err(|_| CoreError::RootPermissionRequired)?;
            }
            _ => return Err(CoreError::RootPermissionRequired),
        }
    }
    Ok(current)
}

#[cfg(unix)]
pub(crate) fn open_relative_file(root: &File, relative: &Path) -> std::io::Result<File> {
    let components = relative.components().collect::<Vec<_>>();
    let mut current = openat(
        root,
        b".",
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
    )?;
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(name) = component else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid relative component",
            ));
        };
        let last = index + 1 == components.len();
        let flags = if last {
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC
        } else {
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC
        };
        current = openat(&current, name.as_bytes(), flags)?;
    }
    if !current.metadata()?.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "not a regular file",
        ));
    }
    Ok(current)
}

#[cfg(unix)]
pub(crate) fn fresh_directory(directory: &File) -> std::io::Result<File> {
    openat(
        directory,
        b".",
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
    )
}

#[cfg(unix)]
pub(crate) fn openat(directory: &File, name: &[u8], flags: i32) -> std::io::Result<File> {
    let name = CString::new(name)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "NUL in name"))?;
    // SAFETY: `directory` owns a valid fd, `name` is NUL-terminated and the
    // returned fd is uniquely transferred into `File` on success.
    let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
    if fd < 0 {
        Err(std::io::Error::last_os_error())
    } else {
        // SAFETY: successful openat returns a new owned file descriptor.
        Ok(unsafe { File::from_raw_fd(fd) })
    }
}

#[cfg(unix)]
pub(crate) fn relative_path_bytes(path: &Path) -> Vec<u8> {
    path.as_os_str().as_bytes().to_vec()
}

#[cfg(not(unix))]
pub(crate) fn relative_path_bytes(path: &Path) -> Vec<u8> {
    path.to_string_lossy().as_bytes().to_vec()
}

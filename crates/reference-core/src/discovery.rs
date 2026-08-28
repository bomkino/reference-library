use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{BufReader, Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{Sender, SyncSender},
    },
    time::{Duration, Instant, UNIX_EPOCH},
};

#[cfg(unix)]
use std::{
    ffi::{CStr, OsString},
    os::{
        fd::IntoRawFd,
        unix::{
            ffi::{OsStrExt, OsStringExt},
            fs::MetadataExt,
        },
    },
};

use reference_protocol::Event;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use uuid::Uuid;

use crate::{
    error::CoreError,
    manifest::Manifest,
    now_ms,
    rendition::MAX_SOURCE_BYTES,
    schema,
    session::{
        bump_revision, fresh_directory, full_fingerprint_cancellable, open_relative_directory,
        open_relative_file, openat, relative_path_bytes, relative_path_from_bytes,
    },
};

const INSERT_BATCH: usize = 32;
const MAX_DIRECTORY_ENTRIES: usize = 100_000;
const MAX_QUEUED_DIRECTORIES: usize = 100_000;
const MAX_SCAN_ENTRIES: usize = 250_000;
const DIMENSION_READ_LIMIT: u64 = 4 * 1024 * 1024;
const DIMENSION_READ_TIMEOUT: Duration = Duration::from_secs(2);
const OVERSIZED_SAMPLE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct ScanPlan {
    pub package_path: PathBuf,
    pub root_path: PathBuf,
    pub library_id: String,
    pub root_id: String,
    pub job_id: String,
    #[cfg(unix)]
    pub root_directory: Arc<File>,
}

pub trait EventSink {
    fn emit(&self, event: Event);
}

impl EventSink for Sender<Event> {
    fn emit(&self, event: Event) {
        self.send(event).ok();
    }
}

impl EventSink for SyncSender<Event> {
    fn emit(&self, event: Event) {
        // The database is the durable source of job/Root truth. A full event
        // queue must never block a scanner that CloseLibrary is joining.
        let _ = self.try_send(event);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanOutcome {
    pub terminal_persisted: bool,
}

pub fn scan_root(
    plan: ScanPlan,
    cancelled: Arc<AtomicBool>,
    events: impl EventSink,
) -> ScanOutcome {
    let outcome = run_scan(&plan, &cancelled, &events);
    match outcome {
        Ok(()) => ScanOutcome {
            terminal_persisted: true,
        },
        Err(error) => match mark_failed(&plan, &error) {
            Ok(state) => {
                events.emit(Event::RootStateChanged {
                    root_id: plan.root_id.clone(),
                    state,
                });
                events.emit(Event::JobUpdated {
                    job_id: plan.job_id,
                    state: "failed".into(),
                });
                ScanOutcome {
                    terminal_persisted: true,
                }
            }
            Err(persistence_error) => {
                events.emit(Event::CoreNeedsRestart {
                    reason: persistence_error.to_protocol_error().code,
                });
                ScanOutcome {
                    terminal_persisted: false,
                }
            }
        },
    }
}

fn run_scan(
    plan: &ScanPlan,
    cancelled: &AtomicBool,
    events: &dyn EventSink,
) -> Result<(), CoreError> {
    let manifest = Manifest::read(&plan.package_path)?;
    let mut connection =
        schema::open_database(&plan.package_path.join("library.sqlite"), &manifest)?;
    connection.execute_batch(
        "CREATE TEMP TABLE scan_seen (
             relative_path_bytes BLOB PRIMARY KEY
         ) WITHOUT ROWID;",
    )?;
    let mut batch = Vec::with_capacity(INSERT_BATCH);
    let mut observed_count = 0_u64;
    let mut unsupported_count = 0_u64;
    let mut per_entry_states = BTreeMap::new();
    let mut unreadable_directories = BTreeSet::new();
    let mut traversed_entries = 0_usize;

    #[cfg(unix)]
    let mut stack = vec![PathBuf::new()];
    #[cfg(not(unix))]
    let mut stack = vec![plan.root_path.clone()];

    while let Some(directory) = stack.pop() {
        if cancelled.load(Ordering::Relaxed) {
            finish_cancelled(
                &mut connection,
                plan,
                &mut batch,
                &mut observed_count,
                &mut unsupported_count,
                events,
            )?;
            return Ok(());
        }
        #[cfg(unix)]
        let directory_handle = match open_relative_directory(&plan.root_directory, &directory) {
            Ok(handle) => handle,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                unreadable_directories.insert(directory);
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        #[cfg(unix)]
        let entries = match read_directory_names(&directory_handle, cancelled) {
            Ok(entries) => entries,
            Err(CoreError::Io(error)) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                unreadable_directories.insert(directory);
                continue;
            }
            Err(CoreError::RenditionCancelled) => {
                finish_cancelled(
                    &mut connection,
                    plan,
                    &mut batch,
                    &mut observed_count,
                    &mut unsupported_count,
                    events,
                )?;
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        #[cfg(not(unix))]
        let entries = {
            let mut names = Vec::new();
            for entry in fs::read_dir(&directory)? {
                if cancelled.load(Ordering::Relaxed) {
                    finish_cancelled(
                        &mut connection,
                        plan,
                        &mut batch,
                        &mut seen,
                        &mut observed_count,
                        &mut unsupported_count,
                        events,
                    )?;
                    return Ok(());
                }
                if names.len() >= MAX_DIRECTORY_ENTRIES {
                    return Err(CoreError::RootScanLimitExceeded);
                }
                names.push(entry?.file_name());
            }
            names.sort();
            names
        };
        traversed_entries = traversed_entries
            .checked_add(entries.len())
            .ok_or(CoreError::RootScanLimitExceeded)?;
        if traversed_entries > MAX_SCAN_ENTRIES {
            return Err(CoreError::RootScanLimitExceeded);
        }
        for name in entries.into_iter().rev() {
            if cancelled.load(Ordering::Relaxed) {
                finish_cancelled(
                    &mut connection,
                    plan,
                    &mut batch,
                    &mut observed_count,
                    &mut unsupported_count,
                    events,
                )?;
                return Ok(());
            }
            #[cfg(unix)]
            let candidate = {
                let name_bytes = name.as_bytes();
                let relative = directory.join(&name);
                match openat(
                    &directory_handle,
                    name_bytes,
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                ) {
                    Ok(child) => {
                        drop(child);
                        if stack.len() >= MAX_QUEUED_DIRECTORIES {
                            return Err(CoreError::RootScanLimitExceeded);
                        }
                        stack.push(relative);
                        continue;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) if error.raw_os_error() == Some(libc::ELOOP) => continue,
                    Err(error) if error.raw_os_error() == Some(libc::ENOTDIR) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                        unreadable_directories.insert(relative);
                        continue;
                    }
                    Err(error) => return Err(error.into()),
                }
                match openat(
                    &directory_handle,
                    name_bytes,
                    libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                ) {
                    Ok(file) if file.metadata()?.is_file() => {
                        match FileCandidate::inspect_file(relative.clone(), file, cancelled) {
                            Ok(candidate) => candidate,
                            Err(CoreError::RenditionCancelled) => {
                                finish_cancelled(
                                    &mut connection,
                                    plan,
                                    &mut batch,
                                    &mut observed_count,
                                    &mut unsupported_count,
                                    events,
                                )?;
                                return Ok(());
                            }
                            Err(CoreError::Io(error))
                                if error.kind() == std::io::ErrorKind::NotFound =>
                            {
                                None
                            }
                            Err(CoreError::Io(error))
                                if error.kind() == std::io::ErrorKind::PermissionDenied =>
                            {
                                per_entry_states
                                    .insert(relative_path_bytes(&relative), "permission_denied");
                                None
                            }
                            Err(CoreError::SourceRevisionChanged) => {
                                per_entry_states
                                    .insert(relative_path_bytes(&relative), "unreadable");
                                None
                            }
                            Err(error) => return Err(error),
                        }
                    }
                    Ok(_) => None,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                    Err(error) if error.raw_os_error() == Some(libc::ELOOP) => None,
                    Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                        per_entry_states
                            .insert(relative_path_bytes(&relative), "permission_denied");
                        None
                    }
                    Err(error) => return Err(error.into()),
                }
            };
            #[cfg(not(unix))]
            let candidate = {
                let path = directory.join(&name);
                let metadata = fs::symlink_metadata(&path)?;
                if metadata.file_type().is_symlink() {
                    continue;
                }
                if metadata.is_dir() {
                    if stack.len() >= MAX_QUEUED_DIRECTORIES {
                        return Err(CoreError::RootScanLimitExceeded);
                    }
                    stack.push(path);
                    continue;
                }
                if !metadata.is_file() {
                    continue;
                }
                FileCandidate::inspect_path(&plan.root_path, &path, cancelled)?
            };
            if let Some(candidate) = candidate {
                batch.push(candidate);
                if batch.len() >= INSERT_BATCH {
                    flush_batch(
                        &mut connection,
                        plan,
                        &mut batch,
                        &mut observed_count,
                        &mut unsupported_count,
                        events,
                    )?;
                }
            }
        }
    }
    flush_batch(
        &mut connection,
        plan,
        &mut batch,
        &mut observed_count,
        &mut unsupported_count,
        events,
    )?;
    mark_unseen(
        &mut connection,
        plan,
        &per_entry_states,
        &unreadable_directories,
    )?;
    mark_completed(&connection, plan, observed_count, unsupported_count)?;
    events.emit(Event::ScanProgressChanged {
        root_id: plan.root_id.clone(),
        job_id: plan.job_id.clone(),
        observed_count,
        unsupported_count,
        terminal: true,
    });
    events.emit(Event::RootStateChanged {
        root_id: plan.root_id.clone(),
        state: "ready".into(),
    });
    events.emit(Event::JobUpdated {
        job_id: plan.job_id.clone(),
        state: "completed".into(),
    });
    Ok(())
}

fn finish_cancelled(
    connection: &mut Connection,
    plan: &ScanPlan,
    batch: &mut Vec<FileCandidate>,
    observed_count: &mut u64,
    unsupported_count: &mut u64,
    events: &dyn EventSink,
) -> Result<(), CoreError> {
    flush_batch(
        connection,
        plan,
        batch,
        observed_count,
        unsupported_count,
        events,
    )?;
    mark_cancelled(connection, plan, *observed_count, *unsupported_count)?;
    events.emit(Event::ScanProgressChanged {
        root_id: plan.root_id.clone(),
        job_id: plan.job_id.clone(),
        observed_count: *observed_count,
        unsupported_count: *unsupported_count,
        terminal: true,
    });
    events.emit(Event::RootStateChanged {
        root_id: plan.root_id.clone(),
        state: "connected".into(),
    });
    events.emit(Event::JobUpdated {
        job_id: plan.job_id.clone(),
        state: "cancelled".into(),
    });
    Ok(())
}

fn flush_batch(
    connection: &mut Connection,
    plan: &ScanPlan,
    candidates: &mut Vec<FileCandidate>,
    observed_count: &mut u64,
    unsupported_count: &mut u64,
    events: &dyn EventSink,
) -> Result<(), CoreError> {
    if candidates.is_empty() {
        return Ok(());
    }
    let timestamp = now_ms() as i64;
    let transaction = connection.transaction()?;
    let mut inserted_asset_ids = Vec::new();
    for candidate in candidates.drain(..) {
        transaction.execute(
            "INSERT OR IGNORE INTO scan_seen (relative_path_bytes) VALUES (?1)",
            params![&candidate.relative_bytes],
        )?;
        if let Some(existing) = existing_location(&transaction, plan, &candidate)? {
            refresh_existing(&transaction, &existing, &candidate, timestamp)?;
        } else if let Some(existing) = relocated_location(&transaction, plan, &candidate)? {
            relocate_existing(&transaction, &existing, &candidate, timestamp)?;
            refresh_existing(&transaction, &existing, &candidate, timestamp)?;
        } else {
            inserted_asset_ids.push(insert_new(&transaction, plan, &candidate, timestamp)?);
        }
        *observed_count += 1;
        if candidate.preview_kind == "none" {
            *unsupported_count += 1;
        }
    }
    transaction.execute(
        "UPDATE jobs SET progress_json = ?1, updated_at_ms = ?2 WHERE id = ?3",
        params![
            serde_json::json!({
                "observedCount": observed_count,
                "unsupportedCount": unsupported_count
            })
            .to_string(),
            timestamp,
            plan.job_id
        ],
    )?;
    let revision = bump_revision(&transaction, timestamp)?;
    record_event(
        &transaction,
        revision,
        "assets_inserted",
        &serde_json::json!({"rootId": plan.root_id, "assetIds": inserted_asset_ids}),
        timestamp,
    )?;
    transaction.commit()?;
    if !inserted_asset_ids.is_empty() {
        events.emit(Event::AssetsInserted {
            root_id: plan.root_id.clone(),
            asset_ids: inserted_asset_ids,
            library_revision: revision,
        });
    }
    events.emit(Event::ScanProgressChanged {
        root_id: plan.root_id.clone(),
        job_id: plan.job_id.clone(),
        observed_count: *observed_count,
        unsupported_count: *unsupported_count,
        terminal: false,
    });
    Ok(())
}

#[derive(Debug)]
struct ExistingLocation {
    location_id: String,
    source_id: String,
    byte_size: Option<i64>,
    mtime_ms: Option<i64>,
    fingerprint: Option<String>,
}

fn existing_location(
    transaction: &Transaction<'_>,
    plan: &ScanPlan,
    candidate: &FileCandidate,
) -> Result<Option<ExistingLocation>, CoreError> {
    Ok(transaction
        .query_row(
            "SELECT l.id, l.source_id, l.last_stat_size, l.last_stat_mtime_ms,
                    sr.quick_fingerprint
             FROM locations l
             JOIN sources s ON s.id = l.source_id
             JOIN source_revisions sr ON sr.id = s.current_revision_id
             WHERE l.root_id = ?1 AND l.relative_path_bytes = ?2",
            params![plan.root_id, candidate.relative_bytes],
            |row| {
                Ok(ExistingLocation {
                    location_id: row.get(0)?,
                    source_id: row.get(1)?,
                    byte_size: row.get(2)?,
                    mtime_ms: row.get(3)?,
                    fingerprint: row.get(4)?,
                })
            },
        )
        .optional()?)
}

fn relocated_location(
    transaction: &Transaction<'_>,
    plan: &ScanPlan,
    candidate: &FileCandidate,
) -> Result<Option<ExistingLocation>, CoreError> {
    let (Some(platform_file_id), Some(platform_file_id_kind)) = (
        candidate.platform_file_id.as_ref(),
        candidate.platform_file_id_kind.as_ref(),
    ) else {
        return Ok(None);
    };
    if candidate.platform_link_count != Some(1) {
        return Ok(None);
    }
    let matches = {
        let mut statement = transaction.prepare(
            "SELECT l.id, l.source_id, l.last_stat_size, l.last_stat_mtime_ms,
                    l.relative_path_bytes, sr.byte_size, sr.quick_fingerprint
             FROM locations l
             JOIN sources s ON s.id = l.source_id
             JOIN source_revisions sr ON sr.id = s.current_revision_id
             WHERE l.root_id = ?1
               AND l.platform_file_id = ?2
               AND l.platform_file_id_kind = ?3
               AND l.relative_path_bytes <> ?4",
        )?;
        statement
            .query_map(
                params![
                    plan.root_id,
                    platform_file_id,
                    platform_file_id_kind,
                    candidate.relative_bytes
                ],
                |row| {
                    Ok((
                        ExistingLocation {
                            location_id: row.get(0)?,
                            source_id: row.get(1)?,
                            byte_size: row.get(2)?,
                            mtime_ms: row.get(3)?,
                            fingerprint: row.get(6)?,
                        },
                        row.get::<_, Vec<u8>>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, Option<String>>(6)?,
                    ))
                },
            )?
            .collect::<Result<Vec<_>, _>>()?
    };
    let [(existing, old_relative_bytes, revision_size, revision_fingerprint)] = matches.as_slice()
    else {
        return Ok(None);
    };
    if *revision_size != candidate.byte_size as i64
        || revision_fingerprint.as_deref() != Some(candidate.quick_fingerprint.as_str())
        || !stored_path_is_absent(plan, old_relative_bytes)
    {
        return Ok(None);
    }
    Ok(Some(ExistingLocation {
        location_id: existing.location_id.clone(),
        source_id: existing.source_id.clone(),
        byte_size: existing.byte_size,
        mtime_ms: existing.mtime_ms,
        fingerprint: existing.fingerprint.clone(),
    }))
}

fn relocate_existing(
    transaction: &Transaction<'_>,
    existing: &ExistingLocation,
    candidate: &FileCandidate,
    timestamp: i64,
) -> Result<(), CoreError> {
    transaction.execute(
        "UPDATE locations
         SET relative_path_bytes = ?1, relative_path_display = ?2,
             state = 'moved_candidate', updated_at_ms = ?3
         WHERE id = ?4",
        params![
            candidate.relative_bytes,
            candidate.relative_display,
            timestamp,
            existing.location_id
        ],
    )?;
    Ok(())
}

fn refresh_existing(
    transaction: &Transaction<'_>,
    existing: &ExistingLocation,
    candidate: &FileCandidate,
    timestamp: i64,
) -> Result<(), CoreError> {
    let location_state = if candidate.preview_kind == "none" {
        "unreadable"
    } else {
        "present"
    };
    transaction.execute(
        "UPDATE locations SET state = ?1, relative_path_display = ?2,
             last_stat_size = ?3, last_stat_mtime_ms = ?4,
             platform_file_id = ?5, platform_file_id_kind = ?6, updated_at_ms = ?7
         WHERE id = ?8",
        params![
            location_state,
            candidate.relative_display,
            candidate.byte_size as i64,
            candidate.mtime_ms,
            candidate.platform_file_id,
            candidate.platform_file_id_kind,
            timestamp,
            existing.location_id
        ],
    )?;
    if existing.fingerprint.as_deref() != Some(candidate.quick_fingerprint.as_str()) {
        let revision_id = Uuid::new_v4().to_string();
        insert_revision(
            transaction,
            &revision_id,
            &existing.source_id,
            candidate,
            timestamp,
        )?;
        transaction.execute(
            "UPDATE sources SET current_revision_id = ?1, media_family = ?2,
                                lineage_state = 'active', updated_at_ms = ?3 WHERE id = ?4",
            params![revision_id, candidate.media_family, timestamp, existing.source_id],
        )?;
    } else {
        transaction.execute(
            "UPDATE sources SET media_family = ?1, lineage_state = 'active', updated_at_ms = ?2 WHERE id = ?3",
            params![candidate.media_family, timestamp, existing.source_id],
        )?;
        transaction.execute(
            "UPDATE source_revisions
             SET mime_detected = ?1, extension_observed = ?2, media_metadata_json = ?3
             WHERE id = (SELECT current_revision_id FROM sources WHERE id = ?4)",
            params![
                candidate.mime_type,
                candidate.extension,
                serde_json::json!({
                    "pixelWidth": candidate.pixel_width,
                    "pixelHeight": candidate.pixel_height,
                    "previewKind": candidate.preview_kind,
                    "gridPreview": candidate.grid_servable
                }).to_string(),
                existing.source_id
            ],
        )?;
    }
    Ok(())
}

fn insert_new(
    transaction: &Transaction<'_>,
    plan: &ScanPlan,
    candidate: &FileCandidate,
    timestamp: i64,
) -> Result<String, CoreError> {
    let source_id = Uuid::new_v4().to_string();
    let revision_id = Uuid::new_v4().to_string();
    let location_id = Uuid::new_v4().to_string();
    let asset_id = Uuid::new_v4().to_string();
    let origin_id = Uuid::new_v4().to_string();
    transaction.execute(
        "INSERT INTO sources (
            id, library_id, media_family, current_revision_id, lineage_state,
            created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)",
        params![source_id, plan.library_id, candidate.media_family, revision_id, timestamp],
    )?;
    insert_revision(transaction, &revision_id, &source_id, candidate, timestamp)?;
    let location_state = if candidate.preview_kind == "none" {
        "unreadable"
    } else {
        "present"
    };
    transaction.execute(
        "INSERT INTO locations (
            id, root_id, source_id, relative_path_bytes, relative_path_display,
            platform_file_id, platform_file_id_kind, state, last_stat_size,
            last_stat_mtime_ms, created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![
            location_id,
            plan.root_id,
            source_id,
            candidate.relative_bytes,
            candidate.relative_display,
            candidate.platform_file_id,
            candidate.platform_file_id_kind,
            location_state,
            candidate.byte_size as i64,
            candidate.mtime_ms,
            timestamp
        ],
    )?;
    transaction.execute(
        "INSERT INTO assets (
            id, library_id, custom_title, review_state, created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, NULL, 'unreviewed', ?3, ?3)",
        params![asset_id, plan.library_id, timestamp],
    )?;
    transaction.execute(
        "INSERT INTO asset_origins (
            id, asset_id, source_id, origin_kind, origin_spec_json,
            revision_binding, created_at_ms
         ) VALUES (?1, ?2, ?3, 'whole', '{\"kind\":\"whole\"}', 'latest', ?4)",
        params![origin_id, asset_id, source_id, timestamp],
    )?;
    Ok(asset_id)
}

fn insert_revision(
    transaction: &Transaction<'_>,
    revision_id: &str,
    source_id: &str,
    candidate: &FileCandidate,
    timestamp: i64,
) -> Result<(), CoreError> {
    transaction.execute(
        "INSERT INTO source_revisions (
            id, source_id, byte_size, mtime_observed_ms, quick_fingerprint,
            mime_detected, extension_observed, media_metadata_json, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            revision_id,
            source_id,
            candidate.byte_size as i64,
            candidate.mtime_ms,
            candidate.quick_fingerprint,
            candidate.mime_type,
            candidate.extension,
            serde_json::json!({
                "pixelWidth": candidate.pixel_width,
                "pixelHeight": candidate.pixel_height,
                "previewKind": candidate.preview_kind,
                "gridPreview": candidate.grid_servable
            })
            .to_string(),
            timestamp,
        ],
    )?;
    Ok(())
}

fn mark_unseen(
    connection: &mut Connection,
    plan: &ScanPlan,
    per_entry_states: &BTreeMap<Vec<u8>, &'static str>,
    unreadable_directories: &BTreeSet<PathBuf>,
) -> Result<(), CoreError> {
    let timestamp = now_ms() as i64;
    let transaction = connection.transaction()?;
    let mut after_id = String::new();
    loop {
        let unresolved = {
            let mut statement = transaction.prepare(
                "SELECT l.id, l.source_id, l.relative_path_bytes
                 FROM locations l
                 WHERE l.root_id = ?1 AND l.id > ?2
                   AND NOT EXISTS (
                     SELECT 1 FROM scan_seen s
                     WHERE s.relative_path_bytes = l.relative_path_bytes
                   )
                 ORDER BY l.id LIMIT 256",
            )?;
            statement
                .query_map(params![plan.root_id, after_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        if unresolved.is_empty() {
            break;
        }
        for (location_id, source_id, relative_bytes) in unresolved {
            after_id.clone_from(&location_id);
            let path = relative_path_from_bytes(&relative_bytes)?;
            let location_state = per_entry_states
                .get(&relative_bytes)
                .copied()
                .or_else(|| {
                    path.ancestors()
                        .any(|directory| unreadable_directories.contains(directory))
                        .then_some("permission_denied")
                })
                .unwrap_or("missing");
            transaction.execute(
                "UPDATE locations SET state = ?1, updated_at_ms = ?2 WHERE id = ?3",
                params![location_state, timestamp, location_id],
            )?;
            transaction.execute(
                "UPDATE sources
                 SET lineage_state = CASE WHEN EXISTS (
                         SELECT 1 FROM locations
                         WHERE source_id = ?2 AND state <> 'missing'
                     ) THEN 'active' ELSE 'missing' END,
                     updated_at_ms = ?1
                 WHERE id = ?2",
                params![timestamp, source_id],
            )?;
        }
    }
    bump_revision(&transaction, timestamp)?;
    transaction.commit()?;
    Ok(())
}

fn mark_completed(
    connection: &Connection,
    plan: &ScanPlan,
    count: u64,
    unsupported_count: u64,
) -> Result<(), CoreError> {
    let timestamp = now_ms() as i64;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "UPDATE roots SET state = 'ready', updated_at_ms = ?1, last_seen_at_ms = ?1
         WHERE id = ?2",
        params![timestamp, plan.root_id],
    )?;
    transaction.execute(
        "UPDATE jobs SET state = 'completed', progress_json = ?1,
                         updated_at_ms = ?2, finished_at_ms = ?2 WHERE id = ?3",
        params![
            serde_json::json!({
                "observedCount": count,
                "unsupportedCount": unsupported_count
            })
            .to_string(),
            timestamp,
            plan.job_id
        ],
    )?;
    bump_revision(&transaction, timestamp)?;
    transaction.commit()?;
    Ok(())
}

fn mark_cancelled(
    connection: &Connection,
    plan: &ScanPlan,
    count: u64,
    unsupported_count: u64,
) -> Result<(), CoreError> {
    let timestamp = now_ms() as i64;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "UPDATE roots SET state = 'connected', updated_at_ms = ?1 WHERE id = ?2",
        params![timestamp, plan.root_id],
    )?;
    transaction.execute(
        "UPDATE jobs SET state = 'cancelled', progress_json = ?1,
                         updated_at_ms = ?2, finished_at_ms = ?2 WHERE id = ?3",
        params![
            serde_json::json!({
                "observedCount": count,
                "unsupportedCount": unsupported_count
            })
            .to_string(),
            timestamp,
            plan.job_id
        ],
    )?;
    bump_revision(&transaction, timestamp)?;
    transaction.commit()?;
    Ok(())
}

fn mark_failed(plan: &ScanPlan, error: &CoreError) -> Result<String, CoreError> {
    let manifest = Manifest::read(&plan.package_path)?;
    let connection = schema::open_database(&plan.package_path.join("library.sqlite"), &manifest)?;
    let timestamp = now_ms() as i64;
    let (root_state, location_state) = match error {
        CoreError::Io(error) if error.kind() == std::io::ErrorKind::NotFound => {
            ("offline_volume", Some("offline_root"))
        }
        CoreError::Io(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            ("needs_permission", Some("permission_denied"))
        }
        CoreError::Io(_) => ("unavailable", Some("unreadable")),
        _ => ("error", None),
    };
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "UPDATE roots SET state = ?1, updated_at_ms = ?2 WHERE id = ?3",
        params![root_state, timestamp, plan.root_id],
    )?;
    if let Some(location_state) = location_state {
        transaction.execute(
            "UPDATE locations SET state = ?1, updated_at_ms = ?2 WHERE root_id = ?3",
            params![location_state, timestamp, plan.root_id],
        )?;
    }
    transaction.execute(
        "UPDATE jobs SET state = 'failed', error_code = ?1,
                         updated_at_ms = ?2, finished_at_ms = ?2 WHERE id = ?3",
        params![error.to_protocol_error().code, timestamp, plan.job_id],
    )?;
    bump_revision(&transaction, timestamp)?;
    transaction.commit()?;
    Ok(root_state.into())
}

fn record_event(
    transaction: &Transaction<'_>,
    revision: u64,
    kind: &str,
    payload: &serde_json::Value,
    timestamp: i64,
) -> Result<(), CoreError> {
    transaction.execute(
        "INSERT INTO app_events (library_revision, event_kind, payload_json, created_at_ms)
         VALUES (?1, ?2, ?3, ?4)",
        params![revision as i64, kind, payload.to_string(), timestamp],
    )?;
    Ok(())
}

#[derive(Debug)]
struct FileCandidate {
    relative_bytes: Vec<u8>,
    relative_display: String,
    byte_size: u64,
    mtime_ms: Option<i64>,
    quick_fingerprint: String,
    platform_file_id: Option<Vec<u8>>,
    platform_file_id_kind: Option<String>,
    platform_link_count: Option<u64>,
    mime_type: String,
    media_family: String,
    preview_kind: String,
    extension: Option<String>,
    pixel_width: usize,
    pixel_height: usize,
    grid_servable: bool,
}

impl FileCandidate {
    #[cfg(unix)]
    fn inspect_file(
        relative: PathBuf,
        mut file: File,
        cancelled: &AtomicBool,
    ) -> Result<Option<Self>, CoreError> {
        let extension = relative
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        let before = file.metadata()?;
        let mut prefix = [0_u8; 512];
        let prefix_len = file.read(&mut prefix)?;
        file.seek(SeekFrom::Start(0))?;
        let Some(kind) = classify_media(&prefix[..prefix_len], extension.as_deref()) else {
            return Ok(None);
        };
        let eligible_size = before.len() <= MAX_SOURCE_BYTES;
        let dimensions = if kind.dimension_probe && eligible_size {
            read_dimensions(file.try_clone()?, cancelled)
        } else {
            None
        };
        let grid_servable = kind.grid_candidate
            && dimensions.is_some_and(|value| valid_dimensions(value.width, value.height));
        let (pixel_width, pixel_height) = dimensions
            .filter(|value| valid_dimensions(value.width, value.height))
            .map(|value| (value.width, value.height))
            .unwrap_or_default();
        let fingerprint = if eligible_size {
            full_fingerprint_cancellable(&mut file, before.len(), Some(cancelled), None)?
        } else {
            oversized_fingerprint(&mut file, before.len(), cancelled)?
        };
        let after = file.metadata()?;
        if !same_file_observation(&before, &after) {
            return Err(CoreError::SourceRevisionChanged);
        }
        let mtime_ms = modified_ms(&after);
        let (platform_file_id, platform_file_id_kind, platform_link_count) =
            platform_identity(&after);
        Ok(Some(Self {
            relative_bytes: relative_path_bytes(&relative),
            relative_display: bounded_relative_display(&relative),
            byte_size: after.len(),
            mtime_ms,
            quick_fingerprint: fingerprint,
            platform_file_id,
            platform_file_id_kind,
            platform_link_count,
            mime_type: kind.mime_type.into(),
            media_family: kind.media_family.into(),
            preview_kind: kind.preview_kind.into(),
            extension,
            pixel_width,
            pixel_height,
            grid_servable,
        }))
    }

    #[cfg(not(unix))]
    fn inspect_path(
        root: &Path,
        path: &Path,
        cancelled: &AtomicBool,
    ) -> Result<Option<Self>, CoreError> {
        let relative = path
            .strip_prefix(root)
            .map_err(|_| CoreError::LocationMissing)?;
        let mut file = File::open(path)?;
        let before = file.metadata()?;
        let mut prefix = [0_u8; 512];
        let prefix_len = file.read(&mut prefix)?;
        file.seek(SeekFrom::Start(0))?;
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        let Some(kind) = classify_media(&prefix[..prefix_len], extension.as_deref()) else {
            return Ok(None);
        };
        let eligible_size = before.len() <= MAX_SOURCE_BYTES;
        let dimensions = (kind.dimension_probe && eligible_size)
            .then(|| read_dimensions(file.try_clone().ok()?, cancelled))
            .flatten();
        let grid_servable = kind.grid_candidate
            && dimensions.is_some_and(|value| valid_dimensions(value.width, value.height));
        let (pixel_width, pixel_height) = dimensions
            .filter(|value| valid_dimensions(value.width, value.height))
            .map(|value| (value.width, value.height))
            .unwrap_or_default();
        let fingerprint = if eligible_size {
            full_fingerprint_cancellable(&mut file, before.len(), Some(cancelled), None)?
        } else {
            oversized_fingerprint(&mut file, before.len(), cancelled)?
        };
        let metadata = file.metadata()?;
        if before.len() != metadata.len() || modified_ms(&before) != modified_ms(&metadata) {
            return Err(CoreError::SourceRevisionChanged);
        }
        let mtime_ms = modified_ms(&metadata);
        let (platform_file_id, platform_file_id_kind, platform_link_count) =
            platform_identity(&metadata);
        Ok(Some(Self {
            relative_bytes: relative_path_bytes(relative),
            relative_display: bounded_relative_display(relative),
            byte_size: metadata.len(),
            mtime_ms,
            quick_fingerprint: fingerprint,
            platform_file_id,
            platform_file_id_kind,
            platform_link_count,
            mime_type: kind.mime_type.into(),
            media_family: kind.media_family.into(),
            preview_kind: kind.preview_kind.into(),
            extension,
            pixel_width,
            pixel_height,
            grid_servable,
        }))
    }
}

fn oversized_fingerprint(
    file: &mut File,
    size: u64,
    cancelled: &AtomicBool,
) -> Result<String, CoreError> {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(b"catalogue-only-oversized-v2\0");
    hasher.update(size.to_be_bytes());
    let sample = OVERSIZED_SAMPLE_BYTES as u64;
    let mut offsets = [
        0,
        size.saturating_sub(sample) / 2,
        size.saturating_sub(sample),
    ];
    offsets.sort_unstable();
    let mut previous = None;
    let mut buffer = vec![0_u8; OVERSIZED_SAMPLE_BYTES];
    for offset in offsets {
        if previous == Some(offset) {
            continue;
        }
        previous = Some(offset);
        if cancelled.load(Ordering::Relaxed) {
            return Err(CoreError::RenditionCancelled);
        }
        file.seek(SeekFrom::Start(offset))?;
        let expected = usize::try_from((size - offset).min(sample)).unwrap_or(0);
        let mut read = 0;
        while read < expected {
            if cancelled.load(Ordering::Relaxed) {
                return Err(CoreError::RenditionCancelled);
            }
            let count = file.read(&mut buffer[read..expected])?;
            if count == 0 {
                return Err(CoreError::SourceRevisionChanged);
            }
            read += count;
        }
        hasher.update(offset.to_be_bytes());
        hasher.update(&buffer[..read]);
    }
    Ok(format!("oversized-v2:{:x}", hasher.finalize()))
}

fn read_dimensions(file: File, cancelled: &AtomicBool) -> Option<imagesize::ImageSize> {
    let reader = InspectionReader {
        file,
        cancelled,
        remaining: DIMENSION_READ_LIMIT,
        deadline: Instant::now() + DIMENSION_READ_TIMEOUT,
    };
    imagesize::reader_size(BufReader::new(reader)).ok()
}

struct InspectionReader<'a> {
    file: File,
    cancelled: &'a AtomicBool,
    remaining: u64,
    deadline: Instant,
}

impl InspectionReader<'_> {
    fn check(&self) -> std::io::Result<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "image inspection cancelled",
            ));
        }
        if Instant::now() >= self.deadline || self.remaining == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "image inspection budget exceeded",
            ));
        }
        Ok(())
    }
}

impl Read for InspectionReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        self.check()?;
        let allowed = buffer.len().min(self.remaining as usize);
        let count = self.file.read(&mut buffer[..allowed])?;
        self.remaining = self.remaining.saturating_sub(count as u64);
        Ok(count)
    }
}

impl Seek for InspectionReader<'_> {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        self.check()?;
        self.file.seek(position)
    }
}

#[cfg(unix)]
fn read_directory_names(
    directory: &File,
    cancelled: &AtomicBool,
) -> Result<Vec<OsString>, CoreError> {
    let fresh = fresh_directory(directory)?;
    let raw_fd = fresh.into_raw_fd();
    // SAFETY: raw_fd is a newly owned directory fd transferred to DIR.
    let stream = unsafe { libc::fdopendir(raw_fd) };
    if stream.is_null() {
        // SAFETY: fdopendir failed and did not take ownership.
        unsafe { libc::close(raw_fd) };
        return Err(std::io::Error::last_os_error().into());
    }
    let mut names = Vec::new();
    loop {
        if cancelled.load(Ordering::Relaxed) {
            // SAFETY: stream is owned by this function and closed once here.
            unsafe { libc::closedir(stream) };
            return Err(CoreError::RenditionCancelled);
        }
        clear_errno();
        // SAFETY: stream remains valid until closed below; readdir's pointer is
        // copied before the next call.
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            let errno = current_errno();
            if errno != 0 {
                // SAFETY: stream is owned by this function and closed once on
                // this error path.
                unsafe { libc::closedir(stream) };
                return Err(std::io::Error::from_raw_os_error(errno).into());
            }
            break;
        }
        // SAFETY: d_name is a NUL-terminated array supplied by readdir.
        let bytes = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if bytes == b"." || bytes == b".." {
            continue;
        }
        if names.len() >= MAX_DIRECTORY_ENTRIES {
            // SAFETY: stream is owned by this function and closed once here.
            unsafe { libc::closedir(stream) };
            return Err(CoreError::RootScanLimitExceeded);
        }
        names.push(OsString::from_vec(bytes.to_vec()));
    }
    // SAFETY: stream is owned by this function and closed exactly once.
    if unsafe { libc::closedir(stream) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    names.sort();
    Ok(names)
}

#[cfg(unix)]
fn clear_errno() {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    // SAFETY: the platform function returns this thread's errno pointer.
    unsafe {
        *libc::__errno_location() = 0;
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    // SAFETY: the platform function returns this thread's errno pointer.
    unsafe {
        *libc::__error() = 0;
    }
}

#[cfg(unix)]
fn current_errno() -> i32 {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    // SAFETY: the platform function returns this thread's errno pointer.
    unsafe {
        return *libc::__errno_location();
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    // SAFETY: the platform function returns this thread's errno pointer.
    unsafe {
        return *libc::__error();
    }
    #[allow(unreachable_code)]
    0
}

fn stored_path_is_absent(plan: &ScanPlan, relative_bytes: &[u8]) -> bool {
    #[cfg(unix)]
    let relative = PathBuf::from(OsString::from_vec(relative_bytes.to_vec()));
    #[cfg(not(unix))]
    let relative = PathBuf::from(String::from_utf8_lossy(relative_bytes).into_owned());
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return false;
    }
    #[cfg(unix)]
    {
        matches!(
            open_relative_file(&plan.root_directory, &relative),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound
        )
    }
    #[cfg(not(unix))]
    {
        matches!(
            fs::symlink_metadata(plan.root_path.join(relative)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound
        )
    }
}

#[cfg(unix)]
fn platform_identity(metadata: &fs::Metadata) -> (Option<Vec<u8>>, Option<String>, Option<u64>) {
    let mut identity = Vec::with_capacity(16);
    identity.extend_from_slice(&metadata.dev().to_be_bytes());
    identity.extend_from_slice(&metadata.ino().to_be_bytes());
    (
        Some(identity),
        Some("unix-device-inode-v1".into()),
        Some(metadata.nlink()),
    )
}

#[cfg(not(unix))]
fn platform_identity(_metadata: &fs::Metadata) -> (Option<Vec<u8>>, Option<String>, Option<u64>) {
    (None, None, None)
}

#[derive(Clone, Copy)]
struct MediaClassification {
    mime_type: &'static str,
    media_family: &'static str,
    preview_kind: &'static str,
    dimension_probe: bool,
    grid_candidate: bool,
}

const fn media(
    mime_type: &'static str,
    media_family: &'static str,
    preview_kind: &'static str,
    dimension_probe: bool,
    grid_candidate: bool,
) -> MediaClassification {
    MediaClassification {
        mime_type,
        media_family,
        preview_kind,
        dimension_probe,
        grid_candidate,
    }
}

fn classify_media(bytes: &[u8], extension: Option<&str>) -> Option<MediaClassification> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some(media("image/png", "still", "image", true, true));
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(media("image/jpeg", "still", "image", true, true));
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(media("image/webp", "still", "image", true, true));
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(media("image/gif", "animation", "image", false, false));
    }
    if bytes.starts_with(b"%PDF-") {
        return Some(media("application/pdf", "document", "pdf", false, false));
    }
    if bytes.starts_with(b"PK\x03\x04") {
        return Some(match extension {
            Some("pptx") => media("application/vnd.openxmlformats-officedocument.presentationml.presentation", "presentation", "none", false, false),
            Some("docx") => media("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document", "none", false, false),
            Some("zip") | None => media("application/zip", "archive", "none", false, false),
            _ => media("application/zip", "archive", "none", false, false),
        });
    }
    if bytes.starts_with(b"OTTO") {
        return Some(media("font/otf", "font", "font", false, false));
    }
    if bytes.starts_with(&[0x00, 0x01, 0x00, 0x00]) {
        return Some(media("font/ttf", "font", "font", false, false));
    }
    if bytes.starts_with(b"wOFF") {
        return Some(media("font/woff", "font", "font", false, false));
    }
    if bytes.starts_with(b"wOF2") {
        return Some(media("font/woff2", "font", "font", false, false));
    }
    if bytes.starts_with(b"8BPS") {
        return Some(media("image/vnd.adobe.photoshop", "design", "none", false, false));
    }
    if bytes.starts_with(b"BM") {
        return Some(media("image/bmp", "still", "image", false, false));
    }
    if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        return Some(media("image/tiff", "still", "none", false, false));
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        if matches!(brand, b"avif" | b"avis") {
            return Some(media("image/avif", "still", "image", false, false));
        }
        if matches!(brand, b"heic" | b"heix" | b"hevc" | b"hevx" | b"mif1" | b"msf1") {
            return Some(media("image/heic", "still", "none", false, false));
        }
        if matches!(brand, b"M4A " | b"M4B ") {
            return Some(media("audio/mp4", "audio", "audio", false, false));
        }
        if matches!(brand, b"qt  ") {
            return Some(media("video/quicktime", "video", "video", false, false));
        }
        return Some(media("video/mp4", "video", "video", false, false));
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some(media("audio/wav", "audio", "audio", false, false));
    }
    if bytes.starts_with(b"OggS") {
        return Some(media("audio/ogg", "audio", "audio", false, false));
    }
    if bytes.starts_with(b"fLaC") {
        return Some(media("audio/flac", "audio", "audio", false, false));
    }
    if bytes.starts_with(b"ID3") || bytes.starts_with(&[0xff, 0xfb]) {
        return Some(media("audio/mpeg", "audio", "audio", false, false));
    }
    if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Some(match extension {
            Some("webm") => media("video/webm", "video", "video", false, false),
            _ => media("video/x-matroska", "video", "none", false, false),
        });
    }
    if bytes
        .iter()
        .take(512)
        .copied()
        .collect::<Vec<_>>()
        .windows(4)
        .any(|window| window.eq_ignore_ascii_case(b"<svg"))
    {
        return Some(media("image/svg+xml", "vector", "image", false, false));
    }

    Some(match extension? {
        "png" => media("image/png", "still", "image", true, true),
        "jpg" | "jpeg" => media("image/jpeg", "still", "image", true, true),
        "webp" => media("image/webp", "still", "image", true, true),
        "gif" => media("image/gif", "animation", "image", false, false),
        "svg" => media("image/svg+xml", "vector", "image", false, false),
        "bmp" => media("image/bmp", "still", "image", false, false),
        "tif" | "tiff" => media("image/tiff", "still", "none", false, false),
        "avif" => media("image/avif", "still", "image", false, false),
        "heic" | "heif" => media("image/heic", "still", "none", false, false),
        "ico" => media("image/x-icon", "still", "image", false, false),
        "psd" | "psb" => media("image/vnd.adobe.photoshop", "design", "none", false, false),
        "ai" => media("application/vnd.adobe.illustrator", "design", "none", false, false),
        "eps" => media("application/postscript", "design", "none", false, false),
        "indd" | "indl" | "indt" => media("application/x-indesign", "design", "none", false, false),
        "sketch" => media("application/x-sketch", "design", "none", false, false),
        "fig" => media("application/x-figma", "design", "none", false, false),
        "xd" => media("application/x-adobe-xd", "design", "none", false, false),
        "afdesign" | "afphoto" | "afpub" => media("application/x-affinity", "design", "none", false, false),
        "pdf" => media("application/pdf", "document", "pdf", false, false),
        "txt" | "md" => media("text/plain", "document", "text", false, false),
        "rtf" => media("application/rtf", "document", "none", false, false),
        "doc" => media("application/msword", "document", "none", false, false),
        "docx" => media("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document", "none", false, false),
        "ppt" => media("application/vnd.ms-powerpoint", "presentation", "none", false, false),
        "pptx" => media("application/vnd.openxmlformats-officedocument.presentationml.presentation", "presentation", "none", false, false),
        "key" => media("application/x-iwork-keynote-sffkey", "presentation", "none", false, false),
        "mp4" | "m4v" => media("video/mp4", "video", "video", false, false),
        "mov" => media("video/quicktime", "video", "video", false, false),
        "webm" => media("video/webm", "video", "video", false, false),
        "mkv" => media("video/x-matroska", "video", "none", false, false),
        "avi" => media("video/x-msvideo", "video", "none", false, false),
        "mxf" => media("application/mxf", "video", "none", false, false),
        "mp3" => media("audio/mpeg", "audio", "audio", false, false),
        "wav" => media("audio/wav", "audio", "audio", false, false),
        "aif" | "aiff" => media("audio/aiff", "audio", "audio", false, false),
        "m4a" => media("audio/mp4", "audio", "audio", false, false),
        "ogg" => media("audio/ogg", "audio", "audio", false, false),
        "flac" => media("audio/flac", "audio", "audio", false, false),
        "otf" => media("font/otf", "font", "font", false, false),
        "ttf" | "ttc" => media("font/ttf", "font", "font", false, false),
        "woff" => media("font/woff", "font", "font", false, false),
        "woff2" => media("font/woff2", "font", "font", false, false),
        "zip" => media("application/zip", "archive", "none", false, false),
        "rar" => media("application/vnd.rar", "archive", "none", false, false),
        "7z" => media("application/x-7z-compressed", "archive", "none", false, false),
        "tar" => media("application/x-tar", "archive", "none", false, false),
        "gz" | "tgz" => media("application/gzip", "archive", "none", false, false),
        "xz" => media("application/x-xz", "archive", "none", false, false),
        _ => return None,
    })
}

fn valid_dimensions(width: usize, height: usize) -> bool {
    width > 0
        && height > 0
        && width <= 100_000
        && height <= 100_000
        && width.saturating_mul(height) <= 500_000_000
}

fn modified_ms(metadata: &fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
}

#[cfg(unix)]
fn same_file_observation(before: &fs::Metadata, after: &fs::Metadata) -> bool {
    before.dev() == after.dev()
        && before.ino() == after.ino()
        && before.len() == after.len()
        && modified_ms(before) == modified_ms(after)
}

fn bounded_relative_display(path: &Path) -> String {
    const MAX_CHARS: usize = 1_024;
    let value = path.to_string_lossy();
    let count = value.chars().count();
    if count <= MAX_CHARS {
        return value.into_owned();
    }
    let tail = value
        .chars()
        .skip(count - (MAX_CHARS - 1))
        .collect::<String>();
    format!("…{tail}")
}

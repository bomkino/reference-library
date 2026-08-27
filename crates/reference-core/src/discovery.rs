use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{BufReader, Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{Sender, SyncSender},
    },
    time::UNIX_EPOCH,
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
    now_ms, schema,
    session::{
        bump_revision, fresh_directory, full_fingerprint_cancellable, open_relative_file, openat,
        relative_path_bytes,
    },
};

#[cfg(not(unix))]
use crate::session::full_fingerprint;

const INSERT_BATCH: usize = 32;

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

pub fn scan_root(plan: ScanPlan, cancelled: Arc<AtomicBool>, events: impl EventSink) {
    let outcome = run_scan(&plan, &cancelled, &events);
    if let Err(error) = outcome {
        match mark_failed(&plan, &error) {
            Ok(state) => {
                events.emit(Event::RootStateChanged {
                    root_id: plan.root_id.clone(),
                    state,
                });
                events.emit(Event::JobUpdated {
                    job_id: plan.job_id,
                    state: "failed".into(),
                });
            }
            Err(persistence_error) => events.emit(Event::CoreNeedsRestart {
                reason: persistence_error.to_protocol_error().code,
            }),
        }
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
    let mut batch = Vec::with_capacity(INSERT_BATCH);
    let mut seen = BTreeSet::new();
    let mut observed_count = 0_u64;
    let mut unsupported_count = 0_u64;

    #[cfg(unix)]
    let mut stack = vec![(PathBuf::new(), fresh_directory(&plan.root_directory)?)];
    #[cfg(not(unix))]
    let mut stack = vec![plan.root_path.clone()];

    while let Some(directory) = stack.pop() {
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
        #[cfg(unix)]
        let entries = read_directory_names(&directory.1)?;
        #[cfg(not(unix))]
        let entries = {
            let mut entries = fs::read_dir(&directory)?.collect::<Result<Vec<_>, _>>()?;
            entries.sort_by_key(|entry| entry.file_name());
            entries
                .into_iter()
                .map(|entry| entry.file_name())
                .collect::<Vec<_>>()
        };
        for name in entries.into_iter().rev() {
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
            #[cfg(unix)]
            let candidate = {
                let name_bytes = name.as_bytes();
                match openat(
                    &directory.1,
                    name_bytes,
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                ) {
                    Ok(child) => {
                        stack.push((directory.0.join(&name), child));
                        continue;
                    }
                    Err(error) if error.raw_os_error() == Some(libc::ELOOP) => continue,
                    Err(error) if error.raw_os_error() == Some(libc::ENOTDIR) => {}
                    Err(error) => return Err(error.into()),
                }
                match openat(
                    &directory.1,
                    name_bytes,
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                ) {
                    Ok(file) if file.metadata()?.is_file() => {
                        match FileCandidate::inspect_file(directory.0.join(&name), file, cancelled)
                        {
                            Ok(candidate) => candidate,
                            Err(CoreError::RenditionCancelled) => {
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
                            Err(error) => return Err(error),
                        }
                    }
                    Ok(_) => None,
                    Err(error) if error.raw_os_error() == Some(libc::ELOOP) => None,
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
                    stack.push(path);
                    continue;
                }
                if !metadata.is_file() {
                    continue;
                }
                FileCandidate::inspect_path(&plan.root_path, &path)?
            };
            if let Some(candidate) = candidate {
                batch.push(candidate);
                if batch.len() >= INSERT_BATCH {
                    flush_batch(
                        &mut connection,
                        plan,
                        &mut batch,
                        &mut seen,
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
        &mut seen,
        &mut observed_count,
        &mut unsupported_count,
        events,
    )?;
    mark_unseen_missing(&mut connection, plan, &seen)?;
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
    seen: &mut BTreeSet<Vec<u8>>,
    observed_count: &mut u64,
    unsupported_count: &mut u64,
    events: &dyn EventSink,
) -> Result<(), CoreError> {
    flush_batch(
        connection,
        plan,
        batch,
        seen,
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
    seen: &mut BTreeSet<Vec<u8>>,
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
        seen.insert(candidate.relative_bytes.clone());
        if let Some(existing) = existing_location(&transaction, plan, &candidate)? {
            refresh_existing(&transaction, &existing, &candidate, timestamp)?;
        } else if let Some(existing) = relocated_location(&transaction, plan, &candidate)? {
            relocate_existing(&transaction, &existing, &candidate, timestamp)?;
            refresh_existing(&transaction, &existing, &candidate, timestamp)?;
        } else {
            inserted_asset_ids.push(insert_new(&transaction, plan, &candidate, timestamp)?);
        }
        *observed_count += 1;
        if !candidate.servable {
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
    let location_state = if candidate.servable {
        "present"
    } else {
        "unreadable"
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
            "UPDATE sources SET current_revision_id = ?1, lineage_state = 'active',
                                updated_at_ms = ?2 WHERE id = ?3",
            params![revision_id, timestamp, existing.source_id],
        )?;
    } else {
        transaction.execute(
            "UPDATE sources SET lineage_state = 'active', updated_at_ms = ?1 WHERE id = ?2",
            params![timestamp, existing.source_id],
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
         ) VALUES (?1, ?2, 'still', ?3, 'active', ?4, ?4)",
        params![source_id, plan.library_id, revision_id, timestamp],
    )?;
    insert_revision(transaction, &revision_id, &source_id, candidate, timestamp)?;
    let location_state = if candidate.servable {
        "present"
    } else {
        "unreadable"
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
                "pixelHeight": candidate.pixel_height
            })
            .to_string(),
            timestamp,
        ],
    )?;
    Ok(())
}

fn mark_unseen_missing(
    connection: &mut Connection,
    plan: &ScanPlan,
    seen: &BTreeSet<Vec<u8>>,
) -> Result<(), CoreError> {
    let locations = {
        let mut statement = connection.prepare(
            "SELECT id, source_id, relative_path_bytes FROM locations WHERE root_id = ?1",
        )?;
        statement
            .query_map(params![plan.root_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    let missing = locations
        .into_iter()
        .filter(|(_, _, bytes)| !seen.contains(bytes))
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return Ok(());
    }
    let timestamp = now_ms() as i64;
    let transaction = connection.transaction()?;
    for (location_id, source_id, _) in missing {
        transaction.execute(
            "UPDATE locations SET state = 'missing', updated_at_ms = ?1 WHERE id = ?2",
            params![timestamp, location_id],
        )?;
        transaction.execute(
            "UPDATE sources SET lineage_state = 'missing', updated_at_ms = ?1
             WHERE id = ?2 AND NOT EXISTS (
                 SELECT 1 FROM locations WHERE source_id = ?2 AND state = 'present'
             )",
            params![timestamp, source_id],
        )?;
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
    connection.execute(
        "UPDATE roots SET state = 'ready', updated_at_ms = ?1, last_seen_at_ms = ?1
         WHERE id = ?2",
        params![timestamp, plan.root_id],
    )?;
    connection.execute(
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
    bump_revision(connection, timestamp)?;
    Ok(())
}

fn mark_cancelled(
    connection: &Connection,
    plan: &ScanPlan,
    count: u64,
    unsupported_count: u64,
) -> Result<(), CoreError> {
    let timestamp = now_ms() as i64;
    connection.execute(
        "UPDATE roots SET state = 'connected', updated_at_ms = ?1 WHERE id = ?2",
        params![timestamp, plan.root_id],
    )?;
    connection.execute(
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
    bump_revision(connection, timestamp)?;
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
    extension: Option<String>,
    pixel_width: usize,
    pixel_height: usize,
    servable: bool,
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
        let mut prefix = [0_u8; 64];
        let prefix_len = file.read(&mut prefix)?;
        file.seek(SeekFrom::Start(0))?;
        let kind = classify_still(&prefix[..prefix_len], extension.as_deref());
        let Some((mime_type, potentially_servable)) = kind else {
            return Ok(None);
        };
        let dimensions = if potentially_servable {
            imagesize::reader_size(BufReader::new(file.try_clone()?)).ok()
        } else {
            None
        };
        let servable = dimensions
            .is_some_and(|dimensions| valid_dimensions(dimensions.width, dimensions.height));
        let (pixel_width, pixel_height) = dimensions
            .filter(|dimensions| valid_dimensions(dimensions.width, dimensions.height))
            .map(|dimensions| (dimensions.width, dimensions.height))
            .unwrap_or_default();
        let fingerprint =
            full_fingerprint_cancellable(&mut file, before.len(), Some(cancelled), None)?;
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
            mime_type: mime_type.into(),
            extension,
            pixel_width,
            pixel_height,
            servable,
        }))
    }

    #[cfg(not(unix))]
    fn inspect_path(root: &Path, path: &Path) -> Result<Option<Self>, CoreError> {
        let relative = path
            .strip_prefix(root)
            .map_err(|_| CoreError::LocationMissing)?;
        let mut file = File::open(path)?;
        let before = file.metadata()?;
        let mut prefix = [0_u8; 64];
        let prefix_len = file.read(&mut prefix)?;
        file.seek(SeekFrom::Start(0))?;
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        let Some((mime_type, potentially_servable)) =
            classify_still(&prefix[..prefix_len], extension.as_deref())
        else {
            return Ok(None);
        };
        let dimensions = potentially_servable
            .then(|| imagesize::reader_size(BufReader::new(file.try_clone())).ok())
            .flatten();
        let servable = dimensions
            .is_some_and(|dimensions| valid_dimensions(dimensions.width, dimensions.height));
        let (pixel_width, pixel_height) = dimensions
            .filter(|dimensions| valid_dimensions(dimensions.width, dimensions.height))
            .map(|dimensions| (dimensions.width, dimensions.height))
            .unwrap_or_default();
        let fingerprint = full_fingerprint(&mut file, before.len())?;
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
            mime_type: mime_type.into(),
            extension,
            pixel_width,
            pixel_height,
            servable,
        }))
    }
}

#[cfg(unix)]
fn read_directory_names(directory: &File) -> Result<Vec<OsString>, CoreError> {
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

fn classify_still(bytes: &[u8], extension: Option<&str>) -> Option<(&'static str, bool)> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some(("image/png", true))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", true))
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", true))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("image/gif", false))
    } else if bytes.starts_with(b"BM") {
        Some(("image/bmp", false))
    } else if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        Some(("image/tiff", false))
    } else if bytes.starts_with(b"8BPS") {
        Some(("image/vnd.adobe.photoshop", false))
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && matches!(&bytes[8..12], b"avif" | b"avis")
    {
        Some(("image/avif", false))
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        Some(("image/heic", false))
    } else if bytes
        .iter()
        .take(64)
        .copied()
        .collect::<Vec<_>>()
        .windows(4)
        .any(|window| window.eq_ignore_ascii_case(b"<svg"))
    {
        Some(("image/svg+xml", false))
    } else {
        match extension {
            Some("gif") => Some(("image/gif", false)),
            Some("bmp") => Some(("image/bmp", false)),
            Some("tif" | "tiff") => Some(("image/tiff", false)),
            Some("psd") => Some(("image/vnd.adobe.photoshop", false)),
            Some("avif") => Some(("image/avif", false)),
            Some("heic" | "heif") => Some(("image/heic", false)),
            Some("svg") => Some(("image/svg+xml", false)),
            _ => None,
        }
    }
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

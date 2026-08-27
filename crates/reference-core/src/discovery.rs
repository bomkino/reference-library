use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
    },
    time::UNIX_EPOCH,
};

#[cfg(unix)]
use std::{ffi::OsString, os::unix::ffi::OsStringExt, os::unix::fs::MetadataExt};

use reference_protocol::Event;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::CoreError,
    manifest::Manifest,
    now_ms, schema,
    session::{bump_revision, read_prefix, relative_path_bytes},
};

const INSERT_BATCH: usize = 32;
const QUICK_FINGERPRINT_CHUNK: u64 = 64 * 1024;

#[derive(Debug, Clone)]
pub struct ScanPlan {
    pub package_path: PathBuf,
    pub root_path: PathBuf,
    pub library_id: String,
    pub root_id: String,
    pub job_id: String,
}

pub fn scan_root(plan: ScanPlan, cancelled: Arc<AtomicBool>, events: Sender<Event>) {
    let outcome = run_scan(&plan, &cancelled, &events);
    if let Err(error) = outcome {
        let _ = mark_failed(&plan, &error);
        let _ = events.send(Event::RootStateChanged {
            root_id: plan.root_id.clone(),
            state: "error".into(),
        });
        let _ = events.send(Event::JobUpdated {
            job_id: plan.job_id,
            state: "failed".into(),
        });
    }
}

fn run_scan(
    plan: &ScanPlan,
    cancelled: &AtomicBool,
    events: &Sender<Event>,
) -> Result<(), CoreError> {
    let manifest = Manifest::read(&plan.package_path)?;
    let mut connection =
        schema::open_database(&plan.package_path.join("library.sqlite"), &manifest)?;
    let mut stack = vec![plan.root_path.clone()];
    let mut batch = Vec::with_capacity(INSERT_BATCH);
    let mut seen = BTreeSet::new();
    let mut observed_count = 0_u64;

    while let Some(directory) = stack.pop() {
        if cancelled.load(Ordering::Relaxed) {
            finish_cancelled(
                &mut connection,
                plan,
                &mut batch,
                &mut seen,
                &mut observed_count,
                events,
            )?;
            return Ok(());
        }
        let mut entries = fs::read_dir(&directory)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries.into_iter().rev() {
            if cancelled.load(Ordering::Relaxed) {
                finish_cancelled(
                    &mut connection,
                    plan,
                    &mut batch,
                    &mut seen,
                    &mut observed_count,
                    events,
                )?;
                return Ok(());
            }
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                stack.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if let Some(candidate) = FileCandidate::inspect(&plan.root_path, &entry.path())? {
                batch.push(candidate);
                if batch.len() >= INSERT_BATCH {
                    flush_batch(
                        &mut connection,
                        plan,
                        &mut batch,
                        &mut seen,
                        &mut observed_count,
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
        events,
    )?;
    mark_unseen_missing(&mut connection, plan, &seen)?;
    mark_completed(&connection, plan, observed_count)?;
    events
        .send(Event::ScanProgressChanged {
            root_id: plan.root_id.clone(),
            job_id: plan.job_id.clone(),
            observed_count,
            unsupported_count: 0,
            terminal: true,
        })
        .ok();
    events
        .send(Event::RootStateChanged {
            root_id: plan.root_id.clone(),
            state: "ready".into(),
        })
        .ok();
    events
        .send(Event::JobUpdated {
            job_id: plan.job_id.clone(),
            state: "completed".into(),
        })
        .ok();
    Ok(())
}

fn finish_cancelled(
    connection: &mut Connection,
    plan: &ScanPlan,
    batch: &mut Vec<FileCandidate>,
    seen: &mut BTreeSet<Vec<u8>>,
    observed_count: &mut u64,
    events: &Sender<Event>,
) -> Result<(), CoreError> {
    flush_batch(connection, plan, batch, seen, observed_count, events)?;
    mark_cancelled(connection, plan, *observed_count)?;
    events
        .send(Event::ScanProgressChanged {
            root_id: plan.root_id.clone(),
            job_id: plan.job_id.clone(),
            observed_count: *observed_count,
            unsupported_count: 0,
            terminal: true,
        })
        .ok();
    events
        .send(Event::RootStateChanged {
            root_id: plan.root_id.clone(),
            state: "connected".into(),
        })
        .ok();
    events
        .send(Event::JobUpdated {
            job_id: plan.job_id.clone(),
            state: "cancelled".into(),
        })
        .ok();
    Ok(())
}

fn flush_batch(
    connection: &mut Connection,
    plan: &ScanPlan,
    candidates: &mut Vec<FileCandidate>,
    seen: &mut BTreeSet<Vec<u8>>,
    observed_count: &mut u64,
    events: &Sender<Event>,
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
    }
    transaction.execute(
        "UPDATE jobs SET progress_json = ?1, updated_at_ms = ?2 WHERE id = ?3",
        params![
            serde_json::json!({"observedCount": observed_count}).to_string(),
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
        events
            .send(Event::AssetsInserted {
                root_id: plan.root_id.clone(),
                asset_ids: inserted_asset_ids,
                library_revision: revision,
            })
            .ok();
    }
    events
        .send(Event::ScanProgressChanged {
            root_id: plan.root_id.clone(),
            job_id: plan.job_id.clone(),
            observed_count: *observed_count,
            unsupported_count: 0,
            terminal: false,
        })
        .ok();
    Ok(())
}

#[derive(Debug)]
struct ExistingLocation {
    location_id: String,
    source_id: String,
    byte_size: Option<i64>,
    mtime_ms: Option<i64>,
}

fn existing_location(
    transaction: &Transaction<'_>,
    plan: &ScanPlan,
    candidate: &FileCandidate,
) -> Result<Option<ExistingLocation>, CoreError> {
    Ok(transaction
        .query_row(
            "SELECT id, source_id, last_stat_size, last_stat_mtime_ms
             FROM locations WHERE root_id = ?1 AND relative_path_bytes = ?2",
            params![plan.root_id, candidate.relative_bytes],
            |row| {
                Ok(ExistingLocation {
                    location_id: row.get(0)?,
                    source_id: row.get(1)?,
                    byte_size: row.get(2)?,
                    mtime_ms: row.get(3)?,
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
        || !stored_path_is_absent(&plan.root_path, old_relative_bytes)
    {
        return Ok(None);
    }
    Ok(Some(ExistingLocation {
        location_id: existing.location_id.clone(),
        source_id: existing.source_id.clone(),
        byte_size: existing.byte_size,
        mtime_ms: existing.mtime_ms,
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
    transaction.execute(
        "UPDATE locations SET state = 'present', relative_path_display = ?1,
             last_stat_size = ?2, last_stat_mtime_ms = ?3,
             platform_file_id = ?4, platform_file_id_kind = ?5, updated_at_ms = ?6
         WHERE id = ?7",
        params![
            candidate.relative_display,
            candidate.byte_size as i64,
            candidate.mtime_ms,
            candidate.platform_file_id,
            candidate.platform_file_id_kind,
            timestamp,
            existing.location_id
        ],
    )?;
    if existing.byte_size != Some(candidate.byte_size as i64)
        || existing.mtime_ms != candidate.mtime_ms
    {
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
    transaction.execute(
        "INSERT INTO locations (
            id, root_id, source_id, relative_path_bytes, relative_path_display,
            platform_file_id, platform_file_id_kind, state, last_stat_size,
            last_stat_mtime_ms, created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'present', ?8, ?9, ?10, ?10)",
        params![
            location_id,
            plan.root_id,
            source_id,
            candidate.relative_bytes,
            candidate.relative_display,
            candidate.platform_file_id,
            candidate.platform_file_id_kind,
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
    for profile in ["grid_standard", "preview"] {
        transaction.execute(
            "INSERT INTO renditions (
                id, asset_origin_id, source_revision_id, profile, provider,
                provider_version, state, created_at_ms
             ) VALUES (?1, ?2, ?3, ?4, 'original-common-still', '1', 'ready', ?5)",
            params![
                Uuid::new_v4().to_string(),
                origin_id,
                revision_id,
                profile,
                timestamp
            ],
        )?;
    }
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

fn mark_completed(connection: &Connection, plan: &ScanPlan, count: u64) -> Result<(), CoreError> {
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
            serde_json::json!({"observedCount": count}).to_string(),
            timestamp,
            plan.job_id
        ],
    )?;
    bump_revision(connection, timestamp)?;
    Ok(())
}

fn mark_cancelled(connection: &Connection, plan: &ScanPlan, count: u64) -> Result<(), CoreError> {
    let timestamp = now_ms() as i64;
    connection.execute(
        "UPDATE roots SET state = 'connected', updated_at_ms = ?1 WHERE id = ?2",
        params![timestamp, plan.root_id],
    )?;
    connection.execute(
        "UPDATE jobs SET state = 'cancelled', progress_json = ?1,
                         updated_at_ms = ?2, finished_at_ms = ?2 WHERE id = ?3",
        params![
            serde_json::json!({"observedCount": count}).to_string(),
            timestamp,
            plan.job_id
        ],
    )?;
    bump_revision(connection, timestamp)?;
    Ok(())
}

fn mark_failed(plan: &ScanPlan, error: &CoreError) -> Result<(), CoreError> {
    let manifest = Manifest::read(&plan.package_path)?;
    let connection = schema::open_database(&plan.package_path.join("library.sqlite"), &manifest)?;
    let timestamp = now_ms() as i64;
    connection.execute(
        "UPDATE roots SET state = 'error', updated_at_ms = ?1 WHERE id = ?2",
        params![timestamp, plan.root_id],
    )?;
    connection.execute(
        "UPDATE jobs SET state = 'failed', error_code = ?1,
                         updated_at_ms = ?2, finished_at_ms = ?2 WHERE id = ?3",
        params![error.to_protocol_error().code, timestamp, plan.job_id],
    )?;
    bump_revision(&connection, timestamp)?;
    Ok(())
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
}

impl FileCandidate {
    fn inspect(root: &Path, path: &Path) -> Result<Option<Self>, CoreError> {
        let prefix = read_prefix(path, 16)?;
        let Some(mime_type) = detect_common_still(&prefix) else {
            return Ok(None);
        };
        let relative = path
            .strip_prefix(root)
            .map_err(|_| CoreError::LocationMissing)?;
        let metadata = path.metadata()?;
        let dimensions = match imagesize::size(path) {
            Ok(dimensions)
                if dimensions.width > 0
                    && dimensions.height > 0
                    && dimensions.width <= 100_000
                    && dimensions.height <= 100_000
                    && dimensions.width.saturating_mul(dimensions.height) <= 500_000_000 =>
            {
                dimensions
            }
            _ => return Ok(None),
        };
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64);
        let (platform_file_id, platform_file_id_kind, platform_link_count) =
            platform_identity(&metadata);
        Ok(Some(Self {
            relative_bytes: relative_path_bytes(relative),
            relative_display: relative.to_string_lossy().into_owned(),
            byte_size: metadata.len(),
            mtime_ms,
            quick_fingerprint: quick_fingerprint(path, metadata.len())?,
            platform_file_id,
            platform_file_id_kind,
            platform_link_count,
            mime_type: mime_type.into(),
            extension: path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase()),
            pixel_width: dimensions.width,
            pixel_height: dimensions.height,
        }))
    }
}

fn stored_path_is_absent(root: &Path, relative_bytes: &[u8]) -> bool {
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
    matches!(
        fs::symlink_metadata(root.join(relative)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound
    )
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

fn detect_common_still(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn quick_fingerprint(path: &Path, size: u64) -> Result<String, CoreError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    hasher.update(size.to_be_bytes());
    let mut buffer = vec![0_u8; QUICK_FINGERPRINT_CHUNK as usize];
    let first_read = file.read(&mut buffer)?;
    hasher.update(&buffer[..first_read]);
    if size > QUICK_FINGERPRINT_CHUNK {
        file.seek(SeekFrom::Start(
            size.saturating_sub(QUICK_FINGERPRINT_CHUNK),
        ))?;
        let last_read = file.read(&mut buffer)?;
        hasher.update(&buffer[..last_read]);
    }
    Ok(format!("sha256-quick:{}", hex(&hasher.finalize())))
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

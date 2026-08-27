use std::{
    collections::HashMap,
    env,
    fs::{self, File, OpenOptions},
    io::{BufReader, Cursor, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex, OnceLock, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, metadata::Orientation};
use reference_protocol::{Event, ResourceDescriptor, ResourceProfile};
use rusqlite::params;
use uuid::Uuid;

use crate::{
    error::CoreError, manifest::Manifest, now_ms, schema, session::full_fingerprint_cancellable,
};

pub const GRID_PROVIDER_VERSION: &str = "still-grid-v1";
pub const PREVIEW_PROVIDER_VERSION: &str = "verified-preview-v1";
pub const MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_DECODE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_DECODE_PIXELS: u64 = 64 * 1024 * 1024;
pub const MAX_GRID_EDGE: u32 = 512;
pub const MAX_GRID_BYTES: u64 = 8 * 1024 * 1024;
const DEADLINE: Duration = Duration::from_secs(30);
const MAX_INTEGRITY_BYTES: u64 = 4 * 1024;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GridIntegrity {
    provider_version: String,
    source_fingerprint: String,
    output_fingerprint: String,
    output_length: u64,
}

#[derive(Debug)]
pub struct ResourcePlan {
    pub package_path: PathBuf,
    pub library_id: String,
    pub session_id: String,
    pub asset_id: String,
    pub location_id: String,
    pub root_id: String,
    pub source_revision_id: String,
    pub profile: ResourceProfile,
    pub source_mime_type: String,
    pub source_length: u64,
    pub expected_fingerprint: String,
    pub source_file: File,
    pub job_id: Option<String>,
}

pub fn authorize(
    mut plan: ResourcePlan,
    cancelled: &AtomicBool,
) -> Result<ResourceDescriptor, CoreError> {
    let started = Instant::now();
    checkpoint(cancelled, started)?;
    validate_cache_id(&plan.library_id)?;
    validate_cache_id(&plan.source_revision_id)?;
    if plan.source_length > MAX_SOURCE_BYTES {
        return Err(CoreError::ResourceTooLarge);
    }
    validate_source_evidence(
        &mut plan.source_file,
        plan.source_length,
        &plan.expected_fingerprint,
        cancelled,
        started,
    )?;
    let cache_root = private_cache_root(&plan.package_path)?;
    let (provider, extension, mime_type) = match plan.profile {
        ResourceProfile::GridStandard => (GRID_PROVIDER_VERSION, "png", "image/png"),
        ResourceProfile::Preview => (
            PREVIEW_PROVIDER_VERSION,
            extension_for_mime(&plan.source_mime_type)?,
            plan.source_mime_type.as_str(),
        ),
    };
    let target = cache_root
        .join(&plan.library_id)
        .join(provider)
        .join(&plan.source_revision_id)
        .join(format!("{}.{}", profile_key(plan.profile), extension));
    let integrity_target = integrity_path(&target);
    ensure_private_parent(&cache_root, &target)?;
    let _permit = acquire_key(&target, cancelled, started)?;
    checkpoint(cancelled, started)?;
    if validate_cached(
        &target,
        plan.profile,
        &plan.expected_fingerprint,
        plan.source_length,
        cancelled,
        started,
    )? {
        return descriptor(&plan, target, mime_type);
    }
    if target.exists() {
        fs::remove_file(&target).map_err(|_| CoreError::RenditionCacheFailure)?;
    }
    if integrity_target.exists() {
        fs::remove_file(&integrity_target).map_err(|_| CoreError::RenditionCacheFailure)?;
    }
    let temporary = target.with_file_name(format!(
        ".{}.{}.tmp",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("resource"),
        Uuid::new_v4()
    ));
    let integrity_temporary = integrity_path(&temporary);
    let result = match plan.profile {
        ResourceProfile::Preview => publish_preview_snapshot(
            &mut plan.source_file,
            &temporary,
            plan.source_length,
            &plan.expected_fingerprint,
            cancelled,
            started,
        ),
        ResourceProfile::GridStandard => publish_grid(
            &mut plan.source_file,
            &temporary,
            plan.source_length,
            &plan.expected_fingerprint,
            &plan.source_mime_type,
            cancelled,
            started,
        ),
    };
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        let _ = fs::remove_file(&integrity_temporary);
        return Err(error);
    }
    if plan.profile == ResourceProfile::GridStandard {
        let integrity_result = (|| -> Result<(), CoreError> {
            let mut output = File::open(&temporary)?;
            let output_length = output.metadata()?.len();
            let output_fingerprint = full_fingerprint_cancellable(
                &mut output,
                output_length,
                Some(cancelled),
                Some(started + DEADLINE),
            )?;
            let bytes = serde_json::to_vec(&GridIntegrity {
                provider_version: GRID_PROVIDER_VERSION.into(),
                source_fingerprint: plan.expected_fingerprint.clone(),
                output_fingerprint,
                output_length,
            })
            .map_err(|_| CoreError::RenditionCacheFailure)?;
            let mut integrity = private_temporary(&integrity_temporary)?;
            integrity.write_all(&bytes)?;
            integrity.sync_all()?;
            Ok(())
        })();
        if let Err(error) = integrity_result {
            let _ = fs::remove_file(&temporary);
            let _ = fs::remove_file(&integrity_temporary);
            return Err(error);
        }
    }
    if let Err(error) = checkpoint(cancelled, started) {
        let _ = fs::remove_file(&temporary);
        let _ = fs::remove_file(&integrity_temporary);
        return Err(error);
    }
    fs::rename(&temporary, &target).map_err(|_| CoreError::RenditionCacheFailure)?;
    if plan.profile == ResourceProfile::GridStandard
        && fs::rename(&integrity_temporary, &integrity_target).is_err()
    {
        let _ = fs::remove_file(&target);
        let _ = fs::remove_file(&integrity_temporary);
        return Err(CoreError::RenditionCacheFailure);
    }
    File::open(target.parent().ok_or(CoreError::RenditionCacheFailure)?)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| CoreError::RenditionCacheFailure)?;
    descriptor(&plan, target, mime_type)
}

pub fn run_job(
    plan: ResourcePlan,
    cancelled: Arc<AtomicBool>,
    events: impl crate::discovery::EventSink,
) -> Result<ResourceDescriptor, CoreError> {
    run_job_outcome(plan, cancelled, events).result
}

pub struct ResourceJobOutcome {
    pub result: Result<ResourceDescriptor, CoreError>,
    pub terminal_persisted: bool,
}

pub fn run_job_outcome(
    plan: ResourcePlan,
    cancelled: Arc<AtomicBool>,
    events: impl crate::discovery::EventSink,
) -> ResourceJobOutcome {
    let job_id = plan.job_id.clone().ok_or(CoreError::RenditionCacheFailure);
    let Ok(job_id) = job_id else {
        return ResourceJobOutcome {
            result: Err(CoreError::RenditionCacheFailure),
            terminal_persisted: false,
        };
    };
    if let Err(error) = update_job(&plan, "running", None) {
        events.emit(Event::CoreNeedsRestart {
            reason: error.to_protocol_error().code,
        });
        return ResourceJobOutcome {
            result: Err(error),
            terminal_persisted: false,
        };
    }
    events.emit(Event::JobUpdated {
        job_id: job_id.clone(),
        state: "running".into(),
    });
    let result = clone_plan(&plan).and_then(|plan| authorize(plan, &cancelled));
    let (state, error_code) = match &result {
        Ok(_) => ("completed", None),
        Err(CoreError::RenditionCancelled) => ("cancelled", None),
        Err(error) => ("failed", Some(error.to_protocol_error().code)),
    };
    if let Err(error) = update_job(&plan, state, error_code.as_deref()) {
        events.emit(Event::CoreNeedsRestart {
            reason: error.to_protocol_error().code,
        });
        return ResourceJobOutcome {
            result: Err(error),
            terminal_persisted: false,
        };
    }
    events.emit(Event::JobUpdated {
        job_id,
        state: state.into(),
    });
    ResourceJobOutcome {
        result,
        terminal_persisted: true,
    }
}

fn clone_plan(plan: &ResourcePlan) -> Result<ResourcePlan, CoreError> {
    Ok(ResourcePlan {
        package_path: plan.package_path.clone(),
        library_id: plan.library_id.clone(),
        session_id: plan.session_id.clone(),
        asset_id: plan.asset_id.clone(),
        location_id: plan.location_id.clone(),
        root_id: plan.root_id.clone(),
        source_revision_id: plan.source_revision_id.clone(),
        profile: plan.profile,
        source_mime_type: plan.source_mime_type.clone(),
        source_length: plan.source_length,
        expected_fingerprint: plan.expected_fingerprint.clone(),
        source_file: plan.source_file.try_clone()?,
        job_id: plan.job_id.clone(),
    })
}

fn update_job(plan: &ResourcePlan, state: &str, error_code: Option<&str>) -> Result<(), CoreError> {
    let manifest = Manifest::read(&plan.package_path)?;
    let connection = schema::open_database(&plan.package_path.join("library.sqlite"), &manifest)?;
    let timestamp = now_ms() as i64;
    let finished = matches!(state, "completed" | "failed" | "cancelled");
    connection.execute(
        "UPDATE jobs SET state=?1, progress_json=?2, error_code=?3, updated_at_ms=?4,
         finished_at_ms=CASE WHEN ?5 THEN ?4 ELSE NULL END
         WHERE id=?6 AND job_kind='rendition_generation'",
        params![
            state,
            serde_json::json!({"phase": state}).to_string(),
            error_code,
            timestamp,
            finished,
            plan.job_id
        ],
    )?;
    if finished {
        prune_jobs(&connection)?;
    }
    Ok(())
}

pub fn prune_jobs(connection: &rusqlite::Connection) -> Result<(), CoreError> {
    connection.execute(
        "DELETE FROM jobs WHERE job_kind='rendition_generation'
         AND state IN ('completed','failed','cancelled') AND id NOT IN (
           SELECT id FROM jobs WHERE job_kind='rendition_generation'
           AND state IN ('completed','failed','cancelled')
           ORDER BY updated_at_ms DESC,id DESC LIMIT 128)",
        [],
    )?;
    Ok(())
}

fn publish_preview_snapshot(
    source: &mut File,
    temporary: &Path,
    expected_length: u64,
    expected_fingerprint: &str,
    cancelled: &AtomicBool,
    started: Instant,
) -> Result<(), CoreError> {
    source.seek(SeekFrom::Start(0))?;
    let before = source.metadata()?;
    if before.len() != expected_length {
        return Err(CoreError::SourceRevisionChanged);
    }
    let mut output = private_temporary(temporary)?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut copied = 0_u64;
    loop {
        checkpoint(cancelled, started)?;
        let read = source.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        copied += read as u64;
        if copied > expected_length || copied > MAX_SOURCE_BYTES {
            return Err(CoreError::SourceRevisionChanged);
        }
        output.write_all(&buffer[..read])?;
    }
    if copied != expected_length || source.metadata()?.len() != before.len() {
        return Err(CoreError::SourceRevisionChanged);
    }
    if full_fingerprint_cancellable(
        source,
        expected_length,
        Some(cancelled),
        Some(started + DEADLINE),
    )? != expected_fingerprint
    {
        return Err(CoreError::SourceRevisionChanged);
    }
    checkpoint(cancelled, started)?;
    output.sync_all()?;
    Ok(())
}

fn publish_grid(
    source: &mut File,
    temporary: &Path,
    expected_length: u64,
    expected_fingerprint: &str,
    expected_mime: &str,
    cancelled: &AtomicBool,
    started: Instant,
) -> Result<(), CoreError> {
    let before = source.metadata()?;
    if before.len() != expected_length {
        return Err(CoreError::SourceRevisionChanged);
    }
    checkpoint(cancelled, started)?;
    source.seek(SeekFrom::Start(0))?;
    let format = format_for_mime(expected_mime)?;
    verify_signature(source, format)?;
    source.seek(SeekFrom::Start(0))?;
    let mut reader = ImageReader::with_format(BufReader::new(source.try_clone()?), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(100_000);
    limits.max_image_height = Some(100_000);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| CoreError::RenditionInputInvalid)?;
    let (width, height) = decoder.dimensions();
    if u64::from(width).saturating_mul(u64::from(height)) > MAX_DECODE_PIXELS
        || decoder.total_bytes() > MAX_DECODE_BYTES
    {
        return Err(CoreError::RenditionLimitExceeded);
    }
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    test_hang_immediately_before_grid_decode();
    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|_| CoreError::RenditionInputInvalid)?;
    checkpoint(cancelled, started)?;
    image.apply_orientation(orientation);
    let thumbnail = image.thumbnail(MAX_GRID_EDGE, MAX_GRID_EDGE);
    drop(image);
    let mut encoded = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut encoded, ImageFormat::Png)
        .map_err(|_| CoreError::RenditionCacheFailure)?;
    if encoded.get_ref().len() as u64 > MAX_GRID_BYTES {
        return Err(CoreError::RenditionLimitExceeded);
    }
    checkpoint(cancelled, started)?;
    let mut output = private_temporary(temporary)?;
    output.write_all(encoded.get_ref())?;
    output.sync_all()?;
    if source.metadata()?.len() != before.len()
        || full_fingerprint_cancellable(
            source,
            expected_length,
            Some(cancelled),
            Some(started + DEADLINE),
        )? != expected_fingerprint
    {
        return Err(CoreError::SourceRevisionChanged);
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn test_hang_immediately_before_grid_decode() {
    let enabled = env::var("PITCHDOG_ENABLE_TEST_COMMANDS").as_deref() == Ok("1")
        && env::var("PITCHDOG_TEST_HANG_BEFORE_GRID_DECODE").as_deref() == Ok("1");
    if !enabled {
        return;
    }
    eprintln!("reference-core: test hook reached immediately before grid decode");
    loop {
        std::thread::park();
    }
}

#[cfg(not(debug_assertions))]
fn test_hang_immediately_before_grid_decode() {}

fn descriptor(
    plan: &ResourcePlan,
    target: PathBuf,
    mime_type: &str,
) -> Result<ResourceDescriptor, CoreError> {
    let content_length = target.metadata()?.len();
    Ok(ResourceDescriptor {
        resource_token: Uuid::new_v4().to_string(),
        session_id: plan.session_id.clone(),
        asset_id: plan.asset_id.clone(),
        location_id: plan.location_id.clone(),
        profile: plan.profile,
        mime_type: mime_type.into(),
        content_length,
        native_path_for_handler: target.to_string_lossy().into_owned(),
    })
}

fn private_cache_root(package_path: &Path) -> Result<PathBuf, CoreError> {
    let base = env::var_os("PITCHDOG_REFERENCE_CACHE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| env::temp_dir().join("pitchdog-reference-cache"));
    if base.exists() && fs::symlink_metadata(&base)?.file_type().is_symlink() {
        return Err(CoreError::RenditionCacheUnsafe);
    }
    fs::create_dir_all(&base).map_err(|_| CoreError::RenditionCacheFailure)?;
    let base = base
        .canonicalize()
        .map_err(|_| CoreError::RenditionCacheFailure)?;
    let package = package_path
        .canonicalize()
        .map_err(|_| CoreError::RenditionCacheUnsafe)?;
    let cache = base.join("reference-library-v1");
    create_private_directory(&cache)?;
    let cache = cache
        .canonicalize()
        .map_err(|_| CoreError::RenditionCacheFailure)?;
    if cache.starts_with(package) {
        return Err(CoreError::RenditionCacheUnsafe);
    }
    Ok(cache)
}

fn ensure_private_parent(cache_root: &Path, target: &Path) -> Result<(), CoreError> {
    let parent = target.parent().ok_or(CoreError::RenditionCacheUnsafe)?;
    let relative = parent
        .strip_prefix(cache_root)
        .map_err(|_| CoreError::RenditionCacheUnsafe)?;
    let mut current = cache_root.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(component) = component else {
            return Err(CoreError::RenditionCacheUnsafe);
        };
        current.push(component);
        create_private_directory(&current)?;
    }
    let resolved = parent
        .canonicalize()
        .map_err(|_| CoreError::RenditionCacheFailure)?;
    if !resolved.starts_with(cache_root) {
        return Err(CoreError::RenditionCacheUnsafe);
    }
    Ok(())
}

fn validate_cache_id(value: &str) -> Result<(), CoreError> {
    let parsed = Uuid::parse_str(value).map_err(|_| CoreError::RenditionCacheUnsafe)?;
    if parsed.to_string() != value {
        return Err(CoreError::RenditionCacheUnsafe);
    }
    Ok(())
}

fn create_private_directory(path: &Path) -> Result<(), CoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err(CoreError::RenditionCacheUnsafe),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|_| CoreError::RenditionCacheFailure)?
        }
        Err(_) => return Err(CoreError::RenditionCacheFailure),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| CoreError::RenditionCacheFailure)?;
    }
    Ok(())
}

fn private_temporary(path: &Path) -> Result<File, CoreError> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| CoreError::RenditionCacheFailure)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    Ok(file)
}

fn validate_cached(
    path: &Path,
    profile: ResourceProfile,
    expected_fingerprint: &str,
    expected_source_length: u64,
    cancelled: &AtomicBool,
    started: Instant,
) -> Result<bool, CoreError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err(CoreError::RenditionCacheFailure),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CoreError::RenditionCacheUnsafe);
    }
    match profile {
        ResourceProfile::GridStandard => {
            if metadata.len() == 0 || metadata.len() > MAX_GRID_BYTES {
                return Ok(false);
            }
            let integrity_path = integrity_path(path);
            let integrity_metadata = match fs::symlink_metadata(&integrity_path) {
                Ok(metadata)
                    if metadata.is_file()
                        && !metadata.file_type().is_symlink()
                        && metadata.len() <= MAX_INTEGRITY_BYTES =>
                {
                    metadata
                }
                Ok(_) => return Ok(false),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
                Err(_) => return Err(CoreError::RenditionCacheFailure),
            };
            let mut integrity_bytes = Vec::with_capacity(integrity_metadata.len() as usize);
            File::open(&integrity_path)?.read_to_end(&mut integrity_bytes)?;
            let Ok(integrity) = serde_json::from_slice::<GridIntegrity>(&integrity_bytes) else {
                return Ok(false);
            };
            if integrity.provider_version != GRID_PROVIDER_VERSION
                || integrity.source_fingerprint != expected_fingerprint
                || integrity.output_length != metadata.len()
            {
                return Ok(false);
            }
            let mut output = File::open(path)?;
            if full_fingerprint_cancellable(
                &mut output,
                metadata.len(),
                Some(cancelled),
                Some(started + DEADLINE),
            )? != integrity.output_fingerprint
            {
                return Ok(false);
            }
            validate_grid_image(path)
        }
        ResourceProfile::Preview => {
            if metadata.len() != expected_source_length || metadata.len() > MAX_SOURCE_BYTES {
                return Ok(false);
            }
            let mut file = File::open(path)?;
            Ok(full_fingerprint_cancellable(
                &mut file,
                metadata.len(),
                Some(cancelled),
                Some(started + DEADLINE),
            )? == expected_fingerprint)
        }
    }
}

fn validate_grid_image(path: &Path) -> Result<bool, CoreError> {
    let mut reader = ImageReader::with_format(BufReader::new(File::open(path)?), ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_GRID_EDGE);
    limits.max_image_height = Some(MAX_GRID_EDGE);
    limits.max_alloc = Some(MAX_GRID_BYTES);
    reader.limits(limits);
    let decoder = match reader.into_decoder() {
        Ok(decoder) => decoder,
        Err(_) => return Ok(false),
    };
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || width > MAX_GRID_EDGE
        || height > MAX_GRID_EDGE
        || decoder.total_bytes() > MAX_GRID_BYTES
    {
        return Ok(false);
    }
    Ok(DynamicImage::from_decoder(decoder).is_ok())
}

fn integrity_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("grid");
    path.with_file_name(format!("{name}.integrity.json"))
}

fn validate_source_evidence(
    source: &mut File,
    expected_length: u64,
    expected_fingerprint: &str,
    cancelled: &AtomicBool,
    started: Instant,
) -> Result<(), CoreError> {
    checkpoint(cancelled, started)?;
    let before = source.metadata()?;
    if before.len() != expected_length
        || full_fingerprint_cancellable(
            source,
            expected_length,
            Some(cancelled),
            Some(started + DEADLINE),
        )? != expected_fingerprint
    {
        return Err(CoreError::SourceRevisionChanged);
    }
    checkpoint(cancelled, started)?;
    let after = source.metadata()?;
    if after.len() != before.len() {
        return Err(CoreError::SourceRevisionChanged);
    }
    Ok(())
}

fn verify_signature(file: &mut File, format: ImageFormat) -> Result<(), CoreError> {
    let mut prefix = [0_u8; 16];
    let read = file.read(&mut prefix)?;
    let bytes = &prefix[..read];
    let matches = match format {
        ImageFormat::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        ImageFormat::Jpeg => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        ImageFormat::WebP => {
            bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
        }
        _ => false,
    };
    if matches {
        Ok(())
    } else {
        Err(CoreError::RenditionInputInvalid)
    }
}

fn format_for_mime(mime: &str) -> Result<ImageFormat, CoreError> {
    match mime {
        "image/png" => Ok(ImageFormat::Png),
        "image/jpeg" => Ok(ImageFormat::Jpeg),
        "image/webp" => Ok(ImageFormat::WebP),
        _ => Err(CoreError::UnsupportedPreview),
    }
}
fn extension_for_mime(mime: &str) -> Result<&'static str, CoreError> {
    match mime {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        _ => Err(CoreError::UnsupportedPreview),
    }
}
fn profile_key(profile: ResourceProfile) -> &'static str {
    match profile {
        ResourceProfile::GridStandard => "grid-standard",
        ResourceProfile::Preview => "preview",
    }
}
fn checkpoint(cancelled: &AtomicBool, started: Instant) -> Result<(), CoreError> {
    if cancelled.load(Ordering::Acquire) {
        Err(CoreError::RenditionCancelled)
    } else if started.elapsed() > DEADLINE {
        Err(CoreError::RenditionTimedOut)
    } else {
        Ok(())
    }
}
struct KeyGate {
    active: Mutex<bool>,
    wake: Condvar,
}

struct KeyPermit {
    gate: Arc<KeyGate>,
}

impl Drop for KeyPermit {
    fn drop(&mut self) {
        if let Ok(mut active) = self.gate.active.lock() {
            *active = false;
            self.gate.wake.notify_one();
        }
    }
}

fn acquire_key(
    path: &Path,
    cancelled: &AtomicBool,
    started: Instant,
) -> Result<KeyPermit, CoreError> {
    let gate = key_gate(path);
    let mut active = gate
        .active
        .lock()
        .map_err(|_| CoreError::RenditionCacheFailure)?;
    loop {
        checkpoint(cancelled, started)?;
        if !*active {
            *active = true;
            drop(active);
            return Ok(KeyPermit { gate });
        }
        let remaining = (started + DEADLINE)
            .checked_duration_since(Instant::now())
            .ok_or(CoreError::RenditionTimedOut)?;
        let (next, _) = gate
            .wake
            .wait_timeout(active, remaining.min(Duration::from_millis(10)))
            .map_err(|_| CoreError::RenditionCacheFailure)?;
        active = next;
    }
}

fn key_gate(path: &Path) -> Arc<KeyGate> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<KeyGate>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .expect("rendition lock registry poisoned");
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(path).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(KeyGate {
        active: Mutex::new(false),
        wake: Condvar::new(),
    });
    locks.insert(path.to_path_buf(), Arc::downgrade(&lock));
    lock
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelled_waiter_does_not_wait_for_the_same_cache_key_owner() {
        let path = PathBuf::from("same-cache-key");
        let owner_cancelled = AtomicBool::new(false);
        let owner = acquire_key(&path, &owner_cancelled, Instant::now()).unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_cancelled = Arc::clone(&cancelled);
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            sender
                .send(acquire_key(&path, &worker_cancelled, Instant::now()).map(drop))
                .unwrap();
        });
        std::thread::sleep(Duration::from_millis(20));
        cancelled.store(true, Ordering::Release);
        assert!(matches!(
            receiver.recv_timeout(Duration::from_millis(250)).unwrap(),
            Err(CoreError::RenditionCancelled)
        ));
        drop(owner);
        worker.join().unwrap();
    }
}

use std::{
    collections::HashMap,
    env,
    fs::{self, File, OpenOptions},
    io::{BufReader, Cursor, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, metadata::Orientation};
use reference_protocol::{Event, ResourceDescriptor, ResourceProfile};
use rusqlite::params;
use uuid::Uuid;

use crate::{error::CoreError, manifest::Manifest, now_ms, schema, session::full_fingerprint};

pub const GRID_PROVIDER_VERSION: &str = "still-grid-v1";
pub const PREVIEW_PROVIDER_VERSION: &str = "verified-preview-v1";
pub const MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_DECODE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_DECODE_PIXELS: u64 = 64 * 1024 * 1024;
pub const MAX_GRID_EDGE: u32 = 512;
pub const MAX_GRID_BYTES: u64 = 8 * 1024 * 1024;
const DEADLINE: Duration = Duration::from_secs(30);

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
    if plan.source_length > MAX_SOURCE_BYTES {
        return Err(CoreError::ResourceTooLarge);
    }
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
    ensure_private_parent(&cache_root, &target)?;
    let lock = key_lock(&target);
    let _guard = lock.lock().map_err(|_| CoreError::RenditionCacheFailure)?;
    checkpoint(cancelled, started)?;
    if validate_cached(&target, plan.profile, &plan.expected_fingerprint)? {
        return descriptor(&plan, target, mime_type);
    }
    if target.exists() {
        fs::remove_file(&target).map_err(|_| CoreError::RenditionCacheFailure)?;
    }
    let temporary = target.with_file_name(format!(
        ".{}.{}.tmp",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("resource"),
        Uuid::new_v4()
    ));
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
        return Err(error);
    }
    checkpoint(cancelled, started)?;
    fs::rename(&temporary, &target).map_err(|_| CoreError::RenditionCacheFailure)?;
    File::open(target.parent().ok_or(CoreError::RenditionCacheFailure)?)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| CoreError::RenditionCacheFailure)?;
    descriptor(&plan, target, mime_type)
}

pub fn run_job(
    plan: ResourcePlan,
    cancelled: Arc<AtomicBool>,
    events: std::sync::mpsc::Sender<Event>,
) -> Result<ResourceDescriptor, CoreError> {
    let job_id = plan
        .job_id
        .clone()
        .ok_or(CoreError::RenditionCacheFailure)?;
    update_job(&plan, "running", None)?;
    events
        .send(Event::JobUpdated {
            job_id: job_id.clone(),
            state: "running".into(),
        })
        .ok();
    let result = authorize(clone_plan(&plan)?, &cancelled);
    let (state, error_code) = match &result {
        Ok(_) => ("completed", None),
        Err(CoreError::RenditionCancelled) => ("cancelled", None),
        Err(error) => ("failed", Some(error.to_protocol_error().code)),
    };
    update_job(&plan, state, error_code.as_deref())?;
    events
        .send(Event::JobUpdated {
            job_id,
            state: state.into(),
        })
        .ok();
    result
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
    if full_fingerprint(source, expected_length)? != expected_fingerprint {
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
    if before.len() != expected_length
        || full_fingerprint(source, expected_length)? != expected_fingerprint
    {
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
    if source.metadata()?.len() != before.len() {
        return Err(CoreError::SourceRevisionChanged);
    }
    Ok(())
}

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
            Ok(imagesize::size(path).ok().is_some_and(|size| {
                size.width > 0
                    && size.height > 0
                    && size.width <= MAX_GRID_EDGE as usize
                    && size.height <= MAX_GRID_EDGE as usize
            }))
        }
        ResourceProfile::Preview => {
            let mut file = File::open(path)?;
            Ok(full_fingerprint(&mut file, metadata.len())? == expected_fingerprint)
        }
    }
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
fn key_lock(path: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .expect("rendition lock registry poisoned");
    Arc::clone(
        locks
            .entry(path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(()))),
    )
}

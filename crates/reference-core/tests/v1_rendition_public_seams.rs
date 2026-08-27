use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool, mpsc},
};

use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use reference_core::{
    discovery::scan_root, error::CoreError, rendition::run_job, session::LibrarySession,
};
use reference_protocol::{AssetProjection, Event, JobQuery, JobState, ResourceProfile};
use uuid::Uuid;

struct Project {
    directory: PathBuf,
    root: PathBuf,
    library: PathBuf,
}

impl Project {
    fn new() -> (Self, LibrarySession) {
        let directory =
            std::env::temp_dir().join(format!("reference-v1-rendition-{}", Uuid::new_v4()));
        let root = directory.join("Root");
        let library = directory.join("Project.pitchlibrary");
        fs::create_dir_all(&root).unwrap();
        write_png(&root.join("large.png"), 2048, 1024, 17);
        let session = LibrarySession::create(&library, "Rendition".into()).unwrap();
        let plan = session.add_root(&root, "Root".into()).unwrap();
        let (sender, _receiver) = mpsc::channel();
        scan_root(plan, Arc::new(AtomicBool::new(false)), sender);
        (
            Self {
                directory,
                root,
                library,
            },
            session,
        )
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn grid_is_real_bounded_image_and_preview_is_a_stable_private_snapshot() {
    let (project, mut session) = Project::new();
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let canonical_before = session.canonical_dump().unwrap();
    let source = project.root.join("large.png");
    let source_bytes = fs::read(&source).unwrap();

    let grid = session
        .authorize_resource(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    let grid_path = PathBuf::from(&grid.native_path_for_handler);
    assert!(grid_path.is_file());
    assert!(!grid_path.starts_with(&project.library));
    assert_ne!(fs::read(&grid_path).unwrap(), source_bytes);
    let dimensions = imagesize::size(&grid_path).unwrap();
    assert!(dimensions.width <= 512 && dimensions.height <= 512);
    assert_eq!(grid.mime_type, "image/png");

    let preview = session
        .authorize_resource(&asset.asset_id, ResourceProfile::Preview)
        .unwrap();
    let preview_path = PathBuf::from(&preview.native_path_for_handler);
    assert_ne!(preview_path, source);
    assert!(!preview_path.starts_with(&project.library));
    assert_eq!(fs::read(&preview_path).unwrap(), source_bytes);
    write_png(&source, 16, 16, 99);
    assert_eq!(fs::read(&preview_path).unwrap(), source_bytes);
    assert_eq!(session.canonical_dump().unwrap(), canonical_before);

    cleanup_library_cache(&preview_path, &session.opened().library_id);
    cleanup_library_cache(&grid_path, &session.opened().library_id);
    session.close().unwrap();
}

#[test]
fn jpeg_webp_and_exif_orientation_produce_bounded_png_grids() {
    let (project, mut session) = Project::new();
    write_still(
        &project.root.join("photo.jpg"),
        80,
        40,
        21,
        ImageFormat::Jpeg,
    );
    write_still(
        &project.root.join("graphic.webp"),
        72,
        36,
        22,
        ImageFormat::WebP,
    );
    let oriented = project.root.join("oriented.jpg");
    write_still(&oriented, 80, 40, 23, ImageFormat::Jpeg);
    inject_exif_orientation(&oriented, 6);
    let root_id = session.query_roots().unwrap()[0].root_id.clone();
    let (sender, _receiver) = mpsc::channel();
    scan_root(
        session.rescan_root(&root_id).unwrap(),
        Arc::new(AtomicBool::new(false)),
        sender,
    );

    let assets = session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items;
    for name in ["photo.jpg", "graphic.webp", "oriented.jpg"] {
        let asset = assets
            .iter()
            .find(|asset| asset.display_name == name)
            .unwrap();
        let descriptor = session
            .authorize_resource(&asset.asset_id, ResourceProfile::GridStandard)
            .unwrap();
        assert_eq!(descriptor.mime_type, "image/png");
        let dimensions = imagesize::size(&descriptor.native_path_for_handler).unwrap();
        assert!(dimensions.width <= 512 && dimensions.height <= 512);
        if name == "oriented.jpg" {
            assert!(
                dimensions.height > dimensions.width,
                "EXIF orientation 6 must rotate the landscape source"
            );
        }
        cleanup_library_cache(
            Path::new(&descriptor.native_path_for_handler),
            &session.opened().library_id,
        );
    }
    session.close().unwrap();
}

#[test]
fn cache_reuses_across_reopen_repairs_corruption_and_rekeys_after_revision() {
    let (project, mut session) = Project::new();
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let first = session
        .authorize_resource(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    let first_path = PathBuf::from(&first.native_path_for_handler);
    let first_bytes = fs::read(&first_path).unwrap();
    let root_id = session.query_roots().unwrap()[0].root_id.clone();
    session.close().unwrap();

    let mut reopened = LibrarySession::open(&project.library).unwrap();
    assert!(matches!(
        reopened.authorize_resource(&asset.asset_id, ResourceProfile::GridStandard),
        Err(CoreError::RootPermissionRequired)
    ));
    reopened.reauthorize_root(&root_id, &project.root).unwrap();
    let reused = reopened
        .authorize_resource(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    assert_eq!(PathBuf::from(&reused.native_path_for_handler), first_path);
    let preview = reopened
        .authorize_resource(&asset.asset_id, ResourceProfile::Preview)
        .unwrap();
    let preview_path = PathBuf::from(&preview.native_path_for_handler);
    let source_length = fs::metadata(project.root.join("large.png")).unwrap().len();
    fs::OpenOptions::new()
        .write(true)
        .open(&preview_path)
        .unwrap()
        .set_len(reference_core::rendition::MAX_SOURCE_BYTES + 1)
        .unwrap();
    let repaired_preview = reopened
        .authorize_resource(&asset.asset_id, ResourceProfile::Preview)
        .unwrap();
    assert_eq!(
        fs::metadata(&repaired_preview.native_path_for_handler)
            .unwrap()
            .len(),
        source_length
    );
    fs::write(&first_path, b"corrupt cache").unwrap();
    let repaired = reopened
        .authorize_resource(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    assert_eq!(
        fs::read(&repaired.native_path_for_handler).unwrap(),
        first_bytes
    );
    write_png(&first_path, 512, 256, 88);
    let substituted = fs::read(&first_path).unwrap();
    assert_ne!(substituted, first_bytes);
    let repaired_substitution = reopened
        .authorize_resource(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    assert_eq!(
        fs::read(&repaired_substitution.native_path_for_handler).unwrap(),
        first_bytes
    );
    fs::write(&first_path, &first_bytes[..33]).unwrap();
    let repaired_truncation = reopened
        .authorize_resource(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    assert_eq!(
        fs::read(&repaired_truncation.native_path_for_handler).unwrap(),
        first_bytes
    );

    write_png(&project.root.join("large.png"), 1024, 2048, 33);
    let plan = reopened.rescan_root(&root_id).unwrap();
    let (sender, _receiver) = mpsc::channel();
    scan_root(plan, Arc::new(AtomicBool::new(false)), sender);
    let rekeyed = reopened
        .authorize_resource(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    assert_ne!(PathBuf::from(&rekeyed.native_path_for_handler), first_path);
    cleanup_library_cache(
        Path::new(&rekeyed.native_path_for_handler),
        &reopened.opened().library_id,
    );
    reopened.close().unwrap();
}

#[cfg(unix)]
#[test]
fn changed_or_symlink_swapped_source_fails_closed_without_hiding_asset() {
    use std::os::unix::fs::symlink;
    let (project, mut session) = Project::new();
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    write_png(&project.root.join("large.png"), 2048, 1024, 77);
    assert!(matches!(
        session.authorize_resource(&asset.asset_id, ResourceProfile::Preview),
        Err(CoreError::SourceRevisionChanged)
    ));
    assert_eq!(
        session
            .query_assets(0, 1, AssetProjection::ContactSheetStandard)
            .unwrap()
            .total,
        1
    );

    let outside = project.directory.join("outside.png");
    write_png(&outside, 2048, 1024, 17);
    fs::remove_file(project.root.join("large.png")).unwrap();
    symlink(&outside, project.root.join("large.png")).unwrap();
    assert!(matches!(
        session.authorize_resource(&asset.asset_id, ResourceProfile::Preview),
        Err(CoreError::LocationMissing)
    ));
    assert_eq!(
        session
            .query_assets(0, 1, AssetProjection::ContactSheetStandard)
            .unwrap()
            .total,
        1
    );
    session.close().unwrap();
}

#[test]
fn same_key_cancellation_cannot_remove_a_successful_publication() {
    let (_project, mut session) = Project::new();
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let (_, success_plan) = session
        .start_resource_authorization(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    let (_, cancelled_plan) = session
        .start_resource_authorization(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    let (sender, _receiver) = mpsc::channel();
    let success_sender = sender.clone();
    let success = std::thread::spawn(move || {
        run_job(
            success_plan,
            Arc::new(AtomicBool::new(false)),
            success_sender,
        )
    });
    let cancelled = std::thread::spawn(move || {
        run_job(cancelled_plan, Arc::new(AtomicBool::new(true)), sender)
    });
    let descriptor = success.join().unwrap().unwrap();
    assert!(matches!(
        cancelled.join().unwrap(),
        Err(CoreError::RenditionCancelled)
    ));
    let target = PathBuf::from(&descriptor.native_path_for_handler);
    assert!(imagesize::size(&target).is_ok());
    assert!(!target.parent().unwrap().read_dir().unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
    cleanup_library_cache(&target, &session.opened().library_id);
    session.close().unwrap();
}

#[test]
fn terminal_rendition_job_retention_is_bounded_without_deleting_scan_history() {
    let (_project, mut session) = Project::new();
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let mut resource_path = None;
    for _ in 0..140 {
        let (_, plan) = session
            .start_resource_authorization(&asset.asset_id, ResourceProfile::GridStandard)
            .unwrap();
        let (sender, _receiver) = mpsc::channel();
        let descriptor = run_job(plan, Arc::new(AtomicBool::new(false)), sender).unwrap();
        resource_path = Some(PathBuf::from(descriptor.native_path_for_handler));
    }
    let first = session.query_jobs(0, 100, &JobQuery::default()).unwrap();
    let second = session.query_jobs(100, 100, &JobQuery::default()).unwrap();
    assert_eq!(first.total, 129);
    assert_eq!(first.items.len() + second.items.len(), 129);
    assert!(
        first
            .items
            .iter()
            .chain(second.items.iter())
            .any(|job| job.job_kind == "initial_scan")
    );
    let root = session.query_roots().unwrap().remove(0);
    assert_eq!(root.observed_count, 1);
    assert_eq!(root.unsupported_count, 0);
    assert_eq!(root.active_job_id, None);
    cleanup_library_cache(
        resource_path.as_deref().unwrap(),
        &session.opened().library_id,
    );
    session.close().unwrap();
}

#[test]
fn rendition_persistence_failure_requires_restart_without_false_terminal_event() {
    let (project, mut session) = Project::new();
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let (job_id, plan) = session
        .start_resource_authorization(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    session.close().unwrap();

    let database = project.library.join("library.sqlite");
    let preserved = project.library.join("library.sqlite.preserved");
    fs::rename(&database, &preserved).unwrap();
    fs::create_dir(&database).unwrap();
    let (sender, receiver) = mpsc::channel();
    assert!(run_job(plan, Arc::new(AtomicBool::new(false)), sender).is_err());
    let events = receiver.try_iter().collect::<Vec<_>>();
    assert!(
        events
            .iter()
            .any(|event| matches!(event, Event::CoreNeedsRestart { .. }))
    );
    assert!(!events.iter().any(|event| matches!(
        event,
        Event::JobUpdated { job_id: emitted, state }
            if emitted == &job_id && matches!(state.as_str(), "completed" | "failed" | "cancelled")
    )));

    fs::remove_dir(&database).unwrap();
    fs::rename(&preserved, &database).unwrap();
    let mut reopened = LibrarySession::open(&project.library).unwrap();
    let recovered = reopened
        .query_jobs(
            0,
            10,
            &JobQuery {
                root_id: None,
                states: vec![JobState::Failed],
            },
        )
        .unwrap();
    assert!(
        recovered.items.iter().any(|job| {
            job.job_id == job_id && job.error_code.as_deref() == Some("CoreRestarted")
        })
    );
    reopened.close().unwrap();
}

#[test]
fn tampered_revision_id_cannot_escape_the_private_cache_namespace() {
    let (project, mut session) = Project::new();
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let marker_name = format!("reference-cache-escape-{}", Uuid::new_v4());
    let marker = std::env::temp_dir()
        .join("pitchdog-reference-cache")
        .join(&marker_name);
    assert!(!marker.exists());
    let malicious = format!("../../../{marker_name}");
    let connection = rusqlite::Connection::open(project.library.join("library.sqlite")).unwrap();
    let revision_id: String = connection
        .query_row("SELECT id FROM source_revisions LIMIT 1", [], |row| {
            row.get(0)
        })
        .unwrap();
    connection
        .execute(
            "UPDATE source_revisions SET id=?1 WHERE id=?2",
            [&malicious, &revision_id],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE sources SET current_revision_id=?1 WHERE current_revision_id=?2",
            [&malicious, &revision_id],
        )
        .unwrap();
    assert!(matches!(
        session.authorize_resource(&asset.asset_id, ResourceProfile::GridStandard),
        Err(CoreError::SourceRevisionChanged | CoreError::RenditionCacheUnsafe)
    ));
    assert!(!marker.exists());
    session.close().unwrap();
}

fn write_png(path: &Path, width: u32, height: u32, seed: u8) {
    write_still(path, width, height, seed, ImageFormat::Png);
}

fn write_still(path: &Path, width: u32, height: u32, seed: u8, format: ImageFormat) {
    let image = RgbImage::from_fn(width, height, |x, y| {
        Rgb([seed.wrapping_add(x as u8), seed.wrapping_add(y as u8), seed])
    });
    DynamicImage::ImageRgb8(image)
        .save_with_format(path, format)
        .unwrap();
}

fn inject_exif_orientation(path: &Path, orientation: u16) {
    let original = fs::read(path).unwrap();
    assert_eq!(&original[..2], &[0xff, 0xd8]);
    let mut payload = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
    payload.extend_from_slice(&orientation.to_le_bytes());
    payload.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    let mut with_exif = Vec::with_capacity(original.len() + payload.len() + 4);
    with_exif.extend_from_slice(&original[..2]);
    with_exif.extend_from_slice(&[0xff, 0xe1]);
    with_exif.extend_from_slice(&u16::try_from(payload.len() + 2).unwrap().to_be_bytes());
    with_exif.extend_from_slice(&payload);
    with_exif.extend_from_slice(&original[2..]);
    fs::write(path, with_exif).unwrap();
}

fn cleanup_library_cache(resource: &Path, library_id: &str) {
    let Some(library_cache) = resource.ancestors().nth(3) else {
        return;
    };
    if library_cache.file_name().and_then(|name| name.to_str()) == Some(library_id) {
        let _ = fs::remove_dir_all(library_cache);
    }
}

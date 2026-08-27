use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool, mpsc},
};

use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use reference_core::{discovery::scan_root, error::CoreError, session::LibrarySession};
use reference_protocol::{AssetProjection, ResourceProfile};
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
    fs::write(&first_path, b"corrupt cache").unwrap();
    let repaired = reopened
        .authorize_resource(&asset.asset_id, ResourceProfile::GridStandard)
        .unwrap();
    assert_eq!(
        fs::read(&repaired.native_path_for_handler).unwrap(),
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

fn write_png(path: &Path, width: u32, height: u32, seed: u8) {
    let image = RgbImage::from_fn(width, height, |x, y| {
        Rgb([seed.wrapping_add(x as u8), seed.wrapping_add(y as u8), seed])
    });
    DynamicImage::ImageRgb8(image)
        .save_with_format(path, ImageFormat::Png)
        .unwrap();
}

fn cleanup_library_cache(resource: &Path, library_id: &str) {
    let Some(library_cache) = resource.ancestors().nth(3) else {
        return;
    };
    if library_cache.file_name().and_then(|name| name.to_str()) == Some(library_id) {
        let _ = fs::remove_dir_all(library_cache);
    }
}

#![cfg(unix)]

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool, mpsc},
};

use reference_core::{discovery::scan_root, session::LibrarySession};
use reference_protocol::{AssetProjection, ResourceProfile};
use serde_json::Value;
use uuid::Uuid;

const PNG_HEX: &str = "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f49444154789c63ac903bc1c0c00000069401602d1176ec0000000049454e44ae426082";

#[test]
fn external_rename_preserves_source_location_asset_and_revision_identity() {
    let project = TestProject::new();
    project.write_png("alpha.png");
    let mut session = LibrarySession::create(project.library_path(), "Rename".into()).unwrap();
    scan(&session, project.root_path());

    let before_page = page(&session);
    assert_eq!(before_page.total, 1);
    let before_asset = &before_page.items[0];
    let before_dump = session.canonical_dump().unwrap();
    let source_id = only_id(&before_dump, "sources");
    let revision_id = only_id(&before_dump, "sourceRevisions");
    let origin_id = only_id(&before_dump, "assetOrigins");

    fs::rename(
        project.root_path().join("alpha.png"),
        project.root_path().join("renamed.png"),
    )
    .unwrap();
    scan(&session, project.root_path());

    let after_page = page(&session);
    assert_eq!(after_page.total, 1);
    let after_asset = &after_page.items[0];
    assert_eq!(after_asset.asset_id, before_asset.asset_id);
    assert_eq!(after_asset.location_id, before_asset.location_id);
    assert_eq!(after_asset.display_name, "renamed.png");
    assert_eq!(after_asset.availability, "present");
    let after_dump = session.canonical_dump().unwrap();
    assert_eq!(only_id(&after_dump, "sources"), source_id);
    assert_eq!(only_id(&after_dump, "sourceRevisions"), revision_id);
    assert_eq!(only_id(&after_dump, "assetOrigins"), origin_id);
    assert_eq!(only_id(&after_dump, "locations"), before_asset.location_id);

    let resource = session
        .authorize_resource(&after_asset.asset_id, ResourceProfile::Preview)
        .unwrap();
    assert!(resource.native_path_for_handler.ends_with("renamed.png"));
    let revealed = session.resolve_location(&after_asset.location_id).unwrap();
    assert!(revealed.native_path_for_shell.ends_with("renamed.png"));

    session.close().unwrap();
    let mut reopened = LibrarySession::open(project.library_path()).unwrap();
    let reopened_asset = page(&reopened).items.remove(0);
    assert_eq!(reopened_asset.asset_id, before_asset.asset_id);
    assert_eq!(reopened_asset.location_id, before_asset.location_id);
    assert_eq!(reopened_asset.display_name, "renamed.png");
    reopened.close().unwrap();
}

#[test]
fn identical_delete_and_copy_does_not_manufacture_identity() {
    let project = TestProject::new();
    project.write_png("alpha.png");
    let mut session = LibrarySession::create(project.library_path(), "Copy".into()).unwrap();
    scan(&session, project.root_path());
    let original = page(&session).items.remove(0);

    fs::copy(
        project.root_path().join("alpha.png"),
        project.root_path().join("copied.png"),
    )
    .unwrap();
    fs::remove_file(project.root_path().join("alpha.png")).unwrap();
    scan(&session, project.root_path());

    let after = page(&session);
    assert_eq!(after.total, 2);
    let missing = after
        .items
        .iter()
        .find(|asset| asset.asset_id == original.asset_id)
        .unwrap();
    let observed_copy = after
        .items
        .iter()
        .find(|asset| asset.asset_id != original.asset_id)
        .unwrap();
    assert_eq!(missing.location_id, original.location_id);
    assert_eq!(missing.display_name, "alpha.png");
    assert_eq!(missing.availability, "missing");
    assert_eq!(observed_copy.display_name, "copied.png");
    assert_eq!(observed_copy.availability, "present");

    let dump = session.canonical_dump().unwrap();
    let fingerprints = dump["sourceRevisions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|revision| revision["quickFingerprint"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(fingerprints.len(), 2);
    assert_eq!(fingerprints[0], fingerprints[1]);
    session.close().unwrap();
}

#[test]
fn restored_original_path_reactivates_the_same_source_and_asset() {
    let project = TestProject::new();
    project.write_png("alpha.png");
    let mut session = LibrarySession::create(project.library_path(), "Restore".into()).unwrap();
    scan(&session, project.root_path());
    let original = page(&session).items.remove(0);
    let original_source_id = only_id(&session.canonical_dump().unwrap(), "sources").to_owned();

    fs::remove_file(project.root_path().join("alpha.png")).unwrap();
    scan(&session, project.root_path());
    assert_eq!(page(&session).items[0].availability, "missing");
    assert_eq!(
        session.canonical_dump().unwrap()["sources"][0]["lineageState"],
        "missing"
    );

    project.write_png("alpha.png");
    scan(&session, project.root_path());
    let restored = page(&session).items.remove(0);
    assert_eq!(restored.asset_id, original.asset_id);
    assert_eq!(restored.location_id, original.location_id);
    assert_eq!(restored.availability, "present");
    let restored_dump = session.canonical_dump().unwrap();
    assert_eq!(only_id(&restored_dump, "sources"), original_source_id);
    assert_eq!(restored_dump["sources"][0]["lineageState"], "active");
    session.close().unwrap();
}

fn scan(session: &LibrarySession, root: PathBuf) {
    let plan = session.add_root(root, "Source Root".into()).unwrap();
    let (sender, _receiver) = mpsc::channel();
    scan_root(plan, Arc::new(AtomicBool::new(false)), sender);
}

fn page(session: &LibrarySession) -> reference_protocol::AssetPage {
    session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap()
}

fn only_id<'a>(dump: &'a Value, collection: &str) -> &'a str {
    let rows = dump[collection].as_array().unwrap();
    assert_eq!(rows.len(), 1, "expected one {collection} row");
    rows[0]["id"].as_str().unwrap()
}

struct TestProject {
    directory: PathBuf,
}

impl TestProject {
    fn new() -> Self {
        let directory =
            std::env::temp_dir().join(format!("pitchdog-reference-t02-{}", Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        Self { directory }
    }

    fn library_path(&self) -> PathBuf {
        self.directory.join("Project.pitchlibrary")
    }

    fn root_path(&self) -> PathBuf {
        self.directory.join("Source Root")
    }

    fn write_png(&self, name: &str) {
        fs::create_dir_all(self.root_path()).unwrap();
        fs::write(self.root_path().join(name), decode_hex(PNG_HEX)).unwrap();
    }
}

impl Drop for TestProject {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn decode_hex(value: &str) -> Vec<u8> {
    let (pairs, remainder) = value.as_bytes().as_chunks::<2>();
    assert!(remainder.is_empty());
    pairs
        .iter()
        .map(|pair| {
            let high = (pair[0] as char).to_digit(16).unwrap();
            let low = (pair[1] as char).to_digit(16).unwrap();
            ((high << 4) | low) as u8
        })
        .collect()
}

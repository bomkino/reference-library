use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool, mpsc},
};

use reference_core::{
    discovery::scan_root, error::CoreError, manifest::Manifest, schema, session::LibrarySession,
};
use reference_protocol::{AssetProjection, ResourceProfile};
use rusqlite::params;
use uuid::Uuid;

const PNG_HEX: &str = "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f49444154789c63ac903bc1c0c00000069401602d1176ec0000000049454e44ae426082";
const JPEG_HEX: &str = "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232ffc00011080001000203012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00e2e8a28afbe3dc3fffd9";
const WEBP_HEX: &str = "524946463c000000574542505650382030000000f001009d012a0200010001402625a00274ba01f80004830000fef2eb7ffd958fa563e958fde0bff81f974e1880000000";

struct TestProject {
    directory: PathBuf,
}

impl TestProject {
    fn new() -> Self {
        let directory =
            std::env::temp_dir().join(format!("pitchdog-reference-t01-{}", Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        Self { directory }
    }

    fn library_path(&self) -> PathBuf {
        self.directory.join("Project.pitchlibrary")
    }

    fn root_path(&self) -> PathBuf {
        self.directory.join("Source Root")
    }

    fn write_common_stills(&self) {
        let root = self.root_path();
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("alpha.png"), decode_hex(PNG_HEX)).unwrap();
        fs::write(root.join("nested/bravo.jpg"), decode_hex(JPEG_HEX)).unwrap();
        fs::write(root.join("charlie.webp"), decode_hex(WEBP_HEX)).unwrap();
        fs::write(root.join("ignored.txt"), b"not media").unwrap();
    }
}

impl Drop for TestProject {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn package_lock_manifest_and_reopen_are_publicly_safe() {
    let project = TestProject::new();
    let mut first =
        LibrarySession::create(project.library_path(), "Project Reference".into()).unwrap();
    assert!(project.library_path().join("manifest.json").is_file());
    assert!(project.library_path().join("library.sqlite").is_file());
    assert!(project.library_path().join("embedded").is_dir());
    assert!(matches!(
        LibrarySession::open(project.library_path()),
        Err(CoreError::LibraryLockedByOtherWriter)
    ));
    first.close().unwrap();
    let mut reopened = LibrarySession::open(project.library_path()).unwrap();
    assert_eq!(reopened.opened().name, "Project Reference");
    reopened.close().unwrap();

    let manifest_path = project.library_path().join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["schemaVersion"] = 999.into();
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    assert!(matches!(
        LibrarySession::open(project.library_path()),
        Err(CoreError::SchemaUnsupported {
            actual: 999,
            supported: 1
        })
    ));
}

#[test]
fn stills_progress_page_preview_reveal_missing_and_round_trip() {
    let project = TestProject::new();
    project.write_common_stills();
    let mut session = LibrarySession::create(project.library_path(), "Project".into()).unwrap();
    let plan = session
        .add_root(project.root_path(), "Source Root".into())
        .unwrap();
    let (_event_sender, event_receiver) = mpsc::channel();
    let sender = _event_sender;
    scan_root(plan, Arc::new(AtomicBool::new(false)), sender);
    let events = event_receiver.try_iter().collect::<Vec<_>>();
    assert!(events.iter().any(|event| matches!(
        event,
        reference_protocol::Event::AssetsInserted { asset_ids, .. } if !asset_ids.is_empty()
    )));

    let first_page = session
        .query_assets(0, 2, AssetProjection::ContactSheetStandard)
        .unwrap();
    assert_eq!(first_page.total, 3);
    assert_eq!(first_page.items.len(), 2);
    assert_eq!(first_page.next_offset, Some(2));
    let second_page = session
        .query_assets(2, 2, AssetProjection::ContactSheetStandard)
        .unwrap();
    assert_eq!(second_page.items.len(), 1);
    assert_eq!(second_page.next_offset, None);
    let all_ids = first_page
        .items
        .iter()
        .chain(&second_page.items)
        .map(|item| item.asset_id.clone())
        .collect::<Vec<_>>();
    let selected = &first_page.items[0];
    let resource = session
        .authorize_resource(&selected.asset_id, ResourceProfile::Preview)
        .unwrap();
    assert_eq!(resource.asset_id, selected.asset_id);
    assert!(!resource.resource_token.contains('/'));
    assert!(Path::new(&resource.native_path_for_handler).is_file());
    let revealed = session.resolve_location(&selected.location_id).unwrap();
    assert!(Path::new(&revealed.native_path_for_shell).is_file());
    assert!(matches!(
        session.authorize_resource("../../secret", ResourceProfile::Preview),
        Err(CoreError::RawPathResourceDenied)
    ));

    let before = session.canonical_dump().unwrap();
    session.close().unwrap();
    assert!(matches!(
        session.authorize_resource(&selected.asset_id, ResourceProfile::Preview),
        Err(CoreError::SessionClosed)
    ));
    let mut reopened = LibrarySession::open(project.library_path()).unwrap();
    let reopened_page = reopened
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap();
    assert_eq!(
        reopened_page
            .items
            .iter()
            .map(|item| item.asset_id.clone())
            .collect::<Vec<_>>(),
        all_ids
    );
    assert_eq!(reopened.canonical_dump().unwrap(), before);

    fs::remove_file(project.root_path().join("alpha.png")).unwrap();
    let rescan = reopened
        .add_root(project.root_path(), "Source Root".into())
        .unwrap();
    let (sender, _receiver) = mpsc::channel();
    scan_root(rescan, Arc::new(AtomicBool::new(false)), sender);
    let after_missing = reopened
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap();
    assert_eq!(after_missing.total, 3);
    assert_eq!(
        after_missing
            .items
            .iter()
            .filter(|item| item.availability == "missing")
            .count(),
        1
    );
    reopened.close().unwrap();
}

#[test]
fn hundred_thousand_asset_fixture_stays_windowed() {
    let project = TestProject::new();
    let mut session = LibrarySession::create(project.library_path(), "Scale".into()).unwrap();
    seed_assets(project.library_path(), 100_000);
    let page = session
        .query_assets(99_950, 100, AssetProjection::ContactSheetStandard)
        .unwrap();
    assert_eq!(page.total, 100_000);
    assert_eq!(page.items.len(), 50);
    assert_eq!(page.next_offset, None);
    assert!(serde_json::to_vec(&page).unwrap().len() < 64 * 1024);
    assert!(matches!(
        session.query_assets(0, 251, AssetProjection::ContactSheetStandard),
        Err(CoreError::QueryPageTooLarge(251))
    ));
    session.close().unwrap();
}

fn seed_assets(library_path: PathBuf, count: u128) {
    let manifest = Manifest::read(&library_path).unwrap();
    let mut connection =
        schema::open_database(&library_path.join("library.sqlite"), &manifest).unwrap();
    let transaction = connection.transaction().unwrap();
    let root_id = Uuid::from_u128(1).to_string();
    transaction
        .execute(
            "INSERT INTO roots (
                id, library_id, display_name, root_kind, state,
                scan_policy_json, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'Scale Root', 'linked', 'ready', '{}', 0, 0)",
            params![root_id, manifest.library_id],
        )
        .unwrap();
    for index in 0..count {
        let source_id = Uuid::from_u128(10_000_000 + index).to_string();
        let location_id = Uuid::from_u128(20_000_000 + index).to_string();
        let asset_id = Uuid::from_u128(30_000_000 + index).to_string();
        let origin_id = Uuid::from_u128(40_000_000 + index).to_string();
        let relative = format!("asset-{index:06}.png");
        transaction
            .execute(
                "INSERT INTO sources (
                    id, library_id, media_family, lineage_state, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'still', 'active', ?3, ?3)",
                params![source_id, manifest.library_id, index as i64],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO locations (
                    id, root_id, source_id, relative_path_bytes, relative_path_display,
                    state, last_stat_size, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'present', 72, ?6, ?6)",
                params![
                    location_id,
                    root_id,
                    source_id,
                    relative.as_bytes(),
                    relative,
                    index as i64
                ],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO assets (
                    id, library_id, review_state, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'unreviewed', ?3, ?3)",
                params![asset_id, manifest.library_id, index as i64],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO asset_origins (
                    id, asset_id, source_id, origin_kind, origin_spec_json,
                    revision_binding, created_at_ms
                 ) VALUES (?1, ?2, ?3, 'whole', '{\"kind\":\"whole\"}', 'latest', ?4)",
                params![origin_id, asset_id, source_id, index as i64],
            )
            .unwrap();
    }
    transaction.commit().unwrap();
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

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool, mpsc},
};

use reference_core::{discovery::scan_root, error::CoreError, session::LibrarySession};
use reference_protocol::{
    AssetProjection, MAX_COLLECTION_MEMBERSHIP_BATCH, MAX_COLLECTION_NAME_CHARS, MAX_NOTE_CHARS,
    MAX_TITLE_CHARS, ReviewState,
};
use uuid::Uuid;

const PNG_HEX: &str = "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f49444154789c63ac903bc1c0c00000069401602d1176ec0000000049454e44ae426082";

struct Project {
    directory: PathBuf,
    root: PathBuf,
    library: PathBuf,
}

impl Project {
    fn new() -> (Self, LibrarySession) {
        let directory = std::env::temp_dir().join(format!(
            "reference-v1-editorial-validation-{}",
            Uuid::new_v4()
        ));
        let root = directory.join("Root");
        let library = directory.join("Project.pitchlibrary");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("alpha.png"), decode_hex(PNG_HEX)).unwrap();
        let session = LibrarySession::create(&library, "Editorial validation".into()).unwrap();
        run_scan(session.add_root(&root, "Root".into()).unwrap());
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
fn curation_survives_rescan_external_rename_missing_reconnect_and_restore() {
    let (project, mut session) = Project::new();
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let root_id = session.query_roots().unwrap()[0].root_id.clone();

    session
        .update_asset_title(&asset.asset_id, 0, Some("Hero still"))
        .unwrap();
    session
        .update_asset_note(&asset.asset_id, 1, Some("Durable editorial note"))
        .unwrap();
    session
        .update_asset_review(&asset.asset_id, 2, ReviewState::Keep)
        .unwrap();
    assert_curated_asset(
        &session,
        &asset.asset_id,
        &asset.location_id,
        "alpha.png",
        "present",
    );

    run_scan(session.rescan_root(&root_id).unwrap());
    assert_curated_asset(
        &session,
        &asset.asset_id,
        &asset.location_id,
        "alpha.png",
        "present",
    );

    fs::rename(
        project.root.join("alpha.png"),
        project.root.join("renamed.png"),
    )
    .unwrap();
    run_scan(session.rescan_root(&root_id).unwrap());
    assert_curated_asset(
        &session,
        &asset.asset_id,
        &asset.location_id,
        "renamed.png",
        "present",
    );

    fs::remove_file(project.root.join("renamed.png")).unwrap();
    run_scan(session.rescan_root(&root_id).unwrap());
    assert_curated_asset(
        &session,
        &asset.asset_id,
        &asset.location_id,
        "renamed.png",
        "missing",
    );
    session.close().unwrap();

    let reconnected_root = project.directory.join("Reconnected Root");
    fs::rename(&project.root, &reconnected_root).unwrap();
    let mut reopened = LibrarySession::open(&project.library).unwrap();
    let before_reconnect = reopened.get_asset(&asset.asset_id).unwrap();
    assert_eq!(before_reconnect.availability, "needs_permission");
    assert_eq!(before_reconnect.custom_title.as_deref(), Some("Hero still"));
    assert_eq!(
        before_reconnect.note.as_deref(),
        Some("Durable editorial note")
    );
    assert_eq!(before_reconnect.review_state, "keep");

    let root = reopened
        .reauthorize_root(&root_id, &reconnected_root)
        .unwrap();
    assert_eq!(root.root_id, root_id);
    assert_curated_asset(
        &reopened,
        &asset.asset_id,
        &asset.location_id,
        "renamed.png",
        "missing",
    );

    fs::write(reconnected_root.join("renamed.png"), decode_hex(PNG_HEX)).unwrap();
    run_scan(reopened.rescan_root(&root_id).unwrap());
    assert_curated_asset(
        &reopened,
        &asset.asset_id,
        &asset.location_id,
        "renamed.png",
        "present",
    );
    reopened.close().unwrap();
}

#[test]
fn curation_rejects_oversized_text_and_unknown_assets_without_partial_writes() {
    let (project, mut session) = Project::new();
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let oversized_title = "🦀".repeat(MAX_TITLE_CHARS + 1);
    let oversized_note = "🧭".repeat(MAX_NOTE_CHARS + 1);

    for result in [
        session.update_asset_title(&asset.asset_id, 0, Some(&oversized_title)),
        session.update_asset_note(&asset.asset_id, 0, Some(&oversized_note)),
    ] {
        let error = result.unwrap_err();
        assert!(matches!(error, CoreError::QueryInvalid(_)));
        let public = error.to_protocol_error();
        assert_eq!(public.code, "QueryInvalid");
        assert!(!public.retryable);
        assert!(
            !public
                .message
                .contains(&project.directory.to_string_lossy()[..])
        );
    }
    let unchanged = session.get_asset(&asset.asset_id).unwrap();
    assert_eq!(unchanged.revision, 0);
    assert_eq!(unchanged.custom_title, None);
    assert_eq!(unchanged.note, None);

    let unknown = Uuid::new_v4().to_string();
    let error = session
        .update_asset_review(&unknown, 0, ReviewState::Reject)
        .unwrap_err();
    assert!(matches!(error, CoreError::AssetNotFound));
    let public = error.to_protocol_error();
    assert_eq!(public.code, "AssetNotFound");
    assert!(!public.retryable);
    assert!(
        !public
            .message
            .contains(&project.directory.to_string_lossy()[..])
    );
    session.close().unwrap();
}

#[test]
fn collection_names_and_membership_batches_reject_every_invalid_shape_atomically() {
    let (_project, mut session) = Project::new();
    let asset_id = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0)
        .asset_id;

    for invalid in [
        "".to_owned(),
        " \t\n ".to_owned(),
        "Contains\0Nul".to_owned(),
        "🦀".repeat(MAX_COLLECTION_NAME_CHARS + 1),
    ] {
        assert!(matches!(
            session.create_collection(&invalid),
            Err(CoreError::CollectionMembershipInvalid(_))
        ));
    }
    assert!(session.list_collections().unwrap().is_empty());

    let picks = session.create_collection("Picks").unwrap().0;
    assert!(matches!(
        session.create_collection("  picks  "),
        Err(CoreError::CollectionNameConflict)
    ));
    let other = session.create_collection("Other").unwrap().0;
    assert!(matches!(
        session.rename_collection(&other.collection_id, 0, " PICKS "),
        Err(CoreError::CollectionNameConflict)
    ));
    assert_eq!(
        session
            .list_collections()
            .unwrap()
            .into_iter()
            .find(|item| item.collection_id == other.collection_id)
            .unwrap()
            .name,
        "Other"
    );

    assert!(matches!(
        session.add_assets_to_collection(&picks.collection_id, &[]),
        Err(CoreError::CollectionMembershipInvalid(_))
    ));
    assert!(matches!(
        session
            .add_assets_to_collection(&picks.collection_id, &[asset_id.clone(), asset_id.clone()],),
        Err(CoreError::CollectionMembershipInvalid(_))
    ));
    let oversized = (0..=MAX_COLLECTION_MEMBERSHIP_BATCH)
        .map(|_| Uuid::new_v4().to_string())
        .collect::<Vec<_>>();
    assert!(matches!(
        session.add_assets_to_collection(&picks.collection_id, &oversized),
        Err(CoreError::CollectionMembershipInvalid(_))
    ));
    assert!(
        session
            .list_collections()
            .unwrap()
            .iter()
            .all(|collection| collection.asset_count == 0)
    );
    session.close().unwrap();
}

fn run_scan(plan: reference_core::discovery::ScanPlan) {
    let (sender, _receiver) = mpsc::channel();
    scan_root(plan, Arc::new(AtomicBool::new(false)), sender);
}

fn assert_curated_asset(
    session: &LibrarySession,
    asset_id: &str,
    location_id: &str,
    display_name: &str,
    availability: &str,
) {
    let detail = session.get_asset(asset_id).unwrap();
    assert_eq!(detail.asset_id, asset_id);
    assert_eq!(detail.location_id, location_id);
    assert_eq!(detail.original_display_name, display_name);
    assert_eq!(detail.availability, availability);
    assert_eq!(detail.custom_title.as_deref(), Some("Hero still"));
    assert_eq!(detail.note.as_deref(), Some("Durable editorial note"));
    assert_eq!(detail.review_state, "keep");
    assert_eq!(detail.revision, 3);
}

fn decode_hex(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| {
            let text = std::str::from_utf8(pair).unwrap();
            u8::from_str_radix(text, 16).unwrap()
        })
        .collect()
}

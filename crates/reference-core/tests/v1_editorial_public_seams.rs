use std::{
    fs,
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool, mpsc},
};

use reference_core::{discovery::scan_root, error::CoreError, session::LibrarySession};
use reference_protocol::{
    AssetPage, AssetPatch, AssetProjection, AssetQuery, AssetSort, AvailabilityFilter,
    MAX_COLLECTION_MEMBERSHIP_BATCH, MAX_FRAME_BYTES, MAX_NOTE_CHARS, ReviewState, TextPatch,
};
use uuid::Uuid;

const PNG_HEX: &str = "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f49444154789c63ac903bc1c0c00000069401602d1176ec0000000049454e44ae426082";

struct Project {
    directory: PathBuf,
    root: PathBuf,
    library: PathBuf,
}

impl Project {
    fn new(names: &[&str]) -> (Self, LibrarySession) {
        let directory =
            std::env::temp_dir().join(format!("reference-v1-editorial-{}", Uuid::new_v4()));
        let root = directory.join("Root");
        let library = directory.join("Project.pitchlibrary");
        fs::create_dir_all(&root).unwrap();
        let png = decode_hex(PNG_HEX);
        for name in names {
            fs::write(root.join(name), &png).unwrap();
        }
        let session = LibrarySession::create(&library, "Editorial".into()).unwrap();
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
        let _ = (&self.root, &self.library);
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn named_curation_is_durable_optimistic_and_normalizes_text_consistently() {
    let (project, mut session) = Project::new(&["alpha.png"]);
    let asset = session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);

    let (detail, _) = session
        .update_asset_title(&asset.asset_id, 0, Some("  Hero still  "))
        .unwrap();
    assert_eq!(detail.custom_title.as_deref(), Some("Hero still"));
    assert_eq!(detail.revision, 1);
    let (detail, _) = session
        .update_asset_note(&asset.asset_id, 1, Some("  intentional note spacing  "))
        .unwrap();
    assert_eq!(detail.note.as_deref(), Some("  intentional note spacing  "));
    let (detail, _) = session
        .update_asset_review(&asset.asset_id, 2, ReviewState::Keep)
        .unwrap();
    assert_eq!(detail.review_state, "keep");
    assert!(matches!(
        session.update_asset_note(&asset.asset_id, 2, Some("stale")),
        Err(CoreError::AssetRevisionConflict {
            expected: 2,
            actual: 3
        })
    ));
    assert_eq!(
        session.get_asset(&asset.asset_id).unwrap().note.as_deref(),
        Some("  intentional note spacing  ")
    );

    let (detail, _) = session
        .update_asset(
            &asset.asset_id,
            3,
            AssetPatch {
                custom_title: TextPatch::Set(" \t\n ".into()),
                review_state: None,
                note: TextPatch::Set(" \n ".into()),
            },
        )
        .unwrap();
    assert_eq!(detail.custom_title, None);
    assert_eq!(detail.note, None);
    assert_eq!(detail.relative_display_path, "alpha.png");
    session.close().unwrap();

    let mut reopened = LibrarySession::open(&project.library).unwrap();
    let detail = reopened.get_asset(&asset.asset_id).unwrap();
    assert_eq!(detail.review_state, "keep");
    assert_eq!(detail.custom_title, None);
    assert_eq!(detail.note, None);
    reopened.close().unwrap();
}

#[test]
fn lexical_query_keeps_unicode_codepoints_and_ascii_case_fold_deterministic() {
    let (_project, mut session) = Project::new(&["alpha.png", "bravo.png", "charlie.png"]);
    let page = session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap();
    let alpha = page
        .items
        .iter()
        .find(|item| item.display_name == "alpha.png")
        .unwrap();
    let bravo = page
        .items
        .iter()
        .find(|item| item.display_name == "bravo.png")
        .unwrap();
    let charlie = page
        .items
        .iter()
        .find(|item| item.display_name == "charlie.png")
        .unwrap();
    session
        .update_asset_title(&alpha.asset_id, 0, Some("İstanbul Café 😀"))
        .unwrap();
    session
        .update_asset_title(&bravo.asset_id, 0, Some("Cafe\u{301} 東京 Привет"))
        .unwrap();
    session
        .update_asset_note(&charlie.asset_id, 0, Some("Καλημέρα 🧭"))
        .unwrap();

    for (search, expected) in [
        ("İstanbul", alpha.asset_id.as_str()),
        ("Café", alpha.asset_id.as_str()),
        ("Cafe\u{301}", bravo.asset_id.as_str()),
        ("東京", bravo.asset_id.as_str()),
        ("Привет", bravo.asset_id.as_str()),
        ("😀", alpha.asset_id.as_str()),
        ("🧭", charlie.asset_id.as_str()),
        ("CAFé", alpha.asset_id.as_str()),
    ] {
        let result = session
            .query_asset_index(
                0,
                10,
                AssetProjection::ContactSheetStandard,
                &AssetQuery {
                    search: Some(search.into()),
                    ..AssetQuery::default()
                },
            )
            .unwrap();
        assert_eq!(result.items.len(), 1, "search {search:?}");
        assert_eq!(result.items[0].asset_id, expected, "search {search:?}");
    }
    let lowercase_cyrillic = session
        .query_asset_index(
            0,
            10,
            AssetProjection::ContactSheetStandard,
            &AssetQuery {
                search: Some("привет".into()),
                ..AssetQuery::default()
            },
        )
        .unwrap();
    assert_eq!(lowercase_cyrillic.total, 0);
    session.close().unwrap();
}

#[test]
fn typed_filters_compose_and_each_asset_is_projected_once() {
    let (_project, mut session) = Project::new(&["alpha.png", "bravo.png"]);
    let page = session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap();
    let alpha = page
        .items
        .iter()
        .find(|item| item.display_name == "alpha.png")
        .unwrap();
    session
        .update_asset_review(&alpha.asset_id, 0, ReviewState::Maybe)
        .unwrap();
    let collection = session.create_collection("Candidates").unwrap().0;
    session
        .add_assets_to_collection(
            &collection.collection_id,
            std::slice::from_ref(&alpha.asset_id),
        )
        .unwrap();
    let result = session
        .query_asset_index(
            0,
            10,
            AssetProjection::ContactSheetDetailed,
            &AssetQuery {
                search: Some("alpha".into()),
                review_states: vec![ReviewState::Maybe],
                availability: vec![AvailabilityFilter::Present],
                collection_id: Some(collection.collection_id),
                root_id: None,
                sort: AssetSort::NameDescending,
            },
        )
        .unwrap();
    assert_eq!(result.total, 1);
    assert_eq!(result.items[0].asset_id, alpha.asset_id);
    session.close().unwrap();
}

#[test]
fn flat_collections_are_atomic_bounded_and_optimistically_renamed() {
    let (_project, mut session) = Project::new(&["alpha.png", "bravo.png"]);
    let assets = session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items;
    let collection = session.create_collection("  Picks  ").unwrap().0;
    assert_eq!(collection.name, "Picks");
    assert_eq!(collection.revision, 0);
    let renamed = session
        .rename_collection(&collection.collection_id, 0, "Final Picks")
        .unwrap()
        .0;
    assert_eq!(renamed.revision, 1);
    assert!(matches!(
        session.rename_collection(&collection.collection_id, 0, "Stale"),
        Err(CoreError::CollectionRevisionConflict {
            expected: 0,
            actual: 1
        })
    ));

    let ids = assets
        .iter()
        .map(|item| item.asset_id.clone())
        .collect::<Vec<_>>();
    assert_eq!(
        session
            .add_assets_to_collection(&collection.collection_id, &ids)
            .unwrap()
            .0,
        2
    );
    let listed = session.list_collections().unwrap();
    assert_eq!(listed[0].asset_count, 2);
    assert_eq!(listed[0].revision, 2);
    assert_eq!(
        session.get_asset(&ids[0]).unwrap().collection_ids,
        vec![collection.collection_id.clone()]
    );

    let missing = Uuid::new_v4().to_string();
    assert!(matches!(
        session.add_assets_to_collection(&collection.collection_id, &[ids[0].clone(), missing]),
        Err(CoreError::CollectionMembershipInvalid(_))
    ));
    assert_eq!(session.list_collections().unwrap()[0].asset_count, 2);
    let too_many = (0..=MAX_COLLECTION_MEMBERSHIP_BATCH)
        .map(|_| Uuid::new_v4().to_string())
        .collect::<Vec<_>>();
    assert!(matches!(
        session.add_assets_to_collection(&collection.collection_id, &too_many),
        Err(CoreError::CollectionMembershipInvalid(_))
    ));
    session.close().unwrap();
}

#[test]
fn maximum_note_never_inflates_the_maximum_contact_sheet_page_frame() {
    let (_project, mut session) = Project::new(&["alpha.png"]);
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let note = "n".repeat(MAX_NOTE_CHARS);
    let detail = session
        .update_asset_note(&asset.asset_id, 0, Some(&note))
        .unwrap()
        .0;
    assert_eq!(detail.note.as_deref(), Some(note.as_str()));
    let summary = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let page = AssetPage {
        offset: 0,
        limit: 250,
        total: 250,
        items: vec![summary; 250],
        next_offset: None,
        library_revision: 1,
    };
    let bytes = serde_json::to_vec(&page).unwrap();
    assert!(bytes.len() < MAX_FRAME_BYTES);
    assert!(!String::from_utf8(bytes).unwrap().contains(&note));
    session.close().unwrap();
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

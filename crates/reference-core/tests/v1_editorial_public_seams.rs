use std::{
    fs,
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool, mpsc},
};

use reference_core::{discovery::scan_root, error::CoreError, session::LibrarySession};
use reference_protocol::{
    AssetPage, AssetPatch, AssetProjection, AssetQuery, AssetSort, AvailabilityFilter,
    CommandResult, MAX_COLLECTION_MEMBERSHIP_BATCH, MAX_FRAME_BYTES, MAX_NOTE_CHARS,
    MAX_REQUEST_ID_BYTES, PROTOCOL_VERSION, ReviewState, ServerFrame, TextPatch,
};
use rusqlite::params;
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
fn lexical_query_treats_like_metacharacters_as_literal_punctuation() {
    let (_project, mut session) = Project::new(&["percent.png", "underscore.png", "backslash.png"]);
    let page = session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap();
    let percent = page
        .items
        .iter()
        .find(|item| item.display_name == "percent.png")
        .unwrap();
    let underscore = page
        .items
        .iter()
        .find(|item| item.display_name == "underscore.png")
        .unwrap();
    let backslash = page
        .items
        .iter()
        .find(|item| item.display_name == "backslash.png")
        .unwrap();
    session
        .update_asset_title(&percent.asset_id, 0, Some("Fifty% frame"))
        .unwrap();
    session
        .update_asset_note(&underscore.asset_id, 0, Some("under_score"))
        .unwrap();
    session
        .update_asset_title(&backslash.asset_id, 0, Some("back\\slash"))
        .unwrap();

    for (search, expected) in [
        ("%", percent.asset_id.as_str()),
        ("_", underscore.asset_id.as_str()),
        ("\\", backslash.asset_id.as_str()),
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
        assert_eq!(result.total, 1, "literal punctuation search {search:?}");
        assert_eq!(
            result.items[0].asset_id, expected,
            "literal punctuation search {search:?}"
        );
    }
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
fn composed_query_filters_and_sort_page_without_duplicates_or_gaps() {
    let names = [
        "needle-01.png",
        "needle-02.png",
        "needle-03.png",
        "needle-04.png",
        "needle-05.png",
        "needle-06.png",
        "needle-wrong-review.png",
        "needle-wrong-collection.png",
        "other.png",
        "needle-missing.png",
    ];
    let (project, mut session) = Project::new(&names);
    let second_root = project.directory.join("Second Root");
    fs::create_dir(&second_root).unwrap();
    fs::write(
        second_root.join("needle-other-root.png"),
        decode_hex(PNG_HEX),
    )
    .unwrap();
    let second_plan = session
        .add_root(&second_root, "Second Root".into())
        .unwrap();
    let (sender, _receiver) = mpsc::channel();
    scan_root(second_plan, Arc::new(AtomicBool::new(false)), sender);

    let original_root_id = session
        .query_roots()
        .unwrap()
        .into_iter()
        .find(|root| root.display_name == "Root")
        .unwrap()
        .root_id;
    let assets = session
        .query_assets(0, 20, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items;
    let by_name = |name: &str| {
        assets
            .iter()
            .find(|asset| asset.display_name == name)
            .unwrap()
            .asset_id
            .clone()
    };
    let qualifying = (1..=6)
        .map(|index| by_name(&format!("needle-{index:02}.png")))
        .collect::<Vec<_>>();
    let wrong_review = by_name("needle-wrong-review.png");
    let wrong_collection = by_name("needle-wrong-collection.png");
    let wrong_search = by_name("other.png");
    let missing = by_name("needle-missing.png");
    let wrong_root = by_name("needle-other-root.png");

    for asset_id in
        qualifying
            .iter()
            .chain([&wrong_collection, &wrong_search, &missing, &wrong_root])
    {
        session
            .update_asset_review(asset_id, 0, ReviewState::Maybe)
            .unwrap();
    }
    let collection = session.create_collection("Needles").unwrap().0;
    let members = qualifying
        .iter()
        .cloned()
        .chain([wrong_review, wrong_search, missing, wrong_root])
        .collect::<Vec<_>>();
    session
        .add_assets_to_collection(&collection.collection_id, &members)
        .unwrap();

    fs::remove_file(project.root.join("needle-missing.png")).unwrap();
    let (sender, _receiver) = mpsc::channel();
    scan_root(
        session.rescan_root(&original_root_id).unwrap(),
        Arc::new(AtomicBool::new(false)),
        sender,
    );

    let query = AssetQuery {
        search: Some("needle".into()),
        review_states: vec![ReviewState::Maybe],
        availability: vec![AvailabilityFilter::Present],
        collection_id: Some(collection.collection_id),
        root_id: Some(original_root_id),
        sort: AssetSort::NameDescending,
    };
    let mut offset = 0;
    let mut snapshot = None;
    let mut observed = Vec::new();
    loop {
        let page = session
            .query_asset_index_at_revision(
                offset,
                2,
                AssetProjection::ContactSheetStandard,
                &query,
                snapshot,
            )
            .unwrap();
        assert_eq!(page.total, 6);
        snapshot = Some(page.library_revision);
        observed.extend(page.items.into_iter().map(|asset| asset.display_name));
        let Some(next) = page.next_offset else { break };
        assert!(next > offset);
        offset = next;
    }

    assert_eq!(
        observed,
        vec![
            "needle-06.png",
            "needle-05.png",
            "needle-04.png",
            "needle-03.png",
            "needle-02.png",
            "needle-01.png",
        ]
    );
    session.close().unwrap();
}

#[test]
fn every_availability_filter_projects_durable_root_and_location_truth() {
    let (project, mut session) = Project::new(&["alpha.png"]);
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    let root_id = session.query_roots().unwrap()[0].root_id.clone();
    let connection = rusqlite::Connection::open(project.library.join("library.sqlite")).unwrap();
    for (root_state, location_state, mime, filter, expected) in [
        (
            "ready",
            "present",
            "image/png",
            AvailabilityFilter::Present,
            "present",
        ),
        (
            "ready",
            "missing",
            "image/png",
            AvailabilityFilter::Missing,
            "missing",
        ),
        (
            "ready",
            "permission_denied",
            "image/png",
            AvailabilityFilter::NeedsPermission,
            "needs_permission",
        ),
        (
            "unavailable",
            "present",
            "image/png",
            AvailabilityFilter::Unavailable,
            "unavailable",
        ),
        (
            "offline_volume",
            "present",
            "image/png",
            AvailabilityFilter::OfflineVolume,
            "offline_volume",
        ),
        (
            "ready",
            "unreadable",
            "image/png",
            AvailabilityFilter::Unreadable,
            "unreadable",
        ),
        (
            "ready",
            "unreadable",
            "image/gif",
            AvailabilityFilter::Unsupported,
            "unsupported",
        ),
    ] {
        connection
            .execute(
                "UPDATE roots SET state=?1 WHERE id=?2",
                params![root_state, root_id],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE source_revisions SET mime_detected=?1 WHERE id=(
                   SELECT current_revision_id FROM sources LIMIT 1
                 )",
                [mime],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE locations SET state=?1 WHERE id=?2",
                params![location_state, asset.location_id],
            )
            .unwrap();
        let page = session
            .query_asset_index(
                0,
                10,
                AssetProjection::ContactSheetStandard,
                &AssetQuery {
                    availability: vec![filter],
                    ..AssetQuery::default()
                },
            )
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].availability, expected);
    }
    let all = session
        .query_asset_index(
            0,
            10,
            AssetProjection::ContactSheetStandard,
            &AssetQuery {
                availability: vec![
                    AvailabilityFilter::Present,
                    AvailabilityFilter::Missing,
                    AvailabilityFilter::NeedsPermission,
                    AvailabilityFilter::Unavailable,
                    AvailabilityFilter::OfflineVolume,
                    AvailabilityFilter::Unreadable,
                    AvailabilityFilter::Unsupported,
                ],
                ..AssetQuery::default()
            },
        )
        .unwrap();
    assert_eq!(all.items.len(), 1);
    session.close().unwrap();
}

#[test]
fn paged_asset_query_rejects_a_mixed_library_generation() {
    let (project, mut session) = Project::new(&["alpha.png", "bravo.png", "charlie.png"]);
    let query = AssetQuery {
        sort: AssetSort::CreatedDescending,
        ..AssetQuery::default()
    };
    let first = session
        .query_asset_index_at_revision(0, 2, AssetProjection::ContactSheetStandard, &query, None)
        .unwrap();
    fs::write(project.root.join("delta.png"), decode_hex(PNG_HEX)).unwrap();
    let root_id = session.query_roots().unwrap()[0].root_id.clone();
    let (sender, _receiver) = mpsc::channel();
    scan_root(
        session.rescan_root(&root_id).unwrap(),
        Arc::new(AtomicBool::new(false)),
        sender,
    );
    assert!(matches!(
        session.query_asset_index_at_revision(
            2,
            2,
            AssetProjection::ContactSheetStandard,
            &query,
            Some(first.library_revision),
        ),
        Err(CoreError::QuerySnapshotChanged { expected, actual })
            if expected == first.library_revision && actual > expected
    ));

    let fresh_first = session
        .query_asset_index_at_revision(0, 2, AssetProjection::ContactSheetStandard, &query, None)
        .unwrap();
    let fresh_second = session
        .query_asset_index_at_revision(
            2,
            2,
            AssetProjection::ContactSheetStandard,
            &query,
            Some(fresh_first.library_revision),
        )
        .unwrap();
    let mut ids = fresh_first
        .items
        .iter()
        .chain(fresh_second.items.iter())
        .map(|asset| asset.asset_id.clone())
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 4);
    session.close().unwrap();
}

#[test]
fn asset_and_job_offsets_reject_values_outside_sqlite_range() {
    let (_project, mut session) = Project::new(&["alpha.png"]);
    for offset in [(i64::MAX as u64) + 1, u64::MAX] {
        assert!(matches!(
            session.query_asset_index(
                offset,
                1,
                AssetProjection::ContactSheetStandard,
                &AssetQuery::default(),
            ),
            Err(CoreError::QueryInvalid(_))
        ));
        assert!(matches!(
            session.query_jobs(offset, 1, &reference_protocol::JobQuery::default()),
            Err(CoreError::QueryInvalid(_))
        ));
    }
    session.close().unwrap();
}

#[test]
fn flat_collections_are_atomic_bounded_and_optimistically_renamed() {
    let (project, mut session) = Project::new(&["alpha.png", "bravo.png"]);
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
    assert_eq!(
        session
            .add_assets_to_collection(&collection.collection_id, &ids)
            .unwrap()
            .0,
        0,
        "repeated add is idempotent"
    );
    assert_eq!(
        session
            .remove_assets_from_collection(
                &collection.collection_id,
                std::slice::from_ref(&ids[1]),
            )
            .unwrap()
            .0,
        1
    );
    assert_eq!(
        session
            .remove_assets_from_collection(
                &collection.collection_id,
                std::slice::from_ref(&ids[1]),
            )
            .unwrap()
            .0,
        0,
        "repeated removal is idempotent"
    );
    let too_many = (0..=MAX_COLLECTION_MEMBERSHIP_BATCH)
        .map(|_| Uuid::new_v4().to_string())
        .collect::<Vec<_>>();
    assert!(matches!(
        session.add_assets_to_collection(&collection.collection_id, &too_many),
        Err(CoreError::CollectionMembershipInvalid(_))
    ));
    let kept = assets
        .iter()
        .find(|asset| asset.asset_id == ids[0])
        .unwrap();
    fs::remove_file(project.root.join(&kept.display_name)).unwrap();
    let root_id = session.query_roots().unwrap()[0].root_id.clone();
    let (sender, _receiver) = mpsc::channel();
    scan_root(
        session.rescan_root(&root_id).unwrap(),
        Arc::new(AtomicBool::new(false)),
        sender,
    );
    let missing = session.get_asset(&ids[0]).unwrap();
    assert_eq!(missing.availability, "missing");
    assert_eq!(
        missing.collection_ids,
        vec![collection.collection_id.clone()]
    );
    session.close().unwrap();

    let mut reopened = LibrarySession::open(&project.library).unwrap();
    assert_eq!(
        reopened.get_asset(&ids[0]).unwrap().collection_ids,
        vec![collection.collection_id.clone()]
    );
    reopened
        .delete_collection(&collection.collection_id)
        .unwrap();
    assert!(
        reopened
            .get_asset(&ids[0])
            .unwrap()
            .collection_ids
            .is_empty()
    );
    assert!(matches!(
        reopened.delete_collection(&collection.collection_id),
        Err(CoreError::CollectionNotFound)
    ));
    reopened.close().unwrap();
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

#[test]
fn worst_case_asset_pages_are_byte_bounded_without_duplicates_or_gaps() {
    let (project, mut session) = Project::new(&["alpha.png"]);
    let connection = rusqlite::Connection::open(project.library.join("library.sqlite")).unwrap();
    let (library_id, source_id): (String, String) = connection
        .query_row(
            "SELECT a.library_id, ao.source_id
             FROM assets a JOIN asset_origins ao ON ao.asset_id=a.id LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let relative = "😀\n".repeat(512);
    let title = "🧭".repeat(500);
    connection
        .execute(
            "UPDATE locations SET relative_path_display=?1",
            params![relative],
        )
        .unwrap();
    connection
        .execute("UPDATE assets SET custom_title=?1", params![title])
        .unwrap();
    for index in 1..250 {
        let asset_id = Uuid::new_v4().to_string();
        connection
            .execute(
                "INSERT INTO assets (
                    id,library_id,custom_title,review_state,created_at_ms,updated_at_ms
                 ) VALUES (?1,?2,?3,'unreviewed',?4,?4)",
                params![asset_id, library_id, title, index],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO asset_origins (
                    id,asset_id,source_id,origin_kind,origin_spec_json,revision_binding,created_at_ms
                 ) VALUES (?1,?2,?3,'whole','{\"kind\":\"whole\"}','latest',?4)",
                params![Uuid::new_v4().to_string(), asset_id, source_id, index],
            )
            .unwrap();
    }
    drop(connection);

    let mut offset = 0;
    let mut observed = Vec::new();
    let mut revision = None;
    loop {
        let page = session
            .query_asset_index_at_revision(
                offset,
                250,
                AssetProjection::ContactSheetDetailed,
                &AssetQuery::default(),
                revision,
            )
            .unwrap();
        revision = Some(page.library_revision);
        let frame = ServerFrame::Response {
            protocol_version: PROTOCOL_VERSION,
            request_id: "r".repeat(MAX_REQUEST_ID_BYTES),
            result: CommandResult::AssetPage(page.clone()),
        };
        assert!(serde_json::to_vec(&frame).unwrap().len() <= MAX_FRAME_BYTES);
        observed.extend(page.items.into_iter().map(|item| item.asset_id));
        let Some(next) = page.next_offset else { break };
        assert!(next > offset);
        offset = next;
    }
    observed.sort();
    observed.dedup();
    assert_eq!(observed.len(), 250);
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

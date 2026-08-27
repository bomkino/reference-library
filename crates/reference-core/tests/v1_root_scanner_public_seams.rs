use std::{
    fs::{self, File, FileTimes},
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, SystemTime},
};

use reference_core::{
    discovery::scan_root, error::CoreError, manifest::Manifest, schema, session::LibrarySession,
};
use reference_protocol::{
    AssetProjection, AssetQuery, AssetSort, Event, JobQuery, JobState, ReviewState,
};
use rusqlite::params;
use uuid::Uuid;

const PNG_HEX: &str = "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f49444154789c63ac903bc1c0c00000069401602d1176ec0000000049454e44ae426082";

struct Project {
    directory: PathBuf,
    library: PathBuf,
}

impl Project {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!("reference-v1-root-{}", Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        Self {
            library: directory.join("Project.pitchlibrary"),
            directory,
        }
    }

    fn root(&self, name: &str) -> PathBuf {
        self.directory.join(name)
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn roots_reopen_unbound_rebind_by_evidence_and_reject_duplicate_scans() {
    let project = Project::new();
    let root = project.root("Original");
    fs::create_dir(&root).unwrap();
    let png = decode_hex(PNG_HEX);
    for index in 0..10 {
        fs::write(root.join(format!("still-{index}.png")), &png).unwrap();
    }
    let mut session = LibrarySession::create(&project.library, "Roots".into()).unwrap();
    let plan = session.add_root(&root, "References".into()).unwrap();
    let root_id = plan.root_id.clone();
    let roots = session.query_roots().unwrap();
    assert!(roots[0].authorized);
    assert_eq!(
        roots[0].active_job_id.as_deref(),
        Some(plan.job_id.as_str())
    );
    run(plan);
    let roots = session.query_roots().unwrap();
    assert_eq!(roots[0].active_job_id, None);
    assert_eq!(roots[0].observed_count, 10);
    session.close().unwrap();

    let wrong = project.root("Wrong");
    fs::create_dir(&wrong).unwrap();
    fs::write(wrong.join("still-0.png"), &png).unwrap();
    fs::write(wrong.join("still-1.png"), &png).unwrap();
    let mut reopened = LibrarySession::open(&project.library).unwrap();
    let reopened_root = reopened.query_roots().unwrap().remove(0);
    assert!(!reopened_root.authorized);
    assert_eq!(reopened_root.state, "needs_permission");
    assert_eq!(
        reopened
            .query_assets(0, 1, AssetProjection::ContactSheetStandard)
            .unwrap()
            .items[0]
            .availability,
        "needs_permission"
    );
    assert!(matches!(
        reopened.rescan_root(&root_id),
        Err(CoreError::RootPermissionRequired)
    ));
    assert!(matches!(
        reopened.reauthorize_root(&root_id, &wrong),
        Err(CoreError::RootIdentityMismatch)
    ));
    let bound = reopened.reauthorize_root(&root_id, &root).unwrap();
    assert!(bound.authorized);
    let rescan = reopened.rescan_root(&root_id).unwrap();
    assert!(matches!(
        reopened.rescan_root(&root_id),
        Err(CoreError::RootScanInProgress)
    ));
    run(rescan);
    reopened.close().unwrap();
}

#[test]
fn moved_absolute_provider_path_rebind_preserves_every_domain_identity() {
    let project = Project::new();
    let original = project.root("Provider A");
    fs::create_dir(&original).unwrap();
    fs::write(original.join("alpha.png"), decode_hex(PNG_HEX)).unwrap();
    fs::write(original.join("bravo.png"), decode_hex(PNG_HEX)).unwrap();
    let mut session = LibrarySession::create(&project.library, "Moved provider".into()).unwrap();
    let plan = session.add_root(&original, "References".into()).unwrap();
    let root_id = plan.root_id.clone();
    run(plan);
    let before = domain_identity_projection(&session.canonical_dump().unwrap());
    session.close().unwrap();

    let moved_parent = project.root("Different Absolute Parent");
    fs::create_dir(&moved_parent).unwrap();
    let moved = moved_parent.join("Provider B");
    fs::rename(&original, &moved).unwrap();
    assert_ne!(original, moved);

    let mut reopened = LibrarySession::open(&project.library).unwrap();
    let bound = reopened.reauthorize_root(&root_id, &moved).unwrap();
    assert_eq!(bound.root_id, root_id);
    run(reopened.rescan_root(&root_id).unwrap());
    let after = domain_identity_projection(&reopened.canonical_dump().unwrap());
    assert_eq!(after, before);
    reopened.close().unwrap();
}

#[test]
fn jobs_are_bounded_filterable_and_recovery_is_terminal() {
    let project = Project::new();
    let root = project.root("Root");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("alpha.png"), decode_hex(PNG_HEX)).unwrap();
    let mut session = LibrarySession::create(&project.library, "Jobs".into()).unwrap();
    let plan = session.add_root(&root, "Root".into()).unwrap();
    let root_id = plan.root_id.clone();
    run(plan);
    let page = session
        .query_jobs(
            0,
            100,
            &JobQuery {
                root_id: Some(root_id.clone()),
                states: vec![JobState::Completed],
            },
        )
        .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].state, JobState::Completed);
    assert!(matches!(
        session.query_jobs(0, 101, &JobQuery::default()),
        Err(CoreError::QueryPageTooLarge(101))
    ));
    let interrupted = session.rescan_root(&root_id).unwrap();
    let interrupted_id = interrupted.job_id;
    session.close().unwrap();
    let mut reopened = LibrarySession::open(&project.library).unwrap();
    let failed = reopened
        .query_jobs(
            0,
            10,
            &JobQuery {
                root_id: Some(root_id),
                states: vec![JobState::Failed],
            },
        )
        .unwrap();
    assert!(failed.items.iter().any(|job| {
        job.job_id == interrupted_id && job.error_code.as_deref() == Some("CoreRestarted")
    }));
    reopened.close().unwrap();
}

#[test]
fn unsupported_and_corrupt_stills_remain_catalogued_with_distinct_truth() {
    let project = Project::new();
    let root = project.root("Root");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("good.png"), decode_hex(PNG_HEX)).unwrap();
    fs::write(root.join("animated.gif"), b"GIF89a unsupported payload").unwrap();
    fs::write(
        root.join("corrupt.png"),
        b"\x89PNG\r\n\x1a\nnot a decodable image",
    )
    .unwrap();
    fs::write(root.join("extension-only.png"), b"not image bytes").unwrap();
    let mut session = LibrarySession::create(&project.library, "Catalogue".into()).unwrap();
    let plan = session.add_root(&root, "Root".into()).unwrap();
    let root_id = plan.root_id.clone();
    run(plan);
    let root_summary = session.query_roots().unwrap().remove(0);
    assert_eq!(root_summary.observed_count, 4);
    assert_eq!(root_summary.unsupported_count, 3);
    let page = session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap();
    assert_eq!(page.total, 4);
    assert_eq!(
        page.items
            .iter()
            .filter(|asset| asset.availability == "unreadable")
            .count(),
        2
    );
    assert_eq!(
        page.items
            .iter()
            .filter(|asset| asset.availability == "unsupported")
            .count(),
        1
    );

    fs::write(root.join("good.png"), b"formerly valid, now corrupt").unwrap();
    run(session.rescan_root(&root_id).unwrap());
    let page = session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap();
    assert_eq!(page.total, 4);
    let formerly_valid = page
        .items
        .iter()
        .find(|asset| asset.display_name == "good.png")
        .unwrap();
    assert_eq!(formerly_valid.availability, "unreadable");
    session.close().unwrap();
}

#[test]
fn full_streaming_evidence_catches_middle_rewrite_but_touch_only_keeps_revision() {
    let project = Project::new();
    let root = project.root("Root");
    fs::create_dir(&root).unwrap();
    let path = root.join("large.png");
    let mut bytes = decode_hex(PNG_HEX);
    bytes.resize(256 * 1024, 0x55);
    fs::write(&path, &bytes).unwrap();
    let mut session = LibrarySession::create(&project.library, "Evidence".into()).unwrap();
    let first = session.add_root(&root, "Root".into()).unwrap();
    let root_id = first.root_id.clone();
    run(first);
    let before = current_revision(&project.library);

    let file = File::options().write(true).open(&path).unwrap();
    file.set_times(FileTimes::new().set_modified(SystemTime::now() + Duration::from_secs(3)))
        .unwrap();
    run(session.rescan_root(&root_id).unwrap());
    assert_eq!(current_revision(&project.library), before);

    let original_modified = fs::metadata(&path).unwrap().modified().unwrap();
    let mut file = File::options().write(true).open(&path).unwrap();
    file.seek(SeekFrom::Start(128 * 1024)).unwrap();
    file.write_all(b"changed-middle-bytes").unwrap();
    file.set_times(FileTimes::new().set_modified(original_modified))
        .unwrap();
    drop(file);
    run(session.rescan_root(&root_id).unwrap());
    assert_ne!(current_revision(&project.library), before);
    session.close().unwrap();
}

#[test]
fn catalogue_only_oversized_sources_detect_bounded_middle_mutations() {
    let project = Project::new();
    let root = project.root("Root");
    fs::create_dir(&root).unwrap();
    let source = root.join("oversized.png");
    fs::write(&source, decode_hex(PNG_HEX)).unwrap();
    let oversized_length = reference_core::rendition::MAX_SOURCE_BYTES + 1;
    let file = fs::OpenOptions::new().write(true).open(&source).unwrap();
    file.set_len(oversized_length).unwrap();
    let original_times =
        FileTimes::new().set_modified(fs::metadata(&source).unwrap().modified().unwrap());
    let mut session = LibrarySession::create(&project.library, "Oversized".into()).unwrap();
    let plan = session.add_root(&root, "Root".into()).unwrap();
    let root_id = plan.root_id.clone();
    run(plan);

    let before = rusqlite::Connection::open(project.library.join("library.sqlite"))
        .unwrap()
        .query_row("SELECT COUNT(*) FROM source_revisions", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap();
    let mut file = fs::OpenOptions::new().write(true).open(&source).unwrap();
    file.seek(SeekFrom::Start(oversized_length / 2)).unwrap();
    file.write_all(b"bounded-middle-change").unwrap();
    file.set_times(original_times).unwrap();
    run(session.rescan_root(&root_id).unwrap());
    let after = rusqlite::Connection::open(project.library.join("library.sqlite"))
        .unwrap()
        .query_row("SELECT COUNT(*) FROM source_revisions", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap();
    assert_eq!(after, before + 1);
    let asset = session
        .query_assets(0, 1, AssetProjection::ContactSheetStandard)
        .unwrap()
        .items
        .remove(0);
    assert_eq!(asset.availability, "unreadable");
    session.close().unwrap();
}

#[test]
fn root_filter_is_applied_before_preferred_location_ranking() {
    let project = Project::new();
    let root = project.root("One");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("alpha.png"), decode_hex(PNG_HEX)).unwrap();
    let mut session = LibrarySession::create(&project.library, "Filter".into()).unwrap();
    let plan = session.add_root(&root, "One".into()).unwrap();
    let root_one = plan.root_id.clone();
    run(plan);
    let (root_two, second_location) = add_second_location(&project.library);
    let connection = rusqlite::Connection::open(project.library.join("library.sqlite")).unwrap();
    connection
        .execute(
            "UPDATE roots SET state='needs_permission' WHERE id=?1",
            params![&root_one],
        )
        .unwrap();
    drop(connection);

    let preferred = session
        .query_asset_index(
            0,
            10,
            AssetProjection::ContactSheetStandard,
            &AssetQuery::default(),
        )
        .unwrap();
    assert_eq!(preferred.items[0].location_id, second_location);
    assert_eq!(preferred.items[0].availability, "present");

    let page = session
        .query_asset_index(
            0,
            10,
            AssetProjection::ContactSheetStandard,
            &AssetQuery {
                root_id: Some(root_two),
                review_states: vec![ReviewState::Unreviewed],
                sort: AssetSort::CreatedAscending,
                ..AssetQuery::default()
            },
        )
        .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].location_id, second_location);
    let first = session
        .query_asset_index(
            0,
            10,
            AssetProjection::ContactSheetStandard,
            &AssetQuery {
                root_id: Some(root_one),
                ..AssetQuery::default()
            },
        )
        .unwrap();
    assert_eq!(first.items.len(), 1);
    session.close().unwrap();
}

#[cfg(unix)]
#[test]
fn retained_root_descriptor_never_indexes_replacement_or_symlinked_ancestor_bytes() {
    use std::os::unix::fs::symlink;

    let project = Project::new();
    let parent = project.root("Authority Parent");
    let root = parent.join("Root");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("inside.png"), decode_hex(PNG_HEX)).unwrap();
    let outside_parent = project.root("Outside");
    let outside_root = outside_parent.join("Root");
    fs::create_dir_all(&outside_root).unwrap();
    fs::write(outside_root.join("outside.png"), decode_hex(PNG_HEX)).unwrap();
    let mut outside_same_name = decode_hex(PNG_HEX);
    outside_same_name.extend_from_slice(b"outside-bytes");
    fs::write(outside_root.join("inside.png"), &outside_same_name).unwrap();

    let mut session = LibrarySession::create(&project.library, "Authority".into()).unwrap();
    let plan = session.add_root(&root, "Root".into()).unwrap();
    let held_parent = project.root("Held Parent");
    fs::rename(&parent, &held_parent).unwrap();
    symlink(&outside_parent, &parent).unwrap();
    run(plan);
    let page = session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].display_name, "inside.png");
    assert!(matches!(
        session.resolve_location(&page.items[0].location_id),
        Err(CoreError::LocationMissing)
    ));
    let preview = session
        .authorize_resource(
            &page.items[0].asset_id,
            reference_protocol::ResourceProfile::Preview,
        )
        .unwrap();
    let preview_path = PathBuf::from(preview.native_path_for_handler);
    assert_eq!(fs::read(&preview_path).unwrap(), decode_hex(PNG_HEX));
    assert_ne!(
        fs::read(outside_root.join("inside.png")).unwrap(),
        decode_hex(PNG_HEX)
    );
    if let Some(library_cache) = preview_path.ancestors().nth(3)
        && library_cache.file_name().and_then(|name| name.to_str())
            == Some(session.opened().library_id.as_str())
    {
        fs::remove_dir_all(library_cache).unwrap();
    }
    session.close().unwrap();
}

#[test]
fn scan_cancellation_interrupts_streaming_evidence_and_is_restartable() {
    let project = Project::new();
    let root = project.root("Root");
    fs::create_dir(&root).unwrap();
    let source = root.join("large.png");
    fs::write(&source, decode_hex(PNG_HEX)).unwrap();
    File::options()
        .write(true)
        .open(&source)
        .unwrap()
        .set_len(256 * 1024 * 1024)
        .unwrap();

    let mut session = LibrarySession::create(&project.library, "Cancellation".into()).unwrap();
    let plan = session.add_root(&root, "Root".into()).unwrap();
    let root_id = plan.root_id.clone();
    let job_id = plan.job_id.clone();
    let cancelled = Arc::new(AtomicBool::new(false));
    let worker_cancelled = Arc::clone(&cancelled);
    let (sender, _receiver) = mpsc::channel();
    let worker = thread::spawn(move || scan_root(plan, worker_cancelled, sender));
    thread::sleep(Duration::from_millis(20));
    cancelled.store(true, Ordering::Release);
    worker.join().unwrap();

    let jobs = session
        .query_jobs(
            0,
            10,
            &JobQuery {
                root_id: Some(root_id.clone()),
                states: vec![JobState::Cancelled],
            },
        )
        .unwrap();
    assert_eq!(jobs.items.len(), 1);
    assert_eq!(jobs.items[0].job_id, job_id);
    assert_eq!(session.query_roots().unwrap()[0].state, "connected");

    fs::write(&source, decode_hex(PNG_HEX)).unwrap();
    run(session.rescan_root(&root_id).unwrap());
    assert_eq!(session.query_roots().unwrap()[0].state, "ready");
    session.close().unwrap();
}

#[test]
fn add_root_does_not_reuse_identity_for_a_replacement_at_the_same_path() {
    let project = Project::new();
    let root = project.root("Root");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("alpha.png"), decode_hex(PNG_HEX)).unwrap();
    let mut session = LibrarySession::create(&project.library, "Replacement".into()).unwrap();
    let first = session.add_root(&root, "First".into()).unwrap();
    let first_root_id = first.root_id.clone();
    run(first);

    fs::rename(&root, project.root("Old Root")).unwrap();
    fs::create_dir(&root).unwrap();
    fs::write(root.join("outside.png"), decode_hex(PNG_HEX)).unwrap();
    let replacement = session.add_root(&root, "Replacement".into()).unwrap();
    assert_ne!(replacement.root_id, first_root_id);
    run(replacement);
    assert_eq!(session.query_roots().unwrap().len(), 2);
    session.close().unwrap();
}

#[test]
fn empty_root_at_a_replaced_path_is_not_silently_reassociated_after_reopen() {
    let project = Project::new();
    let root = project.root("Empty Root");
    fs::create_dir(&root).unwrap();
    let mut session = LibrarySession::create(&project.library, "Empty replacement".into()).unwrap();
    let first = session.add_root(&root, "First".into()).unwrap();
    let first_root_id = first.root_id.clone();
    run(first);
    session.close().unwrap();

    fs::rename(&root, project.root("Old Empty Root")).unwrap();
    fs::create_dir(&root).unwrap();
    let mut reopened = LibrarySession::open(&project.library).unwrap();
    let replacement = reopened.add_root(&root, "Replacement".into()).unwrap();
    assert_ne!(replacement.root_id, first_root_id);
    run(replacement);
    assert_eq!(reopened.query_roots().unwrap().len(), 2);
    reopened.close().unwrap();
}

#[test]
fn scanner_persistence_failure_emits_restart_truth_not_a_false_terminal_event() {
    let project = Project::new();
    let root = project.root("Root");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("alpha.png"), decode_hex(PNG_HEX)).unwrap();
    let mut session = LibrarySession::create(&project.library, "Persistence".into()).unwrap();
    let plan = session.add_root(&root, "Root".into()).unwrap();
    let job_id = plan.job_id.clone();
    session.close().unwrap();

    let database = project.library.join("library.sqlite");
    let preserved = project.library.join("library.sqlite.preserved");
    fs::rename(&database, &preserved).unwrap();
    fs::create_dir(&database).unwrap();
    let (sender, receiver) = mpsc::channel();
    let outcome = scan_root(plan, Arc::new(AtomicBool::new(false)), sender);
    assert!(!outcome.terminal_persisted);
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
fn root_and_job_terminal_truth_roll_back_together_before_recovery() {
    let project = Project::new();
    let root = project.root("Root");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("alpha.png"), decode_hex(PNG_HEX)).unwrap();
    let mut session = LibrarySession::create(&project.library, "Atomic terminal".into()).unwrap();
    let plan = session.add_root(&root, "Root".into()).unwrap();
    let root_id = plan.root_id.clone();
    let job_id = plan.job_id.clone();
    let manifest = Manifest::read(&project.library).unwrap();
    let connection =
        schema::open_database(&project.library.join("library.sqlite"), &manifest).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER fail_job_terminal BEFORE UPDATE OF state ON jobs
             WHEN NEW.state IN ('completed','failed')
             BEGIN SELECT RAISE(ABORT, 'injected terminal failure'); END;",
        )
        .unwrap();
    let (sender, receiver) = mpsc::channel();
    let outcome = scan_root(plan, Arc::new(AtomicBool::new(false)), sender);
    assert!(!outcome.terminal_persisted);
    assert!(
        receiver
            .try_iter()
            .any(|event| matches!(event, Event::CoreNeedsRestart { .. }))
    );
    let (root_state, job_state): (String, String) = connection
        .query_row(
            "SELECT r.state,j.state FROM roots r JOIN jobs j ON j.root_id=r.id
             WHERE r.id=?1 AND j.id=?2",
            params![root_id, job_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(root_state, "scanning");
    assert_eq!(job_state, "running");
    connection
        .execute_batch("DROP TRIGGER fail_job_terminal")
        .unwrap();
    drop(connection);
    session.close().unwrap();
    let mut reopened = LibrarySession::open(&project.library).unwrap();
    assert_eq!(reopened.query_roots().unwrap()[0].state, "error");
    assert!(
        reopened
            .query_jobs(
                0,
                10,
                &JobQuery {
                    root_id: Some(root_id),
                    states: vec![JobState::Failed],
                },
            )
            .unwrap()
            .items
            .iter()
            .any(|job| job.job_id == job_id && job.error_code.as_deref() == Some("CoreRestarted"))
    );
    reopened.close().unwrap();
}

fn run(plan: reference_core::discovery::ScanPlan) {
    let (sender, _receiver) = mpsc::channel();
    assert!(scan_root(plan, Arc::new(AtomicBool::new(false)), sender).terminal_persisted);
}

fn current_revision(library: &Path) -> String {
    let manifest = Manifest::read(library).unwrap();
    let connection = schema::open_database(&library.join("library.sqlite"), &manifest).unwrap();
    connection
        .query_row(
            "SELECT current_revision_id FROM sources LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn add_second_location(library: &Path) -> (String, String) {
    let manifest = Manifest::read(library).unwrap();
    let connection = schema::open_database(&library.join("library.sqlite"), &manifest).unwrap();
    let root_id = Uuid::new_v4().to_string();
    let location_id = Uuid::new_v4().to_string();
    let source_id: String = connection
        .query_row("SELECT id FROM sources LIMIT 1", [], |row| row.get(0))
        .unwrap();
    connection
        .execute(
            "INSERT INTO roots (
                id, library_id, display_name, root_kind, state,
                scan_policy_json, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'Two', 'linked', 'ready', '{}', 2, 2)",
            params![root_id, manifest.library_id],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO locations (
                id, root_id, source_id, relative_path_bytes, relative_path_display,
                state, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, 'nested/second.png', 'present', 2, 2)",
            params![
                location_id,
                root_id,
                source_id,
                b"nested/second.png".as_slice()
            ],
        )
        .unwrap();
    (root_id, location_id)
}

fn decode_hex(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}

fn domain_identity_projection(dump: &serde_json::Value) -> Vec<(String, Vec<String>)> {
    [
        ("roots", "id"),
        ("sources", "id"),
        ("locations", "id"),
        ("assetOrigins", "id"),
        ("assets", "id"),
    ]
    .into_iter()
    .map(|(entity, field)| {
        let mut ids = dump[entity]
            .as_array()
            .unwrap()
            .iter()
            .map(|record| record[field].as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        ids.sort();
        (entity.to_owned(), ids)
    })
    .collect()
}

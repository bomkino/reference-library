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
    fs::write(root.join("alpha.png"), &png).unwrap();
    fs::write(root.join("bravo.png"), &png).unwrap();
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
    assert_eq!(roots[0].observed_count, 2);
    session.close().unwrap();

    let wrong = project.root("Wrong");
    fs::create_dir(&wrong).unwrap();
    fs::write(wrong.join("alpha.png"), &png).unwrap();
    fs::write(wrong.join("bravo.png"), b"same length is not enough").unwrap();
    let mut reopened = LibrarySession::open(&project.library).unwrap();
    assert!(!reopened.query_roots().unwrap()[0].authorized);
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
    let mut session = LibrarySession::create(&project.library, "Catalogue".into()).unwrap();
    let plan = session.add_root(&root, "Root".into()).unwrap();
    run(plan);
    let root = session.query_roots().unwrap().remove(0);
    assert_eq!(root.observed_count, 3);
    assert_eq!(root.unsupported_count, 2);
    let page = session
        .query_assets(0, 10, AssetProjection::ContactSheetStandard)
        .unwrap();
    assert_eq!(page.total, 3);
    assert_eq!(
        page.items
            .iter()
            .filter(|asset| asset.availability == "unreadable")
            .count(),
        2
    );
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

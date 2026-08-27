use std::{fs, path::PathBuf};

use reference_core::{canonical, error::CoreError};
use reference_protocol::{
    CanonicalEntity, CanonicalRecord, MAX_CANONICAL_PAGE_SIZE, MAX_FRAME_BYTES,
};
use rusqlite::{Connection, params};
use uuid::Uuid;

const MIGRATION_0001: &str = include_str!("../../../migrations/0001_t01.sql");
const MIGRATION_0002: &str = include_str!("../../../migrations/0002_v1_domain.sql");
const MIGRATION_0003: &str = include_str!("../../../migrations/0003_rendition_jobs.sql");

#[test]
fn digest_is_deterministic_across_reopen_and_ignores_host_operational_state() {
    let path = temporary_database_path();
    let connection = Connection::open(&path).unwrap();
    create_schema(&connection);
    insert_semantic_fixture(&connection);
    let expected = canonical::digest(&connection).unwrap();
    drop(connection);

    let connection = Connection::open(&path).unwrap();
    assert_eq!(canonical::digest(&connection).unwrap(), expected);

    connection
        .execute_batch(
            "UPDATE library_meta
                 SET library_revision = 999, updated_at_ms = 999;
             UPDATE roots
                 SET last_known_display_path = '/different/host/provider/path',
                     state = 'offline_volume', updated_at_ms = 999, last_seen_at_ms = NULL;
             UPDATE sources SET lineage_state = 'missing', updated_at_ms = 999;
             UPDATE locations
                 SET platform_file_id = X'DEADBEEF', platform_file_id_kind = 'host-only',
                     state = 'offline_root', last_stat_size = NULL,
                     last_stat_mtime_ms = NULL, updated_at_ms = 999;
             UPDATE assets SET revision = 99, updated_at_ms = 999;
             UPDATE collections SET revision = 99, updated_at_ms = 999;
             INSERT INTO jobs (
                 id, library_id, job_kind, state, progress_json, error_code,
                 created_at_ms, updated_at_ms, finished_at_ms, root_id
             ) VALUES (
                 'job-host-only', 'library-a', 'initial_scan', 'completed',
                 '{\"observedCount\":2}', NULL, 1, 2, 2, 'root-a'
             );
             INSERT INTO renditions (
                 id, asset_origin_id, source_revision_id, profile, provider,
                 provider_version, state, error_code, created_at_ms
             ) VALUES (
                 'rendition-cache-only', 'origin-a', 'revision-a', 'preview',
                 'host-provider', '99', 'ready', NULL, 999
             );",
        )
        .unwrap();

    assert_eq!(canonical::digest(&connection).unwrap(), expected);
    drop(connection);
    remove_sqlite_files(&path);
}

#[test]
fn digest_tracks_curation_collections_membership_and_canonicalizes_json_keys() {
    let connection = semantic_database();
    let initial = canonical::digest(&connection).unwrap();

    connection
        .execute(
            "UPDATE asset_origins SET origin_spec_json = ?1 WHERE id = 'origin-a'",
            [r#"{"z":1,"a":{"y":2,"b":3}}"#],
        )
        .unwrap();
    let first_json_order = canonical::digest(&connection).unwrap();
    assert_ne!(first_json_order.digest, initial.digest);
    connection
        .execute(
            "UPDATE asset_origins SET origin_spec_json = ?1 WHERE id = 'origin-a'",
            [r#"{"a":{"b":3,"y":2},"z":1}"#],
        )
        .unwrap();
    assert_eq!(canonical::digest(&connection).unwrap(), first_json_order);

    connection
        .execute(
            "UPDATE assets SET custom_title = 'Hero' WHERE id = 'asset-a'",
            [],
        )
        .unwrap();
    let titled = canonical::digest(&connection).unwrap();
    assert_ne!(titled.digest, first_json_order.digest);

    connection
        .execute(
            "UPDATE assets SET note = 'Use wide' WHERE id = 'asset-a'",
            [],
        )
        .unwrap();
    let noted = canonical::digest(&connection).unwrap();
    assert_ne!(noted.digest, titled.digest);

    connection
        .execute(
            "UPDATE assets SET review_state = 'keep' WHERE id = 'asset-a'",
            [],
        )
        .unwrap();
    let reviewed = canonical::digest(&connection).unwrap();
    assert_ne!(reviewed.digest, noted.digest);

    connection
        .execute(
            "UPDATE collections SET name = 'Final selects' WHERE id = 'collection-a'",
            [],
        )
        .unwrap();
    let renamed = canonical::digest(&connection).unwrap();
    assert_ne!(renamed.digest, reviewed.digest);

    connection
        .execute(
            "INSERT INTO collection_assets (collection_id, asset_id, added_at_ms)
             VALUES ('collection-a', 'asset-b', 999)",
            [],
        )
        .unwrap();
    let membership_changed = canonical::digest(&connection).unwrap();
    assert_ne!(membership_changed.digest, renamed.digest);
}

#[test]
fn pages_are_bounded_ordered_and_reject_a_changed_snapshot() {
    let connection = semantic_database();
    let digest = canonical::digest(&connection).unwrap();
    let first = canonical::page(
        &connection,
        &digest.digest,
        CanonicalEntity::Assets,
        None,
        1,
    )
    .unwrap();
    assert_eq!(first.total, 2);
    assert_eq!(first.cursor, None);
    assert_eq!(first.next_cursor.as_deref(), Some("1"));
    assert_eq!(first.records.len(), 1);
    assert!(matches!(
        &first.records[0],
        CanonicalRecord::Asset(asset) if asset.id == "asset-a"
    ));
    assert!(serde_json::to_vec(&first).unwrap().len() < MAX_FRAME_BYTES);

    connection
        .execute(
            "UPDATE locations SET state = 'missing', updated_at_ms = 500
             WHERE id = 'location-a'",
            [],
        )
        .unwrap();
    let second = canonical::page(
        &connection,
        &digest.digest,
        CanonicalEntity::Assets,
        first.next_cursor.as_deref(),
        1,
    )
    .unwrap();
    assert_eq!(second.records.len(), 1);
    assert_eq!(second.next_cursor, None);
    assert!(matches!(
        &second.records[0],
        CanonicalRecord::Asset(asset) if asset.id == "asset-b"
    ));

    connection
        .execute(
            "UPDATE assets SET note = 'new durable meaning' WHERE id = 'asset-b'",
            [],
        )
        .unwrap();
    assert!(matches!(
        canonical::page(
            &connection,
            &digest.digest,
            CanonicalEntity::Assets,
            Some("1"),
            1,
        ),
        Err(CoreError::CanonicalSnapshotChanged)
    ));
    let protocol_error = CoreError::CanonicalSnapshotChanged.to_protocol_error();
    assert_eq!(protocol_error.code, "CanonicalSnapshotChanged");
    assert!(protocol_error.retryable);
    assert!(!protocol_error.message.contains('/'));
}

#[test]
fn page_rejects_unbounded_limits_and_malformed_or_out_of_range_cursors() {
    let connection = semantic_database();
    let digest = canonical::digest(&connection).unwrap();
    for limit in [0, MAX_CANONICAL_PAGE_SIZE + 1] {
        assert!(matches!(
            canonical::page(
                &connection,
                &digest.digest,
                CanonicalEntity::Assets,
                None,
                limit,
            ),
            Err(CoreError::QueryPageTooLarge(actual)) if actual == limit
        ));
    }
    for cursor in ["", "01", "-1", "one", "18446744073709551616"] {
        assert!(matches!(
            canonical::page(
                &connection,
                &digest.digest,
                CanonicalEntity::Assets,
                Some(cursor),
                1,
            ),
            Err(CoreError::QueryInvalid(_))
        ));
    }
    assert!(matches!(
        canonical::page(
            &connection,
            &digest.digest,
            CanonicalEntity::Assets,
            Some("3"),
            1,
        ),
        Err(CoreError::QueryInvalid(_))
    ));
}

#[test]
fn one_hundred_thousand_assets_use_small_digest_and_page_frames() {
    let mut connection = empty_database();
    let transaction = connection.transaction().unwrap();
    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO assets (
                    id, library_id, custom_title, review_state, created_at_ms,
                    updated_at_ms, note, revision
                 ) VALUES (?1, 'library-a', NULL, 'unreviewed', ?2, ?2, NULL, 0)",
            )
            .unwrap();
        for index in 0..100_000_u64 {
            statement
                .execute(params![format!("asset-{index:06}"), index as i64])
                .unwrap();
        }
    }
    transaction.commit().unwrap();

    let digest = canonical::digest(&connection).unwrap();
    let asset_count = digest
        .counts
        .iter()
        .find(|entry| entry.entity == CanonicalEntity::Assets)
        .unwrap();
    assert_eq!(asset_count.count, 100_000);
    assert!(serde_json::to_vec(&digest).unwrap().len() < MAX_FRAME_BYTES);

    let page = canonical::page(
        &connection,
        &digest.digest,
        CanonicalEntity::Assets,
        None,
        MAX_CANONICAL_PAGE_SIZE,
    )
    .unwrap();
    assert_eq!(page.total, 100_000);
    assert_eq!(page.records.len(), MAX_CANONICAL_PAGE_SIZE as usize);
    assert_eq!(page.next_cursor.as_deref(), Some("250"));
    assert!(serde_json::to_vec(&page).unwrap().len() < MAX_FRAME_BYTES);
}

fn semantic_database() -> Connection {
    let connection = empty_database();
    insert_semantic_fixture(&connection);
    connection
}

fn empty_database() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    create_schema(&connection);
    connection
}

fn create_schema(connection: &Connection) {
    connection.execute_batch(MIGRATION_0001).unwrap();
    connection
        .execute(
            "INSERT INTO library_meta (
                id, schema_version, name, library_revision, created_at_ms, updated_at_ms
             ) VALUES ('library-a', 1, 'Reference', 0, 1, 1)",
            [],
        )
        .unwrap();
    connection.execute_batch(MIGRATION_0002).unwrap();
    connection.execute_batch(MIGRATION_0003).unwrap();
}

fn insert_semantic_fixture(connection: &Connection) {
    connection
        .execute_batch(
            "INSERT INTO roots (
                 id, library_id, display_name, root_kind, last_known_display_path,
                 state, created_at_ms, updated_at_ms, last_seen_at_ms
             ) VALUES (
                 'root-a', 'library-a', 'Research', 'linked', '/host-a/research',
                 'ready', 1, 1, 1
             );
             INSERT INTO sources (
                 id, library_id, media_family, current_revision_id, lineage_state,
                 created_at_ms, updated_at_ms
             ) VALUES ('source-a', 'library-a', 'still', 'revision-a', 'active', 1, 1);
             INSERT INTO source_revisions (
                 id, source_id, byte_size, mtime_observed_ms, quick_fingerprint,
                 mime_detected, extension_observed, media_metadata_json, created_at_ms
             ) VALUES (
                 'revision-a', 'source-a', 1234, 12, 'quick:a', 'image/jpeg', 'jpg',
                 '{\"nested\":{\"z\":2,\"a\":1},\"width\":640}', 1
             );
             INSERT INTO locations (
                 id, root_id, source_id, relative_path_bytes, relative_path_display,
                 platform_file_id, platform_file_id_kind, state, last_stat_size,
                 last_stat_mtime_ms, created_at_ms, updated_at_ms
             ) VALUES (
                 'location-a', 'root-a', 'source-a', X'666F6C6465722F612E6A7067',
                 'folder/a.jpg', X'CAFE', 'linux-inode', 'present', 1234, 12, 1, 1
             );
             INSERT INTO assets (
                 id, library_id, custom_title, review_state, created_at_ms,
                 updated_at_ms, note, revision
             ) VALUES
                 ('asset-b', 'library-a', NULL, 'unreviewed', 2, 2, NULL, 0),
                 ('asset-a', 'library-a', 'First', 'maybe', 1, 1, 'Opening', 4);
             INSERT INTO asset_origins (
                 id, asset_id, source_id, origin_kind, origin_spec_json,
                 revision_binding, created_at_ms
             ) VALUES
                 ('origin-b', 'asset-b', 'source-a', 'whole', '{\"kind\":\"whole\"}',
                  'latest', 2),
                 ('origin-a', 'asset-a', 'source-a', 'whole', '{\"kind\":\"whole\"}',
                  'latest', 1);
             INSERT INTO collections (
                 id, library_id, name, revision, created_at_ms, updated_at_ms
             ) VALUES ('collection-a', 'library-a', 'Selects', 2, 1, 1);
             INSERT INTO collection_assets (collection_id, asset_id, added_at_ms)
             VALUES ('collection-a', 'asset-a', 1);",
        )
        .unwrap();
}

fn temporary_database_path() -> PathBuf {
    std::env::temp_dir().join(format!("reference-canonical-{}.sqlite", Uuid::new_v4()))
}

fn remove_sqlite_files(path: &PathBuf) {
    let _ = fs::remove_file(path);
    let mut wal = path.as_os_str().to_os_string();
    wal.push("-wal");
    let _ = fs::remove_file(PathBuf::from(wal));
    let mut shm = path.as_os_str().to_os_string();
    shm.push("-shm");
    let _ = fs::remove_file(PathBuf::from(shm));
}

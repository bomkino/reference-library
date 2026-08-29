use std::{fs, path::PathBuf};

use reference_core::{SCHEMA_VERSION, manifest::Manifest, schema, session::LibrarySession};
use rusqlite::{Connection, params};
use uuid::Uuid;

const MIGRATION_0001: &str = include_str!("../../../migrations/0001_t01.sql");
const MIGRATION_0002: &str = include_str!("../../../migrations/0002_v1_domain.sql");
const MIGRATION_0003: &str = include_str!("../../../migrations/0003_rendition_jobs.sql");
const MIGRATION_0004: &str =
    include_str!("../../../migrations/0004_asset_browser_parity.sql");

struct PopulatedPackage {
    directory: PathBuf,
    path: PathBuf,
    manifest: Manifest,
    ids: FixtureIds,
}

#[derive(Clone)]
struct FixtureIds {
    root: String,
    source: String,
    source_revision: String,
    location: String,
    asset: String,
    asset_origin: String,
    rendition: String,
    job: String,
}

impl PopulatedPackage {
    fn at_schema_one() -> Self {
        let directory =
            std::env::temp_dir().join(format!("reference-v1-migration-{}", Uuid::new_v4()));
        let path = directory.join("Project.pitchlibrary");
        fs::create_dir_all(path.join("embedded")).unwrap();
        let mut manifest = Manifest::new("Populated migration".into());
        manifest.schema_version = 1;
        manifest.write_atomic(&path).unwrap();

        let ids = FixtureIds {
            root: Uuid::new_v4().to_string(),
            source: Uuid::new_v4().to_string(),
            source_revision: Uuid::new_v4().to_string(),
            location: Uuid::new_v4().to_string(),
            asset: Uuid::new_v4().to_string(),
            asset_origin: Uuid::new_v4().to_string(),
            rendition: Uuid::new_v4().to_string(),
            job: Uuid::new_v4().to_string(),
        };
        let connection = Connection::open(path.join("library.sqlite")).unwrap();
        connection.execute_batch(MIGRATION_0001).unwrap();
        connection
            .execute(
                "INSERT INTO library_meta (
                    id, schema_version, name, library_revision, created_at_ms, updated_at_ms
                 ) VALUES (?1, 1, ?2, 7, 10, 10)",
                params![manifest.library_id, manifest.name],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO roots (
                    id, library_id, display_name, root_kind, last_known_display_path,
                    state, scan_policy_json, created_at_ms, updated_at_ms, last_seen_at_ms
                 ) VALUES (?1, ?2, 'Pictures', 'linked', '/fixture/Pictures',
                           'ready', '{}', 11, 11, 11)",
                params![ids.root, manifest.library_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO sources (
                    id, library_id, media_family, current_revision_id, lineage_state,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'still', NULL, 'active', 12, 12)",
                params![ids.source, manifest.library_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO source_revisions (
                    id, source_id, byte_size, mtime_observed_ms, quick_fingerprint,
                    mime_detected, extension_observed, media_metadata_json, created_at_ms
                 ) VALUES (?1, ?2, 68, 13, 'fixture-fingerprint',
                           'image/png', 'png', '{\"width\":1,\"height\":1}', 13)",
                params![ids.source_revision, ids.source],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE sources SET current_revision_id = ?1 WHERE id = ?2",
                params![ids.source_revision, ids.source],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO locations (
                    id, root_id, source_id, relative_path_bytes, relative_path_display,
                    state, last_stat_size, last_stat_mtime_ms, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, 'fixture.png', 'present', 68, 13, 14, 14)",
                params![
                    ids.location,
                    ids.root,
                    ids.source,
                    b"fixture.png".as_slice()
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO assets (
                    id, library_id, custom_title, review_state, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'Fixture title', 'keep', 15, 15)",
                params![ids.asset, manifest.library_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO asset_origins (
                    id, asset_id, source_id, origin_kind, origin_spec_json,
                    revision_binding, created_at_ms
                 ) VALUES (?1, ?2, ?3, 'whole', '{\"kind\":\"whole\"}', 'latest', 16)",
                params![ids.asset_origin, ids.asset, ids.source],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO renditions (
                    id, asset_origin_id, source_revision_id, profile, provider,
                    provider_version, state, error_code, created_at_ms
                 ) VALUES (?1, ?2, ?3, 'grid_standard', 'fixture', '1', 'ready', NULL, 17)",
                params![ids.rendition, ids.asset_origin, ids.source_revision],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO jobs (
                    id, library_id, job_kind, state, progress_json, error_code,
                    created_at_ms, updated_at_ms, finished_at_ms
                 ) VALUES (?1, ?2, 'initial_scan', 'completed',
                           '{\"observedCount\":1}', NULL, 18, 19, 19)",
                params![ids.job, manifest.library_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO app_events (
                    library_revision, event_kind, payload_json, created_at_ms
                 ) VALUES (7, 'fixture_created', '{\"assetId\":\"fixture\"}', 20)",
                [],
            )
            .unwrap();
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
        drop(connection);
        Self {
            directory,
            path,
            manifest,
            ids,
        }
    }

    fn database(&self) -> PathBuf {
        self.path.join("library.sqlite")
    }
}

impl Drop for PopulatedPackage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn populated_schema_one_migrates_without_rekeying_canonical_identity() {
    let package = PopulatedPackage::at_schema_one();
    let expected = package.ids.clone();

    let mut session = LibrarySession::open(&package.path).unwrap();
    assert_eq!(session.opened().schema_version, SCHEMA_VERSION);
    let connection = Connection::open(package.database()).unwrap();
    assert_version_surfaces_converged(&connection, &package.path);
    assert_eq!(single_id(&connection, "roots"), expected.root);
    assert_eq!(single_id(&connection, "sources"), expected.source);
    assert_eq!(
        single_id(&connection, "source_revisions"),
        expected.source_revision
    );
    assert_eq!(single_id(&connection, "locations"), expected.location);
    assert_eq!(single_id(&connection, "assets"), expected.asset);
    assert_eq!(
        single_id(&connection, "asset_origins"),
        expected.asset_origin
    );
    assert_eq!(
        single_id(&connection, "renditions"),
        expected.rendition
    );
    assert_eq!(single_id(&connection, "jobs"), expected.job);
    assert_eq!(
        connection
            .query_row(
                "SELECT custom_title, review_state, note, revision FROM assets WHERE id = ?1",
                params![expected.asset],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .unwrap(),
        ("Fixture title".into(), "keep".into(), None, 0)
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT job_kind, state, root_id FROM jobs WHERE id = ?1",
                params![expected.job],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .unwrap(),
        ("initial_scan".into(), "completed".into(), None)
    );
    drop(connection);
    session.close().unwrap();
    assert_eq!(
        Manifest::read(&package.path).unwrap().schema_version,
        SCHEMA_VERSION
    );

    let mut reopened = LibrarySession::open(&package.path).unwrap();
    assert_eq!(reopened.opened().schema_version, SCHEMA_VERSION);
    let connection = Connection::open(package.database()).unwrap();
    assert_version_surfaces_converged(&connection, &package.path);
    assert_eq!(single_id(&connection, "assets"), expected.asset);
    drop(connection);
    reopened.close().unwrap();
    assert_eq!(
        Manifest::read(&package.path).unwrap().schema_version,
        SCHEMA_VERSION
    );
}

#[test]
fn reopen_repairs_a_committed_migration_metadata_boundary() {
    let package = PopulatedPackage::at_schema_one();
    let connection = Connection::open(package.database()).unwrap();
    connection.execute_batch(MIGRATION_0002).unwrap();
    connection.execute_batch(MIGRATION_0003).unwrap();
    connection.execute_batch(MIGRATION_0004).unwrap();
    // Reproduce a package written by the pre-fix migration sequence, where
    // PRAGMA/ledger committed before the separate library_meta write.
    connection
        .execute("UPDATE library_meta SET schema_version = 1", [])
        .unwrap();
    assert_eq!(pragma_version(&connection), SCHEMA_VERSION);
    assert_eq!(library_meta_version(&connection), 1);
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    drop(connection);

    let mut session = LibrarySession::open(&package.path).unwrap();
    assert_eq!(session.opened().schema_version, SCHEMA_VERSION);
    let connection = Connection::open(package.database()).unwrap();
    assert_version_surfaces_converged(&connection, &package.path);
    assert_eq!(single_id(&connection, "assets"), package.ids.asset);
    drop(connection);
    session.close().unwrap();
    assert_eq!(
        Manifest::read(&package.path).unwrap().schema_version,
        SCHEMA_VERSION
    );

    let mut reopened = LibrarySession::open(&package.path).unwrap();
    assert_eq!(reopened.opened().schema_version, SCHEMA_VERSION);
    let connection = Connection::open(package.database()).unwrap();
    assert_version_surfaces_converged(&connection, &package.path);
    drop(connection);
    reopened.close().unwrap();
    assert_eq!(
        Manifest::read(&package.path).unwrap().schema_version,
        SCHEMA_VERSION
    );
}

#[test]
fn committed_wal_curation_recovers_across_sequential_reopens() {
    let package = PopulatedPackage::at_schema_one();
    let mut migrated = LibrarySession::open(&package.path).unwrap();
    migrated.close().unwrap();

    let recovery_directory =
        std::env::temp_dir().join(format!("reference-v1-wal-recovery-{}", Uuid::new_v4()));
    let recovery_path = recovery_directory.join("Recovered.pitchlibrary");
    fs::create_dir_all(recovery_path.join("embedded")).unwrap();
    fs::copy(
        package.path.join("manifest.json"),
        recovery_path.join("manifest.json"),
    )
    .unwrap();

    let connection =
        schema::open_database(&package.database(), &Manifest::read(&package.path).unwrap())
            .unwrap();
    connection
        .pragma_update(None, "wal_autocheckpoint", 0)
        .unwrap();
    let collection_id = Uuid::new_v4().to_string();
    connection.execute_batch("BEGIN IMMEDIATE").unwrap();
    connection
        .execute(
            "UPDATE assets SET custom_title = 'Recovered title', note = 'Recovered note',
                               revision = revision + 1, updated_at_ms = 30
             WHERE id = ?1",
            params![package.ids.asset],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO collections (
                id, library_id, name, revision, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'Recovered collection', 1, 30, 30)",
            params![collection_id, package.manifest.library_id],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO collection_assets (collection_id, asset_id, added_at_ms)
             VALUES (?1, ?2, 30)",
            params![collection_id, package.ids.asset],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE library_meta SET library_revision = 8, updated_at_ms = 30 WHERE id = ?1",
            params![package.manifest.library_id],
        )
        .unwrap();
    connection.execute_batch("COMMIT").unwrap();
    let wal = package.database().with_extension("sqlite-wal");
    assert!(fs::metadata(&wal).unwrap().len() > 32);
    fs::copy(package.database(), recovery_path.join("library.sqlite")).unwrap();
    fs::copy(&wal, recovery_path.join("library.sqlite-wal")).unwrap();
    drop(connection);

    for _ in 0..2 {
        let mut recovered = LibrarySession::open(&recovery_path).unwrap();
        let detail = recovered.get_asset(&package.ids.asset).unwrap();
        assert_eq!(detail.custom_title.as_deref(), Some("Recovered title"));
        assert_eq!(detail.note.as_deref(), Some("Recovered note"));
        assert_eq!(detail.revision, 1);
        assert_eq!(detail.collection_ids, vec![collection_id.clone()]);
        let collections = recovered.list_collections().unwrap();
        assert_eq!(collections.len(), 1);
        assert_eq!(collections[0].collection_id, collection_id);
        assert_eq!(collections[0].asset_count, 1);
        recovered.close().unwrap();
    }
    let _ = fs::remove_dir_all(&recovery_directory);
}

fn single_id(connection: &Connection, table: &str) -> String {
    connection
        .query_row(&format!("SELECT id FROM {table}"), [], |row| row.get(0))
        .unwrap()
}

fn pragma_version(connection: &Connection) -> u32 {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

fn library_meta_version(connection: &Connection) -> u32 {
    connection
        .query_row("SELECT schema_version FROM library_meta", [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn assert_version_surfaces_converged(connection: &Connection, package: &std::path::Path) {
    assert_eq!(pragma_version(connection), SCHEMA_VERSION);
    assert_eq!(library_meta_version(connection), SCHEMA_VERSION);
    assert_eq!(
        Manifest::read(package).unwrap().schema_version,
        SCHEMA_VERSION
    );
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get::<_, u32>(0)
            })
            .unwrap(),
        SCHEMA_VERSION
    );
}

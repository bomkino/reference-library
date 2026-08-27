use std::{fs, path::PathBuf};

use reference_core::{
    SCHEMA_VERSION, error::CoreError, manifest::Manifest, schema, session::LibrarySession,
};
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const MIGRATION_0001: &str = include_str!("../../../migrations/0001_t01.sql");
const MIGRATION_0002: &str = include_str!("../../../migrations/0002_v1_domain.sql");

struct Package {
    directory: PathBuf,
    path: PathBuf,
    manifest: Manifest,
}

impl Package {
    fn at_schema_1() -> Self {
        let directory =
            std::env::temp_dir().join(format!("reference-v1-schema-{}", Uuid::new_v4()));
        let path = directory.join("Project.pitchlibrary");
        fs::create_dir_all(path.join("embedded")).unwrap();
        let mut manifest = Manifest::new("Schema proof".into());
        manifest.schema_version = 1;
        manifest.write_atomic(&path).unwrap();
        let connection = Connection::open(path.join("library.sqlite")).unwrap();
        connection.execute_batch(MIGRATION_0001).unwrap();
        connection
            .execute(
                "INSERT INTO library_meta (
                    id, schema_version, name, library_revision, created_at_ms, updated_at_ms
                 ) VALUES (?1, 1, ?2, 0, ?3, ?3)",
                params![
                    manifest.library_id,
                    manifest.name,
                    manifest.created_at_ms as i64
                ],
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
        }
    }

    fn database(&self) -> PathBuf {
        self.path.join("library.sqlite")
    }
}

impl Drop for Package {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn sequential_migrations_preserve_existing_jobs_and_match_the_embedded_ledger() {
    let package = Package::at_schema_1();
    let connection = Connection::open(package.database()).unwrap();
    connection.execute_batch(MIGRATION_0002).unwrap();
    let job_id = Uuid::new_v4().to_string();
    connection
        .execute(
            "INSERT INTO jobs (
                id, library_id, job_kind, state, progress_json,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'initial_scan', 'completed', '{}', 1, 1)",
            params![job_id, package.manifest.library_id],
        )
        .unwrap();
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    drop(connection);

    let opened = schema::open_database(&package.database(), &package.manifest).unwrap();
    assert_eq!(
        opened
            .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    assert_eq!(
        opened
            .query_row(
                "SELECT state FROM jobs WHERE id = ?1",
                params![job_id],
                |row| { row.get::<_, String>(0) }
            )
            .unwrap(),
        "completed"
    );
    let ledger = opened
        .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
        .unwrap()
        .query_map([], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        ledger,
        vec![
            (
                1,
                "t01_canonical_slice".into(),
                "embedded-migration-0001".into()
            ),
            (
                2,
                "v1_curation_and_flat_collections".into(),
                "679fb0ceb8483bbb486951fb22ac7c5cddb1d80ecfaae188cd17493a1c369f53".into()
            ),
            (
                3,
                "v1_async_rendition_jobs".into(),
                "6670bc4e3fc09b0489f8c1f35611df625f5d5b69c394a8ff7fa7576933132c94".into()
            )
        ]
    );
}

#[test]
fn manifest_behind_database_is_recovered_but_future_schema_is_rejected() {
    let directory = std::env::temp_dir().join(format!("reference-v1-manifest-{}", Uuid::new_v4()));
    fs::create_dir(&directory).unwrap();
    let path = directory.join("Project.pitchlibrary");
    let mut session = LibrarySession::create(&path, "Recovery".into()).unwrap();
    session.close().unwrap();
    let mut manifest = Manifest::read(&path).unwrap();
    manifest.schema_version = 1;
    manifest.write_atomic(&path).unwrap();
    let mut reopened = LibrarySession::open(&path).unwrap();
    assert_eq!(
        Manifest::read(&path).unwrap().schema_version,
        SCHEMA_VERSION
    );
    reopened.close().unwrap();

    let connection = Connection::open(path.join("library.sqlite")).unwrap();
    connection
        .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
        .unwrap();
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    drop(connection);
    assert!(matches!(
        LibrarySession::open(&path),
        Err(CoreError::SchemaUnsupported { actual, supported })
            if actual == SCHEMA_VERSION + 1 && supported == SCHEMA_VERSION
    ));
    let _ = fs::remove_dir_all(directory);
}

#[test]
fn tampered_schema_1_ledger_is_rejected_without_mutating_database_bytes() {
    let package = Package::at_schema_1();
    let connection = Connection::open(package.database()).unwrap();
    connection
        .execute(
            "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1",
            [],
        )
        .unwrap();
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    drop(connection);
    let before = fs::read(package.database()).unwrap();
    let error = schema::open_database(&package.database(), &package.manifest).unwrap_err();
    assert!(matches!(error, CoreError::MigrationLedgerInvalid(1)));
    assert_eq!(fs::read(package.database()).unwrap(), before);
    assert_eq!(
        error.to_protocol_error().code,
        "LibraryIntegrityFailedPreserved"
    );
}

#[test]
fn corrupt_schema_1_is_rejected_without_mutating_database_bytes() {
    let package = Package::at_schema_1();
    let mut bytes = fs::read(package.database()).unwrap();
    // Byte 100 is the first b-tree page type immediately after SQLite's
    // 100-byte database header. An invalid page type is deterministic
    // structural corruption, not a possibly-unused truncated tail.
    bytes[100] = 0xff;
    fs::write(package.database(), &bytes).unwrap();
    let before_hash = Sha256::digest(&bytes);
    let error = schema::open_database(&package.database(), &package.manifest).unwrap_err();
    assert!(matches!(error, CoreError::DatabaseIntegrity(_)));
    assert_eq!(
        Sha256::digest(fs::read(package.database()).unwrap()),
        before_hash
    );
    assert_eq!(
        error.to_protocol_error().code,
        "LibraryIntegrityFailedPreserved"
    );
}

#[test]
fn failed_migration_rolls_back_schema_and_ledger() {
    let package = Package::at_schema_1();
    let connection = Connection::open(package.database()).unwrap();
    connection
        .execute("ALTER TABLE assets ADD COLUMN note TEXT", [])
        .unwrap();
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    drop(connection);

    assert!(schema::open_database(&package.database(), &package.manifest).is_err());
    let connection = Connection::open(package.database()).unwrap();
    assert_eq!(
        connection
            .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get::<_, u32>(0)
            })
            .unwrap(),
        1
    );
    assert!(connection.prepare("SELECT * FROM collections").is_err());
}

#[test]
fn exact_historical_ledger_tokens_remain_compatible() {
    let package = Package::at_schema_1();
    let connection = Connection::open(package.database()).unwrap();
    connection.execute_batch(MIGRATION_0002).unwrap();
    connection
        .execute(
            "UPDATE schema_migrations
             SET checksum='embedded-migration-0002-v1-domain' WHERE version=2",
            [],
        )
        .unwrap();
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    drop(connection);

    let connection = schema::open_database(&package.database(), &package.manifest).unwrap();
    assert_eq!(
        connection
            .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    connection
        .execute(
            "UPDATE schema_migrations
             SET checksum='embedded-migration-0003-rendition-jobs' WHERE version=3",
            [],
        )
        .unwrap();
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    drop(connection);
    schema::open_database(&package.database(), &Manifest::read(&package.path).unwrap()).unwrap();
}

#[test]
fn multiple_library_identities_are_rejected_without_mutating_database_bytes() {
    let directory = std::env::temp_dir().join(format!("reference-v1-identity-{}", Uuid::new_v4()));
    let path = directory.join("Project.pitchlibrary");
    fs::create_dir(&directory).unwrap();
    let mut session = LibrarySession::create(&path, "Identity proof".into()).unwrap();
    session.close().unwrap();
    let connection = Connection::open(path.join("library.sqlite")).unwrap();
    connection
        .execute(
            "INSERT INTO library_meta (
                id, schema_version, name, library_revision, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'Foreign', 0, 1, 1)",
            params![Uuid::new_v4().to_string(), SCHEMA_VERSION],
        )
        .unwrap();
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    drop(connection);
    let database = path.join("library.sqlite");
    let before = fs::read(&database).unwrap();

    let error = match LibrarySession::open(&path) {
        Ok(_) => panic!("multiple Library identities must be rejected"),
        Err(error) => error,
    };
    assert!(matches!(error, CoreError::DatabaseIntegrity(_)));
    assert_eq!(
        error.to_protocol_error().code,
        "LibraryIntegrityFailedPreserved"
    );
    assert_eq!(fs::read(database).unwrap(), before);
    let _ = fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[test]
fn hostile_writer_lock_links_never_modify_external_bytes() {
    use std::os::unix::fs::{MetadataExt, symlink};

    for hardlinked in [false, true] {
        let directory = std::env::temp_dir().join(format!("reference-v1-lock-{}", Uuid::new_v4()));
        let path = directory.join("Project.pitchlibrary");
        fs::create_dir(&directory).unwrap();
        let mut session = LibrarySession::create(&path, "Lock proof".into()).unwrap();
        session.close().unwrap();
        let sentinel = directory.join("sentinel.txt");
        fs::write(&sentinel, b"do-not-truncate").unwrap();
        let before = fs::metadata(&sentinel).unwrap();
        if hardlinked {
            fs::hard_link(&sentinel, path.join(".writer.lock")).unwrap();
        } else {
            symlink(&sentinel, path.join(".writer.lock")).unwrap();
        }

        let error = match LibrarySession::open(&path) {
            Ok(_) => panic!("hostile writer lock must be rejected"),
            Err(error) => error,
        };
        assert!(matches!(error, CoreError::InvalidManifest(_)));
        assert_eq!(fs::read(&sentinel).unwrap(), b"do-not-truncate");
        let after = fs::metadata(&sentinel).unwrap();
        assert_eq!(after.len(), before.len());
        assert_eq!(after.mode(), before.mode());
        let _ = fs::remove_dir_all(directory);
    }
}

#[cfg(unix)]
#[test]
fn hostile_database_symlink_is_rejected_without_touching_target() {
    use std::os::unix::fs::symlink;

    let directory = std::env::temp_dir().join(format!("reference-v1-db-link-{}", Uuid::new_v4()));
    let path = directory.join("Project.pitchlibrary");
    fs::create_dir(&directory).unwrap();
    let mut session = LibrarySession::create(&path, "Database link proof".into()).unwrap();
    session.close().unwrap();
    fs::rename(path.join("library.sqlite"), directory.join("real.sqlite")).unwrap();
    let sentinel = directory.join("sentinel.txt");
    fs::write(&sentinel, b"not-a-database").unwrap();
    symlink(&sentinel, path.join("library.sqlite")).unwrap();

    let before = fs::read(&sentinel).unwrap();
    let error = match LibrarySession::open(&path) {
        Ok(_) => panic!("hostile database link must be rejected"),
        Err(error) => error,
    };
    assert!(matches!(error, CoreError::DatabaseIntegrity(_)));
    assert_eq!(fs::read(&sentinel).unwrap(), before);
    let _ = fs::remove_dir_all(directory);
}

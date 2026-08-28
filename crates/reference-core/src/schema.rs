use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, OpenFlags, OptionalExtension, params};

use crate::{SCHEMA_VERSION, error::CoreError, manifest::Manifest};

const MIGRATION_0001: &str = include_str!("../../../migrations/0001_t01.sql");
const MIGRATION_0002: &str = include_str!("../../../migrations/0002_v1_domain.sql");
const MIGRATION_0003: &str = include_str!("../../../migrations/0003_rendition_jobs.sql");
const MIGRATION_0004: &str = include_str!("../../../migrations/0004_asset_browser_parity.sql");
const LEDGER: &[(u32, &str, &str)] = &[
    (1, "t01_canonical_slice", "embedded-migration-0001"),
    (
        2,
        "v1_curation_and_flat_collections",
        "679fb0ceb8483bbb486951fb22ac7c5cddb1d80ecfaae188cd17493a1c369f53",
    ),
    (
        3,
        "v1_async_rendition_jobs",
        "6670bc4e3fc09b0489f8c1f35611df625f5d5b69c394a8ff7fa7576933132c94",
    ),
    (
        4,
        "asset_browser_feature_parity",
        "0ea805d7e80ba293de0a86c40ea4a13d67feddcbfe3f725062e49fbce45249cb",
    ),
];
const MIGRATION_SOURCE_DIGESTS: [&str; 4] = [
    "e8302ff0d11a42d0cdbd41abe2194c74dd531ba7174d3da8cd9a2d8bb235f251",
    "f4f14ab8a407870d0aab212f477d80b761a0d30fce72d694c04642e5a5ba5072",
    "1849ba86fb1e97f238db2bc7dfaef8f5e1b3a47f4c50cd1a7ba533fbcc9315b0",
    "d6f233c1b5c28009a36b2d2d7e9e3609eb4c3def8a1efa96a4231e3e677c4beb",
];
const LEGACY_LEDGER_CHECKSUMS: [&[&str]; 4] = [
    &[],
    &["embedded-migration-0002-v1-domain"],
    &["embedded-migration-0003-rendition-jobs"],
    &[],
];

pub fn create_database(path: &Path, manifest: &Manifest) -> Result<Connection, CoreError> {
    validate_embedded_migrations()?;
    let path = canonical_database_path(path)?;
    let connection = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    configure(&connection)?;
    connection.execute_batch(MIGRATION_0001)?;
    connection.execute(
        "INSERT INTO library_meta (
            id, schema_version, name, library_revision, created_at_ms, updated_at_ms
        ) VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        params![
            manifest.library_id,
            1,
            manifest.name,
            manifest.created_at_ms as i64
        ],
    )?;
    validate_migration_ledger(&connection, 1)?;
    apply_pending_migrations(&connection, 1)?;
    post_migration_checks(&connection)?;
    Ok(connection)
}

pub fn open_database(path: &Path, manifest: &Manifest) -> Result<Connection, CoreError> {
    validate_embedded_migrations()?;
    validate_database_storage(path)?;
    let path = canonical_database_path(path)?;
    // Refuse corrupt or tampered bytes through a read-only handle before any
    // connection setting, journal transition, or migration can mutate them.
    let validation = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    validation.busy_timeout(Duration::from_secs(5))?;
    let initial_version = validate_existing(&validation, manifest)?;
    drop(validation);

    let connection = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    let writable_version = validate_existing(&connection, manifest)?;
    if writable_version != initial_version {
        return Err(CoreError::DatabaseIntegrity(
            "database schema changed during validation".into(),
        ));
    }
    configure(&connection)?;
    apply_pending_migrations(&connection, initial_version)?;
    reconcile_library_meta_schema_version(&connection)?;
    post_migration_checks(&connection)?;
    let final_version =
        connection.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?;
    if manifest.schema_version != final_version {
        let mut recovered = manifest.clone();
        recovered.schema_version = final_version;
        let package = path.parent().ok_or_else(|| {
            CoreError::InvalidManifest("database path has no package parent".into())
        })?;
        recovered.write_atomic(package)?;
    }
    Ok(connection)
}

fn canonical_database_path(path: &Path) -> Result<PathBuf, CoreError> {
    let parent = path
        .parent()
        .ok_or_else(|| CoreError::InvalidManifest("database path has no package parent".into()))?;
    let name = path
        .file_name()
        .ok_or_else(|| CoreError::InvalidManifest("database path has no file name".into()))?;
    Ok(parent.canonicalize()?.join(name))
}

fn validate_embedded_migrations() -> Result<(), CoreError> {
    for (index, ((version, _, _), sql)) in LEDGER
        .iter()
        .zip([
            MIGRATION_0001,
            MIGRATION_0002,
            MIGRATION_0003,
            MIGRATION_0004,
        ])
        .enumerate()
    {
        if migration_digest(sql) != MIGRATION_SOURCE_DIGESTS[index] {
            return Err(CoreError::MigrationLedgerInvalid(*version));
        }
    }
    Ok(())
}

fn migration_digest(sql: &str) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(sql.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn validate_existing(connection: &Connection, manifest: &Manifest) -> Result<u32, CoreError> {
    let integrity = connection
        .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .map_err(|error| {
            CoreError::DatabaseIntegrity(format!("database quick_check failed: {error}"))
        })?;
    if integrity != "ok" {
        return Err(CoreError::DatabaseIntegrity(format!(
            "database quick_check failed: {integrity}"
        )));
    }
    let version = connection
        .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
        .map_err(|error| {
            CoreError::DatabaseIntegrity(format!("database schema could not be read: {error}"))
        })?;
    if version == 0 || version > SCHEMA_VERSION {
        return Err(CoreError::SchemaUnsupported {
            actual: version,
            supported: SCHEMA_VERSION,
        });
    }
    validate_migration_ledger(connection, version)?;
    validate_schema_contract(connection, version)?;
    validate_library_identity(connection, manifest, version)?;
    Ok(version)
}

fn validate_library_identity(
    connection: &Connection,
    manifest: &Manifest,
    database_version: u32,
) -> Result<(), CoreError> {
    let identities = connection
        .query_row("SELECT COUNT(*) FROM library_meta", [], |row| {
            row.get::<_, u32>(0)
        })
        .map_err(|error| {
            CoreError::DatabaseIntegrity(format!("Library identity could not be read: {error}"))
        })?;
    if identities != 1 {
        return Err(CoreError::DatabaseIntegrity(
            "canonical database must contain exactly one Library identity".into(),
        ));
    }
    let database_identity: Option<(String, u32)> = connection
        .query_row(
            "SELECT id, schema_version FROM library_meta LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((database_library_id, meta_version)) = database_identity else {
        return Err(CoreError::DatabaseIntegrity(
            "canonical database has no Library identity".into(),
        ));
    };
    if database_library_id != manifest.library_id {
        return Err(CoreError::InvalidManifest(
            "manifest libraryId does not match canonical database".into(),
        ));
    }
    // Releases prior to the atomic migration fix could commit the migration
    // ledger/user_version immediately before this redundant marker. A marker
    // behind the exact validated ledger is recoverable; a zero or future
    // marker is not.
    if meta_version == 0 || meta_version > database_version {
        return Err(CoreError::DatabaseIntegrity(
            "canonical database schema markers disagree".into(),
        ));
    }
    let foreign_rows = connection.query_row(
        "SELECT
             (SELECT COUNT(*) FROM roots WHERE library_id <> ?1) +
             (SELECT COUNT(*) FROM sources WHERE library_id <> ?1) +
             (SELECT COUNT(*) FROM assets WHERE library_id <> ?1) +
             (SELECT COUNT(*) FROM jobs WHERE library_id <> ?1)",
        params![manifest.library_id],
        |row| row.get::<_, i64>(0),
    )?;
    let foreign_collections = if database_version >= 2 {
        connection.query_row(
            "SELECT COUNT(*) FROM collections WHERE library_id <> ?1",
            params![manifest.library_id],
            |row| row.get::<_, i64>(0),
        )?
    } else {
        0
    };
    if foreign_rows < 0 || foreign_collections < 0 || foreign_rows + foreign_collections != 0 {
        return Err(CoreError::DatabaseIntegrity(
            "canonical database contains foreign Library records".into(),
        ));
    }
    Ok(())
}

fn validate_database_storage(path: &Path) -> Result<(), CoreError> {
    validate_database_file(path, true)?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let auxiliary = std::path::PathBuf::from(format!("{}{suffix}", path.to_string_lossy()));
        validate_database_file(&auxiliary, false)?;
    }
    Ok(())
}

fn validate_database_file(path: &Path, required: bool) -> Result<(), CoreError> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if !required && error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CoreError::DatabaseIntegrity(
            "canonical database storage is unsafe".into(),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // Every SQLite-managed file is writable canonical package state. Do
        // not mutate a hardlinked external file or one owned by another user.
        if metadata.nlink() != 1 || metadata.uid() != unsafe { libc::geteuid() } {
            return Err(CoreError::DatabaseIntegrity(
                "canonical database storage is unsafe".into(),
            ));
        }
    }
    Ok(())
}

fn validate_migration_ledger(connection: &Connection, version: u32) -> Result<(), CoreError> {
    let mut statement = connection
        .prepare(
            "SELECT version, name, checksum FROM schema_migrations
             ORDER BY version",
        )
        .map_err(|_| CoreError::MigrationLedgerInvalid(version))?;
    let actual = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| CoreError::MigrationLedgerInvalid(version))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| CoreError::MigrationLedgerInvalid(version))?;
    if actual.len() != version as usize
        || actual.iter().enumerate().any(|(index, actual)| {
            let expected = LEDGER[index];
            actual.0 != expected.0
                || actual.1 != expected.1
                || (actual.2 != expected.2
                    && !LEGACY_LEDGER_CHECKSUMS[index].contains(&actual.2.as_str()))
        })
    {
        return Err(CoreError::MigrationLedgerInvalid(version));
    }
    Ok(())
}

fn validate_schema_contract(connection: &Connection, version: u32) -> Result<(), CoreError> {
    let expected = Connection::open_in_memory()?;
    for sql in [
        MIGRATION_0001,
        MIGRATION_0002,
        MIGRATION_0003,
        MIGRATION_0004,
    ]
    .into_iter()
    .take(version as usize)
    {
        expected.execute_batch(sql)?;
    }
    if schema_contract_rows(connection)? != schema_contract_rows(&expected)? {
        return Err(CoreError::DatabaseIntegrity(
            "canonical database schema does not match the embedded contract".into(),
        ));
    }
    Ok(())
}

fn schema_contract_rows(
    connection: &Connection,
) -> Result<Vec<(String, String, String, String)>, CoreError> {
    let mut statement = connection.prepare(
        "SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
         ORDER BY type, name, tbl_name",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn apply_pending_migrations(
    connection: &Connection,
    initial_version: u32,
) -> Result<(), CoreError> {
    for version in (initial_version + 1)..=SCHEMA_VERSION {
        let sql = match version {
            2 => MIGRATION_0002,
            3 => MIGRATION_0003,
            4 => MIGRATION_0004,
            _ => {
                return Err(CoreError::InvalidManifest(format!(
                    "no embedded migration for schema {version}"
                )));
            }
        };
        connection.execute_batch(sql)?;
        validate_migration_ledger(connection, version)?;
    }
    Ok(())
}

fn reconcile_library_meta_schema_version(connection: &Connection) -> Result<(), CoreError> {
    let version = connection.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?;
    let transaction = connection.unchecked_transaction()?;
    let changed = transaction.execute(
        "UPDATE library_meta SET schema_version = ?1 WHERE schema_version < ?1",
        params![version],
    )?;
    if changed > 1 {
        return Err(CoreError::DatabaseIntegrity(
            "canonical database has multiple Library identities".into(),
        ));
    }
    transaction.commit()?;
    Ok(())
}

fn post_migration_checks(connection: &Connection) -> Result<(), CoreError> {
    let violation: Option<String> = connection
        .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
        .optional()?;
    if violation.is_some() {
        return Err(CoreError::DatabaseIntegrity(
            "database foreign_key_check failed".into(),
        ));
    }
    Ok(())
}

pub fn configure(connection: &Connection) -> Result<(), CoreError> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq, Eq)]
    struct MigrationState {
        user_version: u32,
        meta_version: u32,
        ledger: Vec<(u32, String, String)>,
        schema: Vec<(String, String, String, String)>,
    }

    #[test]
    fn embedded_checksum_rejects_source_drift_before_execution() {
        assert_eq!(
            migration_digest(MIGRATION_0002),
            MIGRATION_SOURCE_DIGESTS[1]
        );
        let altered = MIGRATION_0002.replacen(
            "ALTER TABLE assets ADD COLUMN note TEXT;",
            "ALTER TABLE assets ADD COLUMN note TEXT; -- altered",
            1,
        );
        assert_ne!(migration_digest(&altered), MIGRATION_SOURCE_DIGESTS[1]);
    }

    #[test]
    fn every_v1_migration_boundary_rolls_back_atomically_under_injected_failure() {
        for (initial_version, migration) in [(1, MIGRATION_0002), (2, MIGRATION_0003)] {
            let connection = database_at_version(initial_version);
            let before = migration_state(&connection);
            let injected = migration.replacen(
                "COMMIT;",
                "SELECT * FROM deterministic_injected_migration_failure;\nCOMMIT;",
                1,
            );
            assert_ne!(injected, migration);
            assert!(connection.execute_batch(&injected).is_err());
            // SQLite leaves a failed explicit transaction active for most
            // statement errors. The production connection is dropped on the
            // error path; explicit rollback lets this test inspect the exact
            // pre-migration state on the same handle.
            let _ = connection.execute_batch("ROLLBACK;");
            assert_eq!(migration_state(&connection), before);
            validate_migration_ledger(&connection, initial_version).unwrap();
            validate_schema_contract(&connection, initial_version).unwrap();

            connection.execute_batch(migration).unwrap();
            let after = migration_state(&connection);
            assert_eq!(after.user_version, initial_version + 1);
            assert_eq!(after.meta_version, initial_version + 1);
            validate_migration_ledger(&connection, initial_version + 1).unwrap();
            validate_schema_contract(&connection, initial_version + 1).unwrap();
        }
    }

    fn database_at_version(version: u32) -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(MIGRATION_0001).unwrap();
        connection
            .execute(
                "INSERT INTO library_meta (
                     id, schema_version, name, library_revision, created_at_ms, updated_at_ms
                 ) VALUES ('library-proof', 1, 'Proof', 0, 1, 1)",
                [],
            )
            .unwrap();
        if version >= 2 {
            connection.execute_batch(MIGRATION_0002).unwrap();
        }
        connection
    }

    fn migration_state(connection: &Connection) -> MigrationState {
        let user_version = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        let meta_version = connection
            .query_row("SELECT schema_version FROM library_meta", [], |row| {
                row.get(0)
            })
            .unwrap();
        let ledger = connection
            .prepare("SELECT version,name,checksum FROM schema_migrations ORDER BY version")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        MigrationState {
            user_version,
            meta_version,
            ledger,
            schema: schema_contract_rows(connection).unwrap(),
        }
    }
}

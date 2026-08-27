use std::{path::Path, time::Duration};

use rusqlite::{Connection, OpenFlags, OptionalExtension, params};

use crate::{SCHEMA_VERSION, error::CoreError, manifest::Manifest};

const MIGRATION_0001: &str = include_str!("../../../migrations/0001_t01.sql");
const MIGRATION_0002: &str = include_str!("../../../migrations/0002_v1_domain.sql");
const MIGRATION_0003: &str = include_str!("../../../migrations/0003_rendition_jobs.sql");
const LEDGER: &[(u32, &str, &str)] = &[
    (1, "t01_canonical_slice", "embedded-migration-0001"),
    (
        2,
        "v1_curation_and_flat_collections",
        "embedded-migration-0002-v1-domain",
    ),
    (
        3,
        "v1_async_rendition_jobs",
        "embedded-migration-0003-rendition-jobs",
    ),
];

pub fn create_database(path: &Path, manifest: &Manifest) -> Result<Connection, CoreError> {
    let connection = Connection::open(path)?;
    configure(&connection)?;
    connection.execute_batch(MIGRATION_0001)?;
    connection.execute(
        "INSERT INTO library_meta (
            id, schema_version, name, library_revision, created_at_ms, updated_at_ms
        ) VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        params![
            manifest.library_id,
            manifest.schema_version,
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
    // Refuse corrupt or tampered bytes through a read-only handle before any
    // connection setting, journal transition, or migration can mutate them.
    let validation = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    validation.busy_timeout(Duration::from_secs(5))?;
    let initial_version = validate_existing(&validation, manifest)?;
    drop(validation);

    let connection = Connection::open(path)?;
    let writable_version = validate_existing(&connection, manifest)?;
    if writable_version != initial_version {
        return Err(CoreError::DatabaseIntegrity(
            "database schema changed during validation".into(),
        ));
    }
    configure(&connection)?;
    apply_pending_migrations(&connection, initial_version)?;
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
    validate_library_identity(connection, manifest)?;
    Ok(version)
}

fn validate_library_identity(
    connection: &Connection,
    manifest: &Manifest,
) -> Result<(), CoreError> {
    let database_library_id: Option<String> = connection
        .query_row("SELECT id FROM library_meta LIMIT 1", [], |row| row.get(0))
        .optional()?;
    if database_library_id.as_deref() != Some(manifest.library_id.as_str()) {
        return Err(CoreError::InvalidManifest(
            "manifest libraryId does not match canonical database".into(),
        ));
    }
    Ok(())
}

fn validate_migration_ledger(connection: &Connection, version: u32) -> Result<(), CoreError> {
    let mut statement = connection
        .prepare(
            "SELECT version, name, checksum FROM schema_migrations
             WHERE version BETWEEN 1 AND ?1 ORDER BY version",
        )
        .map_err(|_| CoreError::MigrationLedgerInvalid(version))?;
    let actual = statement
        .query_map(params![version], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| CoreError::MigrationLedgerInvalid(version))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| CoreError::MigrationLedgerInvalid(version))?;
    let expected = LEDGER
        .iter()
        .take(version as usize)
        .map(|(version, name, checksum)| (*version, (*name).to_owned(), (*checksum).to_owned()))
        .collect::<Vec<_>>();
    if actual != expected {
        return Err(CoreError::MigrationLedgerInvalid(version));
    }
    Ok(())
}

fn apply_pending_migrations(
    connection: &Connection,
    initial_version: u32,
) -> Result<(), CoreError> {
    for version in (initial_version + 1)..=SCHEMA_VERSION {
        let sql = match version {
            2 => MIGRATION_0002,
            3 => MIGRATION_0003,
            _ => {
                return Err(CoreError::InvalidManifest(format!(
                    "no embedded migration for schema {version}"
                )));
            }
        };
        connection.execute_batch(sql)?;
        validate_migration_ledger(connection, version)?;
        connection.execute(
            "UPDATE library_meta SET schema_version = ?1 WHERE schema_version <= ?1",
            params![version],
        )?;
    }
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

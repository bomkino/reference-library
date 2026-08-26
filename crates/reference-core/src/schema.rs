use std::{path::Path, time::Duration};

use rusqlite::{Connection, OptionalExtension, params};

use crate::{SCHEMA_VERSION, error::CoreError, manifest::Manifest};

const MIGRATION_0001: &str = include_str!("../../../migrations/0001_t01.sql");

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
    Ok(connection)
}

pub fn open_database(path: &Path, manifest: &Manifest) -> Result<Connection, CoreError> {
    let connection = Connection::open(path)?;
    configure(&connection)?;
    let schema_version =
        connection.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?;
    if schema_version > SCHEMA_VERSION {
        return Err(CoreError::SchemaUnsupported {
            actual: schema_version,
            supported: SCHEMA_VERSION,
        });
    }
    if schema_version != manifest.schema_version {
        return Err(CoreError::InvalidManifest(format!(
            "manifest schema {} does not match database schema {schema_version}",
            manifest.schema_version
        )));
    }
    let database_library_id: Option<String> = connection
        .query_row("SELECT id FROM library_meta LIMIT 1", [], |row| row.get(0))
        .optional()?;
    if database_library_id.as_deref() != Some(manifest.library_id.as_str()) {
        return Err(CoreError::InvalidManifest(
            "manifest libraryId does not match canonical database".into(),
        ));
    }
    let integrity: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(CoreError::InvalidManifest(format!(
            "database quick_check failed: {integrity}"
        )));
    }
    Ok(connection)
}

pub fn configure(connection: &Connection) -> Result<(), CoreError> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

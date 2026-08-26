use rusqlite::Connection;
use serde_json::{Value, json};

use crate::error::CoreError;

pub fn generate(connection: &Connection) -> Result<Value, CoreError> {
    let library = connection.query_row(
        "SELECT id, schema_version, name, library_revision FROM library_meta LIMIT 1",
        [],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "schemaVersion": row.get::<_, u32>(1)?,
                "name": row.get::<_, String>(2)?,
                "libraryRevision": row.get::<_, i64>(3)?,
            }))
        },
    )?;
    Ok(json!({
        "format": "pitchdog-reference-canonical-dump-v1",
        "library": library,
        "roots": rows(connection,
            "SELECT id, display_name, root_kind, state FROM roots ORDER BY id", 4,
            |values| json!({
                "id": values[0], "displayName": values[1],
                "rootKind": values[2], "state": values[3]
            }))?,
        "sources": rows(connection,
            "SELECT id, media_family, current_revision_id, lineage_state FROM sources ORDER BY id", 4,
            |values| json!({
                "id": values[0], "mediaFamily": values[1],
                "currentRevisionId": values[2], "lineageState": values[3]
            }))?,
        "sourceRevisions": rows(connection,
            "SELECT id, source_id, byte_size, quick_fingerprint, mime_detected,
                    extension_observed, media_metadata_json
             FROM source_revisions ORDER BY id", 7,
            |values| json!({
                "id": values[0], "sourceId": values[1], "byteSize": values[2],
                "quickFingerprint": values[3], "mimeDetected": values[4],
                "extensionObserved": values[5], "mediaMetadata": parse_json(&values[6])
            }))?,
        "locations": location_rows(connection)?,
        "assets": rows(connection,
            "SELECT id, custom_title, review_state FROM assets ORDER BY id", 3,
            |values| json!({
                "id": values[0], "customTitle": values[1], "reviewState": values[2]
            }))?,
        "assetOrigins": rows(connection,
            "SELECT id, asset_id, source_id, origin_kind, origin_spec_json,
                    revision_binding FROM asset_origins ORDER BY id", 6,
            |values| json!({
                "id": values[0], "assetId": values[1], "sourceId": values[2],
                "originKind": values[3], "originSpec": parse_json(&values[4]),
                "revisionBinding": values[5]
            }))?,
        "renditions": rows(connection,
            "SELECT id, asset_origin_id, source_revision_id, profile, provider,
                    provider_version, state, error_code FROM renditions ORDER BY id", 8,
            |values| json!({
                "id": values[0], "assetOriginId": values[1],
                "sourceRevisionId": values[2], "profile": values[3],
                "provider": values[4], "providerVersion": values[5],
                "state": values[6], "errorCode": values[7]
            }))?,
        "jobs": rows(connection,
            "SELECT id, job_kind, state, progress_json, error_code FROM jobs ORDER BY id", 5,
            |values| json!({
                "id": values[0], "jobKind": values[1], "state": values[2],
                "progress": parse_json(&values[3]), "errorCode": values[4]
            }))?
    }))
}

fn rows(
    connection: &Connection,
    sql: &str,
    columns: usize,
    project: impl Fn(&[Value]) -> Value,
) -> Result<Vec<Value>, CoreError> {
    let mut statement = connection.prepare(sql)?;
    let values = statement
        .query_map([], |row| {
            let mut result = Vec::with_capacity(columns);
            for index in 0..columns {
                let value = row.get_ref(index)?;
                result.push(match value {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(value) => json!(value),
                    rusqlite::types::ValueRef::Real(value) => json!(value),
                    rusqlite::types::ValueRef::Text(value) => {
                        Value::String(String::from_utf8_lossy(value).into_owned())
                    }
                    rusqlite::types::ValueRef::Blob(value) => Value::String(hex(value)),
                });
            }
            Ok(project(&result))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(values)
}

fn location_rows(connection: &Connection) -> Result<Vec<Value>, CoreError> {
    rows(
        connection,
        "SELECT id, root_id, source_id, relative_path_bytes,
                relative_path_display, state, last_stat_size
         FROM locations ORDER BY id",
        7,
        |values| {
            json!({
                "id": values[0], "rootId": values[1], "sourceId": values[2],
                "relativePathBytesHex": values[3], "relativePathDisplay": values[4],
                "state": values[5], "lastStatSize": values[6]
            })
        },
    )
}

fn parse_json(value: &Value) -> Value {
    value
        .as_str()
        .and_then(|text| serde_json::from_str(text).ok())
        .unwrap_or(Value::Null)
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

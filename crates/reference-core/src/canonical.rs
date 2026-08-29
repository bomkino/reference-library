//! Deterministic projections of durable Library meaning.
//!
//! `generate` is the legacy whole-document T01 diagnostic. V1 evidence uses
//! `digest` plus snapshot-bound, bounded `page` calls so a large Library is
//! never materialized in one control frame.

use reference_protocol::{
    CanonicalAssetOriginRecord, CanonicalAssetRecord, CanonicalCollectionMembershipRecord,
    CanonicalCollectionRecord, CanonicalDigest, CanonicalEntity, CanonicalEntityCount,
    CanonicalLibraryRecord, CanonicalLocationRecord, CanonicalPage, CanonicalRecord,
    CanonicalRootRecord, CanonicalSourceRecord, CanonicalSourceRevisionRecord, CommandResult,
    MAX_CANONICAL_PAGE_SIZE, MAX_FRAME_BYTES, MAX_REQUEST_ID_BYTES, PROTOCOL_VERSION, ServerFrame,
};
use rusqlite::{Connection, Row, params};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use crate::error::CoreError;

const PROJECTION_FORMAT: &str = "pitchdog-reference-canonical-projection-v1";
const DUMP_FORMAT: &str = "pitchdog-reference-canonical-dump-v1";
const DIGEST_DOMAIN: &[u8] = b"pitchdog-reference-canonical-projection\0v1";
const MAX_LEGACY_DUMP_ROWS: i64 = 512;
const MAX_LEGACY_DUMP_SOURCE_BYTES: i64 = 128 * 1024;

const ENTITIES: [CanonicalEntity; 9] = [
    CanonicalEntity::Library,
    CanonicalEntity::Roots,
    CanonicalEntity::Sources,
    CanonicalEntity::SourceRevisions,
    CanonicalEntity::Locations,
    CanonicalEntity::AssetOrigins,
    CanonicalEntity::Assets,
    CanonicalEntity::Collections,
    CanonicalEntity::CollectionMemberships,
];

/// Compute a deterministic digest and per-entity counts from one SQLite read
/// snapshot. Records are streamed through SHA-256 one at a time.
pub fn digest(connection: &Connection) -> Result<CanonicalDigest, CoreError> {
    Ok(digest_with_revision(connection)?.0)
}

/// Compute the semantic digest and conservative durable generation from the
/// same SQLite read snapshot. A session can validate many bounded pages
/// against this pair without re-hashing the whole Library for every window.
pub fn digest_with_revision(connection: &Connection) -> Result<(CanonicalDigest, u64), CoreError> {
    let transaction = connection.unchecked_transaction()?;
    let library_revision =
        transaction.query_row("SELECT library_revision FROM library_meta", [], |row| {
            row.get::<_, i64>(0)
        })?;
    if library_revision < 0 {
        return Err(CoreError::DatabaseIntegrity(
            "Library revision is invalid".into(),
        ));
    }
    let result = digest_snapshot(&transaction)?;
    transaction.commit()?;
    Ok((result, library_revision as u64))
}

/// Return one bounded diagnostic page, but only when the caller's digest still
/// describes the same durable read snapshot. Operational writes excluded from
/// canonical meaning are intentionally allowed between digest and page calls.
pub fn page(
    connection: &Connection,
    snapshot_digest: &str,
    entity: CanonicalEntity,
    cursor: Option<&str>,
    limit: u32,
) -> Result<CanonicalPage, CoreError> {
    let transaction = connection.unchecked_transaction()?;
    let current = digest_snapshot(&transaction)?;
    if current.digest != snapshot_digest {
        return Err(CoreError::CanonicalSnapshotChanged);
    }
    let result = page_from_snapshot(&transaction, &current, entity, cursor, limit)?;
    transaction.commit()?;
    Ok(result)
}

/// Return a page from a digest already computed by this session. The durable
/// generation check and page query share one read transaction. Any canonical
/// write necessarily advances that generation; operational writes may cause a
/// conservative retry but can never yield a mixed semantic proof.
pub fn page_verified(
    connection: &Connection,
    snapshot: &CanonicalDigest,
    expected_library_revision: u64,
    entity: CanonicalEntity,
    cursor: Option<&str>,
    limit: u32,
) -> Result<CanonicalPage, CoreError> {
    if limit == 0 || limit > MAX_CANONICAL_PAGE_SIZE {
        return Err(CoreError::QueryPageTooLarge(limit));
    }
    let transaction = connection.unchecked_transaction()?;
    let actual_revision =
        transaction.query_row("SELECT library_revision FROM library_meta", [], |row| {
            row.get::<_, i64>(0)
        })?;
    if actual_revision < 0 || actual_revision as u64 != expected_library_revision {
        return Err(CoreError::CanonicalSnapshotChanged);
    }
    let result = page_from_snapshot(&transaction, snapshot, entity, cursor, limit)?;
    transaction.commit()?;
    Ok(result)
}

fn page_from_snapshot(
    connection: &Connection,
    current: &CanonicalDigest,
    entity: CanonicalEntity,
    cursor: Option<&str>,
    limit: u32,
) -> Result<CanonicalPage, CoreError> {
    if limit == 0 || limit > MAX_CANONICAL_PAGE_SIZE {
        return Err(CoreError::QueryPageTooLarge(limit));
    }
    let offset = decode_cursor(cursor)?;

    let total = current
        .counts
        .iter()
        .find(|entry| entry.entity == entity)
        .map(|entry| entry.count)
        .unwrap_or_default();
    if offset > total {
        return Err(CoreError::QueryInvalid(
            "canonical cursor is outside this entity snapshot".into(),
        ));
    }

    let mut records = Vec::with_capacity(limit as usize);
    let mut record_content_bytes = 0_usize;
    let mut first_record_exceeds_frame = false;
    visit_records(connection, entity, Some((offset, limit)), |record| {
        let record_bytes = serde_json::to_vec(&record)?.len();
        let candidate_count = records.len() as u64 + 1;
        let candidate_next_cursor =
            (offset + candidate_count < total).then(|| encode_cursor(offset + candidate_count));
        let empty_envelope_bytes = empty_page_envelope_size(
            &current.digest,
            entity,
            cursor,
            limit,
            total,
            candidate_next_cursor,
        )?;
        let separator_bytes = usize::from(!records.is_empty());
        let candidate_record_bytes = record_content_bytes
            .saturating_add(separator_bytes)
            .saturating_add(record_bytes);
        if empty_envelope_bytes.saturating_add(candidate_record_bytes) > MAX_FRAME_BYTES {
            first_record_exceeds_frame = records.is_empty();
            return Ok(false);
        }
        record_content_bytes = candidate_record_bytes;
        records.push(record);
        Ok(true)
    })?;
    if first_record_exceeds_frame {
        return Err(CoreError::QueryInvalid(
            "canonical record exceeds framed response limit".into(),
        ));
    }
    let returned = records.len() as u64;
    let next_cursor = (offset + returned < total).then(|| encode_cursor(offset + returned));
    let result = CanonicalPage {
        format: PROJECTION_FORMAT.into(),
        snapshot_digest: current.digest.clone(),
        entity,
        cursor: cursor.map(str::to_owned),
        limit,
        total,
        records,
        next_cursor,
    };
    if page_envelope_size(&result)? > MAX_FRAME_BYTES {
        return Err(CoreError::QueryInvalid(
            "canonical page exceeds framed response limit".into(),
        ));
    }
    Ok(result)
}

fn empty_page_envelope_size(
    snapshot_digest: &str,
    entity: CanonicalEntity,
    cursor: Option<&str>,
    limit: u32,
    total: u64,
    next_cursor: Option<String>,
) -> Result<usize, CoreError> {
    page_envelope_size(&CanonicalPage {
        format: PROJECTION_FORMAT.into(),
        snapshot_digest: snapshot_digest.into(),
        entity,
        cursor: cursor.map(str::to_owned),
        limit,
        total,
        records: Vec::new(),
        next_cursor,
    })
}

fn page_envelope_size(page: &CanonicalPage) -> Result<usize, CoreError> {
    let frame = ServerFrame::Response {
        protocol_version: PROTOCOL_VERSION,
        request_id: "r".repeat(MAX_REQUEST_ID_BYTES),
        result: Box::new(CommandResult::CanonicalPage(page.clone())),
    };
    Ok(serde_json::to_vec(&frame)?.len())
}

fn digest_snapshot(connection: &Connection) -> Result<CanonicalDigest, CoreError> {
    let mut hasher = Sha256::new();
    frame(&mut hasher, DIGEST_DOMAIN);
    let mut counts = Vec::with_capacity(ENTITIES.len());
    for entity in ENTITIES {
        let count = entity_count(connection, entity)?;
        frame(&mut hasher, entity_name(entity).as_bytes());
        frame(&mut hasher, &count.to_be_bytes());
        visit_records(connection, entity, None, |record| {
            let bytes = canonical_json(&record)?;
            frame(&mut hasher, &bytes);
            Ok(true)
        })?;
        counts.push(CanonicalEntityCount { entity, count });
    }
    Ok(CanonicalDigest {
        format: PROJECTION_FORMAT.into(),
        algorithm: "sha256".into(),
        digest: format!("sha256:{}", hex(&hasher.finalize())),
        counts,
    })
}

fn frame(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

fn canonical_json(record: &CanonicalRecord) -> Result<Vec<u8>, CoreError> {
    let value = serde_json::to_value(record)?;
    let mut output = Vec::new();
    write_canonical_json(&value, &mut output)?;
    Ok(output)
}

fn write_canonical_json(value: &Value, output: &mut Vec<u8>) -> Result<(), CoreError> {
    match value {
        Value::Null => output.extend_from_slice(b"null"),
        Value::Bool(value) => output.extend_from_slice(if *value { b"true" } else { b"false" }),
        Value::Number(value) => output.extend_from_slice(value.to_string().as_bytes()),
        Value::String(value) => serde_json::to_writer(output, value)?,
        Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                write_canonical_json(value, output)?;
            }
            output.push(b']');
        }
        Value::Object(values) => {
            output.push(b'{');
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            for (index, key) in keys.into_iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                serde_json::to_writer(&mut *output, key)?;
                output.push(b':');
                write_canonical_json(&values[key], output)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

fn entity_count(connection: &Connection, entity: CanonicalEntity) -> Result<u64, CoreError> {
    let table = match entity {
        CanonicalEntity::Library => "library_meta",
        CanonicalEntity::Roots => "roots",
        CanonicalEntity::Sources => "sources",
        CanonicalEntity::SourceRevisions => "source_revisions",
        CanonicalEntity::Locations => "locations",
        CanonicalEntity::AssetOrigins => "asset_origins",
        CanonicalEntity::Assets => "assets",
        CanonicalEntity::Collections => "collections",
        CanonicalEntity::CollectionMemberships => "collection_assets",
    };
    let count = connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get::<_, i64>(0)
    })?;
    Ok(count as u64)
}

fn entity_name(entity: CanonicalEntity) -> &'static str {
    match entity {
        CanonicalEntity::Library => "library",
        CanonicalEntity::Roots => "roots",
        CanonicalEntity::Sources => "sources",
        CanonicalEntity::SourceRevisions => "source_revisions",
        CanonicalEntity::Locations => "locations",
        CanonicalEntity::AssetOrigins => "asset_origins",
        CanonicalEntity::Assets => "assets",
        CanonicalEntity::Collections => "collections",
        CanonicalEntity::CollectionMemberships => "collection_memberships",
    }
}

fn visit_records(
    connection: &Connection,
    entity: CanonicalEntity,
    window: Option<(u64, u32)>,
    mut visit: impl FnMut(CanonicalRecord) -> Result<bool, CoreError>,
) -> Result<(), CoreError> {
    let (offset, limit) = window
        .map(|(offset, limit)| (offset as i64, limit as i64))
        .unwrap_or((0, i64::MAX));

    macro_rules! visit_query {
        ($sql:expr, $map:expr) => {{
            let sql = format!("{} LIMIT ?1 OFFSET ?2", $sql);
            let mut statement = connection.prepare(&sql)?;
            let mut rows = statement.query(params![limit, offset])?;
            while let Some(row) = rows.next()? {
                if !visit(($map)(row)?)? {
                    break;
                }
            }
        }};
    }

    match entity {
        CanonicalEntity::Library => visit_query!(
            "SELECT id, name FROM library_meta ORDER BY id",
            |row: &Row<'_>| -> rusqlite::Result<CanonicalRecord> {
                Ok(CanonicalRecord::Library(CanonicalLibraryRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                }))
            }
        ),
        CanonicalEntity::Roots => visit_query!(
            "SELECT id, display_name, root_kind FROM roots ORDER BY id",
            |row: &Row<'_>| -> rusqlite::Result<CanonicalRecord> {
                Ok(CanonicalRecord::Root(CanonicalRootRecord {
                    id: row.get(0)?,
                    display_name: row.get(1)?,
                    root_kind: row.get(2)?,
                }))
            }
        ),
        CanonicalEntity::Sources => visit_query!(
            "SELECT id, media_family, current_revision_id FROM sources ORDER BY id",
            |row: &Row<'_>| -> rusqlite::Result<CanonicalRecord> {
                Ok(CanonicalRecord::Source(CanonicalSourceRecord {
                    id: row.get(0)?,
                    media_family: row.get(1)?,
                    current_revision_id: row.get(2)?,
                }))
            }
        ),
        CanonicalEntity::SourceRevisions => visit_query!(
            "SELECT id, source_id, byte_size, quick_fingerprint, mime_detected,
                    extension_observed, media_metadata_json
             FROM source_revisions ORDER BY id",
            |row: &Row<'_>| -> rusqlite::Result<CanonicalRecord> {
                Ok(CanonicalRecord::SourceRevision(
                    CanonicalSourceRevisionRecord {
                        id: row.get(0)?,
                        source_id: row.get(1)?,
                        byte_size: row.get::<_, i64>(2)? as u64,
                        quick_fingerprint: row.get(3)?,
                        mime_detected: row.get(4)?,
                        extension_observed: row.get(5)?,
                        media_metadata: json_column(row, 6)?,
                    },
                ))
            }
        ),
        CanonicalEntity::Locations => visit_query!(
            "SELECT id, root_id, source_id, relative_path_bytes, relative_path_display
             FROM locations ORDER BY id",
            |row: &Row<'_>| -> rusqlite::Result<CanonicalRecord> {
                Ok(CanonicalRecord::Location(CanonicalLocationRecord {
                    id: row.get(0)?,
                    root_id: row.get(1)?,
                    source_id: row.get(2)?,
                    relative_path_bytes_hex: hex(&row.get::<_, Vec<u8>>(3)?),
                    relative_path_display: row.get(4)?,
                }))
            }
        ),
        CanonicalEntity::AssetOrigins => visit_query!(
            "SELECT id, asset_id, source_id, origin_kind, origin_spec_json, revision_binding
             FROM asset_origins ORDER BY id",
            |row: &Row<'_>| -> rusqlite::Result<CanonicalRecord> {
                Ok(CanonicalRecord::AssetOrigin(CanonicalAssetOriginRecord {
                    id: row.get(0)?,
                    asset_id: row.get(1)?,
                    source_id: row.get(2)?,
                    origin_kind: row.get(3)?,
                    origin_spec: json_column(row, 4)?,
                    revision_binding: row.get(5)?,
                }))
            }
        ),
        CanonicalEntity::Assets => visit_query!(
            "SELECT id, custom_title, review_state, note, tags_json, used_in_json
             FROM assets ORDER BY id",
            |row: &Row<'_>| -> rusqlite::Result<CanonicalRecord> {
                Ok(CanonicalRecord::Asset(CanonicalAssetRecord {
                    id: row.get(0)?,
                    custom_title: row.get(1)?,
                    review_state: row.get(2)?,
                    note: row.get(3)?,
                    tags: string_list_column(row, 4)?,
                    used_in: string_list_column(row, 5)?,
                }))
            }
        ),
        CanonicalEntity::Collections => visit_query!(
            "SELECT id, name FROM collections ORDER BY id",
            |row: &Row<'_>| -> rusqlite::Result<CanonicalRecord> {
                Ok(CanonicalRecord::Collection(CanonicalCollectionRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                }))
            }
        ),
        CanonicalEntity::CollectionMemberships => visit_query!(
            "SELECT collection_id, asset_id FROM collection_assets
             ORDER BY collection_id, asset_id",
            |row: &Row<'_>| -> rusqlite::Result<CanonicalRecord> {
                Ok(CanonicalRecord::CollectionMembership(
                    CanonicalCollectionMembershipRecord {
                        collection_id: row.get(0)?,
                        asset_id: row.get(1)?,
                    },
                ))
            }
        ),
    }
    Ok(())
}

fn json_column(row: &Row<'_>, index: usize) -> rusqlite::Result<Value> {
    let text: String = row.get(index)?;
    let value = serde_json::from_str(&text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    Ok(normalize_json(value))
}

fn string_list_column(row: &Row<'_>, index: usize) -> rusqlite::Result<Vec<String>> {
    let text: String = row.get(index)?;
    serde_json::from_str(&text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn normalize_json(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(normalize_json).collect()),
        Value::Object(values) => {
            let mut entries = values.into_iter().collect::<Vec<_>>();
            entries.sort_unstable_by(|left, right| left.0.cmp(&right.0));
            let mut normalized = Map::new();
            for (key, value) in entries {
                normalized.insert(key, normalize_json(value));
            }
            Value::Object(normalized)
        }
        value => value,
    }
}

fn decode_cursor(cursor: Option<&str>) -> Result<u64, CoreError> {
    match cursor {
        None => Ok(0),
        Some(value)
            if !value.is_empty()
                && value.bytes().all(|byte| byte.is_ascii_digit())
                && (value == "0" || !value.starts_with('0')) =>
        {
            value
                .parse::<u64>()
                .map_err(|_| CoreError::QueryInvalid("canonical cursor is malformed".into()))
        }
        Some(_) => Err(CoreError::QueryInvalid(
            "canonical cursor is malformed".into(),
        )),
    }
}

fn encode_cursor(offset: u64) -> String {
    offset.to_string()
}

/// Legacy whole-document diagnostic retained for T01/T02 compatibility.
pub fn generate(connection: &Connection) -> Result<Value, CoreError> {
    legacy_dump_preflight(connection)?;
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
    let dump = json!({
        "format": DUMP_FORMAT,
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
            "SELECT id, custom_title, review_state, note, tags_json, used_in_json FROM assets ORDER BY id", 6,
            |values| json!({
                "id": values[0], "customTitle": values[1], "reviewState": values[2],
                "note": values[3], "tags": parse_json(&values[4]), "usedIn": parse_json(&values[5])
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
    });
    let frame = ServerFrame::Response {
        protocol_version: PROTOCOL_VERSION,
        request_id: "r".repeat(MAX_REQUEST_ID_BYTES),
        result: Box::new(CommandResult::CanonicalDump { dump: dump.clone() }),
    };
    if serde_json::to_vec(&frame)?.len() > MAX_FRAME_BYTES {
        return Err(CoreError::CanonicalDumpTooLarge);
    }
    Ok(dump)
}

fn legacy_dump_preflight(connection: &Connection) -> Result<(), CoreError> {
    let (rows, source_bytes) = connection.query_row(
        "SELECT
           (SELECT COUNT(*) FROM roots) +
           (SELECT COUNT(*) FROM sources) +
           (SELECT COUNT(*) FROM source_revisions) +
           (SELECT COUNT(*) FROM locations) +
           (SELECT COUNT(*) FROM assets) +
           (SELECT COUNT(*) FROM asset_origins) +
           (SELECT COUNT(*) FROM renditions) +
           (SELECT COUNT(*) FROM jobs),
           COALESCE((SELECT SUM(bytes) FROM (
             SELECT length(CAST(id AS BLOB))+length(CAST(name AS BLOB)) AS bytes
               FROM library_meta
             UNION ALL SELECT length(CAST(id AS BLOB))+length(CAST(display_name AS BLOB))+
                    length(CAST(root_kind AS BLOB))+length(CAST(state AS BLOB)) FROM roots
             UNION ALL SELECT length(CAST(id AS BLOB))+length(CAST(media_family AS BLOB))+
                    COALESCE(length(CAST(current_revision_id AS BLOB)),0)+
                    length(CAST(lineage_state AS BLOB)) FROM sources
             UNION ALL SELECT length(CAST(id AS BLOB))+length(CAST(source_id AS BLOB))+
                    COALESCE(length(CAST(quick_fingerprint AS BLOB)),0)+
                    COALESCE(length(CAST(mime_detected AS BLOB)),0)+
                    COALESCE(length(CAST(extension_observed AS BLOB)),0)+
                    length(CAST(media_metadata_json AS BLOB)) FROM source_revisions
             UNION ALL SELECT length(CAST(id AS BLOB))+length(CAST(root_id AS BLOB))+
                    length(CAST(source_id AS BLOB))+(2*length(relative_path_bytes))+
                    COALESCE(length(CAST(relative_path_display AS BLOB)),0)+
                    length(CAST(state AS BLOB)) FROM locations
             UNION ALL SELECT length(CAST(id AS BLOB))+
                    COALESCE(length(CAST(custom_title AS BLOB)),0)+
                    length(CAST(review_state AS BLOB))+
                    COALESCE(length(CAST(note AS BLOB)),0)+
                    length(CAST(tags_json AS BLOB))+length(CAST(used_in_json AS BLOB)) FROM assets
             UNION ALL SELECT length(CAST(id AS BLOB))+length(CAST(asset_id AS BLOB))+
                    length(CAST(source_id AS BLOB))+length(CAST(origin_kind AS BLOB))+
                    length(CAST(origin_spec_json AS BLOB))+
                    length(CAST(revision_binding AS BLOB)) FROM asset_origins
             UNION ALL SELECT length(CAST(id AS BLOB))+length(CAST(asset_origin_id AS BLOB))+
                    length(CAST(source_revision_id AS BLOB))+length(CAST(profile AS BLOB))+
                    length(CAST(provider AS BLOB))+length(CAST(provider_version AS BLOB))+
                    length(CAST(state AS BLOB))+COALESCE(length(CAST(error_code AS BLOB)),0)
                    FROM renditions
             UNION ALL SELECT length(CAST(id AS BLOB))+length(CAST(job_kind AS BLOB))+
                    length(CAST(state AS BLOB))+length(CAST(progress_json AS BLOB))+
                    COALESCE(length(CAST(error_code AS BLOB)),0) FROM jobs
           )),0)",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    if rows < 0
        || source_bytes < 0
        || rows > MAX_LEGACY_DUMP_ROWS
        || source_bytes > MAX_LEGACY_DUMP_SOURCE_BYTES
    {
        return Err(CoreError::CanonicalDumpTooLarge);
    }
    Ok(())
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

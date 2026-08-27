use std::path::Path;

use reference_protocol::{
    AssetDetail, AssetPage, AssetPatch, AssetProjection, AssetQuery, AssetSort, AvailabilityFilter,
    CollectionSummary, JobPage, JobQuery, JobState, MAX_COLLECTION_MEMBERSHIP_BATCH,
    MAX_COLLECTION_NAME_CHARS, MAX_JOB_PAGE_SIZE, MAX_NOTE_CHARS, MAX_PAGE_SIZE, MAX_SEARCH_CHARS,
    MAX_TITLE_CHARS, ReviewState, TextPatch,
};
use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use uuid::Uuid;

use crate::{error::CoreError, now_ms, session::bump_revision};

pub fn query_assets(
    connection: &Connection,
    library_id: &str,
    offset: u64,
    limit: u32,
    _projection: AssetProjection,
    query: &AssetQuery,
) -> Result<AssetPage, CoreError> {
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(CoreError::QueryPageTooLarge(limit));
    }
    validate_query(connection, library_id, query)?;

    let mut values = vec![Value::Text(library_id.to_owned())];
    let mut cte_filters = Vec::new();
    if let Some(root_id) = &query.root_id {
        values.push(Value::Text(root_id.clone()));
        cte_filters.push(format!("l.root_id = ?{}", values.len()));
    }
    let location_filter = if cte_filters.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", cte_filters.join(" AND "))
    };

    let cte = format!(
        "WITH preferred_locations AS (
            SELECT ao.asset_id, l.id AS location_id, l.relative_path_display,
                   l.state, s.media_family, a.created_at_ms,
                   ROW_NUMBER() OVER (
                       PARTITION BY ao.asset_id
                       ORDER BY CASE l.state WHEN 'present' THEN 0 ELSE 1 END,
                                l.created_at_ms, l.id
                   ) AS location_rank
            FROM assets a
            JOIN asset_origins ao ON ao.asset_id = a.id
            JOIN sources s ON s.id = ao.source_id
            JOIN locations l ON l.source_id = s.id
            {location_filter}
        )"
    );
    let mut where_parts = vec![
        "a.library_id = ?1".to_owned(),
        "pl.location_rank = 1".to_owned(),
    ];

    if let Some(search) = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        // Deliberately keep the caller's Unicode code points intact. SQLite's
        // built-in lower/LIKE fold ASCII only, which gives deterministic exact
        // matching for non-ASCII text instead of a Rust/SQLite fold mismatch.
        values.push(Value::Text(format!("%{}%", escape_like(search))));
        let index = values.len();
        where_parts.push(format!(
            "(lower(COALESCE(a.custom_title, '')) LIKE lower(?{index}) ESCAPE '\\'
              OR lower(pl.relative_path_display) LIKE lower(?{index}) ESCAPE '\\'
              OR lower(COALESCE(a.note, '')) LIKE lower(?{index}) ESCAPE '\\')"
        ));
    }
    if !query.review_states.is_empty() {
        let slots = push_text_values(
            &mut values,
            query.review_states.iter().map(|state| state.as_str()),
        );
        where_parts.push(format!("a.review_state IN ({slots})"));
    }
    if !query.availability.is_empty() {
        let states = query.availability.iter().flat_map(|state| match state {
            AvailabilityFilter::Present => vec!["present"],
            AvailabilityFilter::Missing => vec!["missing"],
            AvailabilityFilter::NeedsPermission => vec!["permission_denied"],
            AvailabilityFilter::Unavailable => vec!["moved_candidate"],
            AvailabilityFilter::OfflineVolume => vec!["offline_root"],
            AvailabilityFilter::Unreadable => vec!["unreadable"],
        });
        let slots = push_text_values(&mut values, states);
        where_parts.push(format!("pl.state IN ({slots})"));
    }
    if let Some(collection_id) = &query.collection_id {
        validate_uuid(collection_id, CoreError::CollectionNotFound)?;
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM collections WHERE id = ?1 AND library_id = ?2)",
            params![collection_id, library_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(CoreError::CollectionNotFound);
        }
        values.push(Value::Text(collection_id.clone()));
        where_parts.push(format!(
            "EXISTS (SELECT 1 FROM collection_assets ca
                      WHERE ca.asset_id = a.id AND ca.collection_id = ?{})",
            values.len()
        ));
    }

    let from = format!(
        "FROM assets a JOIN preferred_locations pl ON pl.asset_id = a.id
         WHERE {}",
        where_parts.join(" AND ")
    );
    let order = match query.sort {
        AssetSort::CreatedAscending => "a.created_at_ms ASC, a.id ASC",
        AssetSort::CreatedDescending => "a.created_at_ms DESC, a.id DESC",
        AssetSort::NameAscending => {
            "lower(COALESCE(a.custom_title, pl.relative_path_display)) ASC, a.id ASC"
        }
        AssetSort::NameDescending => {
            "lower(COALESCE(a.custom_title, pl.relative_path_display)) DESC, a.id DESC"
        }
        AssetSort::ReviewState => "a.review_state ASC, a.created_at_ms ASC, a.id ASC",
    };

    let transaction = connection.unchecked_transaction()?;
    let total_sql = format!("{cte} SELECT COUNT(*) {from}");
    let total = transaction.query_row(&total_sql, params_from_iter(values.iter()), |row| {
        row.get::<_, i64>(0)
    })? as u64;

    let mut page_values = values;
    page_values.push(Value::Integer(limit as i64));
    let limit_slot = page_values.len();
    page_values.push(Value::Integer(offset as i64));
    let offset_slot = page_values.len();
    let sql = format!(
        "{cte} SELECT a.id, pl.location_id, pl.relative_path_display, pl.media_family,
                pl.state, a.review_state, a.custom_title, a.revision
         {from} ORDER BY {order} LIMIT ?{limit_slot} OFFSET ?{offset_slot}"
    );
    let mut statement = transaction.prepare(&sql)?;
    let items = statement
        .query_map(params_from_iter(page_values.iter()), |row| {
            let relative_display_path: String = row.get(2)?;
            Ok(reference_protocol::AssetSummary {
                asset_id: row.get(0)?,
                location_id: row.get(1)?,
                display_name: display_name(&relative_display_path),
                relative_display_path,
                media_family: row.get(3)?,
                availability: row.get(4)?,
                review_state: row.get(5)?,
                custom_title: row.get(6)?,
                revision: row.get::<_, i64>(7)? as u64,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let library_revision = transaction.query_row(
        "SELECT library_revision FROM library_meta WHERE id = ?1",
        params![library_id],
        |row| row.get::<_, i64>(0),
    )? as u64;
    transaction.commit()?;

    let returned = items.len() as u64;
    Ok(AssetPage {
        offset,
        limit,
        total,
        items,
        next_offset: (offset + returned < total).then_some(offset + returned),
        library_revision,
    })
}

pub fn get_asset(
    connection: &Connection,
    library_id: &str,
    asset_id: &str,
) -> Result<AssetDetail, CoreError> {
    validate_uuid(asset_id, CoreError::AssetNotFound)?;
    let transaction = connection.unchecked_transaction()?;
    let detail = asset_detail(&transaction, library_id, asset_id)?;
    transaction.commit()?;
    Ok(detail)
}

pub fn update_asset(
    connection: &Connection,
    library_id: &str,
    asset_id: &str,
    expected_revision: u64,
    patch: AssetPatch,
) -> Result<(AssetDetail, u64), CoreError> {
    validate_uuid(asset_id, CoreError::AssetNotFound)?;
    let title_patch = normalize_text_patch(patch.custom_title, MAX_TITLE_CHARS, true)?;
    let note_patch = normalize_text_patch(patch.note, MAX_NOTE_CHARS, false)?;
    let timestamp = now_ms() as i64;
    let transaction = connection.unchecked_transaction()?;
    let current = transaction
        .query_row(
            "SELECT custom_title, review_state, note, revision
             FROM assets WHERE id = ?1 AND library_id = ?2",
            params![asset_id, library_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)? as u64,
                ))
            },
        )
        .optional()?
        .ok_or(CoreError::AssetNotFound)?;
    if current.3 != expected_revision {
        return Err(CoreError::AssetRevisionConflict {
            expected: expected_revision,
            actual: current.3,
        });
    }
    let custom_title = apply_patch(current.0, title_patch);
    let note = apply_patch(current.2, note_patch);
    let review_state = patch
        .review_state
        .map(ReviewState::as_str)
        .unwrap_or(current.1.as_str());
    transaction.execute(
        "UPDATE assets SET custom_title = ?1, review_state = ?2, note = ?3,
                           revision = revision + 1, updated_at_ms = ?4
         WHERE id = ?5 AND library_id = ?6 AND revision = ?7",
        params![
            custom_title,
            review_state,
            note,
            timestamp,
            asset_id,
            library_id,
            expected_revision as i64
        ],
    )?;
    let library_revision = bump_revision(&transaction, timestamp)?;
    let detail = asset_detail(&transaction, library_id, asset_id)?;
    transaction.commit()?;
    Ok((detail, library_revision))
}

pub fn query_jobs(
    connection: &Connection,
    library_id: &str,
    offset: u64,
    limit: u32,
    query: &JobQuery,
) -> Result<JobPage, CoreError> {
    if limit == 0 || limit > MAX_JOB_PAGE_SIZE {
        return Err(CoreError::QueryPageTooLarge(limit));
    }
    let mut values = vec![Value::Text(library_id.to_owned())];
    let mut where_parts = vec!["library_id = ?1".to_owned()];
    if let Some(root_id) = &query.root_id {
        validate_root(connection, library_id, root_id)?;
        values.push(Value::Text(root_id.clone()));
        where_parts.push(format!("root_id = ?{}", values.len()));
    }
    if !query.states.is_empty() {
        let slots = push_text_values(&mut values, query.states.iter().map(|s| s.as_str()));
        where_parts.push(format!("state IN ({slots})"));
    }
    let base = format!("FROM jobs WHERE {}", where_parts.join(" AND "));
    let total = connection.query_row(
        &format!("SELECT COUNT(*) {base}"),
        params_from_iter(values.iter()),
        |row| row.get::<_, i64>(0),
    )? as u64;
    values.push(Value::Integer(limit as i64));
    let limit_slot = values.len();
    values.push(Value::Integer(offset as i64));
    let offset_slot = values.len();
    let mut statement = connection.prepare(&format!(
        "SELECT id, root_id, job_kind, state, progress_json, error_code,
                created_at_ms, updated_at_ms, finished_at_ms
         {base} ORDER BY created_at_ms DESC, id DESC
         LIMIT ?{limit_slot} OFFSET ?{offset_slot}"
    ))?;
    let items = statement
        .query_map(params_from_iter(values.iter()), |row| {
            let progress: String = row.get(4)?;
            let progress: serde_json::Value = serde_json::from_str(&progress).unwrap_or_default();
            let state_text: String = row.get(3)?;
            Ok(reference_protocol::JobSummary {
                job_id: row.get(0)?,
                root_id: row.get(1)?,
                job_kind: row.get(2)?,
                state: parse_job_state(&state_text),
                observed_count: progress["observedCount"].as_u64().unwrap_or_default(),
                unsupported_count: progress["unsupportedCount"].as_u64().unwrap_or_default(),
                error_code: row.get(5)?,
                created_at_ms: row.get::<_, i64>(6)? as u64,
                updated_at_ms: row.get::<_, i64>(7)? as u64,
                finished_at_ms: row.get::<_, Option<i64>>(8)?.map(|v| v as u64),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let returned = items.len() as u64;
    Ok(JobPage {
        offset,
        limit,
        total,
        items,
        next_offset: (offset + returned < total).then_some(offset + returned),
    })
}

pub fn list_collections(
    connection: &Connection,
    library_id: &str,
) -> Result<Vec<CollectionSummary>, CoreError> {
    let mut statement = connection.prepare(
        "SELECT c.id, c.name, COUNT(ca.asset_id), c.revision
         FROM collections c LEFT JOIN collection_assets ca ON ca.collection_id = c.id
         WHERE c.library_id = ?1 GROUP BY c.id, c.name, c.revision
         ORDER BY lower(c.name), c.id",
    )?;
    Ok(statement
        .query_map(params![library_id], collection_summary_row)?
        .collect::<Result<Vec<_>, _>>()?)
}

pub fn create_collection(
    connection: &Connection,
    library_id: &str,
    name: &str,
) -> Result<(CollectionSummary, u64), CoreError> {
    let name = normalize_collection_name(name)?;
    ensure_collection_name_available(connection, library_id, None, &name)?;
    let id = Uuid::new_v4().to_string();
    let timestamp = now_ms() as i64;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "INSERT INTO collections (id, library_id, name, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, library_id, name, timestamp],
    )?;
    let revision = bump_revision(&transaction, timestamp)?;
    let collection = collection_by_id(&transaction, library_id, &id)?;
    transaction.commit()?;
    Ok((collection, revision))
}

pub fn rename_collection(
    connection: &Connection,
    library_id: &str,
    collection_id: &str,
    expected_revision: u64,
    name: &str,
) -> Result<(CollectionSummary, u64), CoreError> {
    validate_uuid(collection_id, CoreError::CollectionNotFound)?;
    let name = normalize_collection_name(name)?;
    let existing = collection_by_id(connection, library_id, collection_id)?;
    if existing.revision != expected_revision {
        return Err(CoreError::CollectionRevisionConflict {
            expected: expected_revision,
            actual: existing.revision,
        });
    }
    ensure_collection_name_available(connection, library_id, Some(collection_id), &name)?;
    let timestamp = now_ms() as i64;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "UPDATE collections SET name = ?1, revision = revision + 1, updated_at_ms = ?2
         WHERE id = ?3 AND library_id = ?4 AND revision = ?5",
        params![
            name,
            timestamp,
            collection_id,
            library_id,
            expected_revision as i64
        ],
    )?;
    let revision = bump_revision(&transaction, timestamp)?;
    let collection = collection_by_id(&transaction, library_id, collection_id)?;
    transaction.commit()?;
    Ok((collection, revision))
}

pub fn delete_collection(
    connection: &Connection,
    library_id: &str,
    collection_id: &str,
) -> Result<u64, CoreError> {
    validate_uuid(collection_id, CoreError::CollectionNotFound)?;
    let timestamp = now_ms() as i64;
    let transaction = connection.unchecked_transaction()?;
    let changed = transaction.execute(
        "DELETE FROM collections WHERE id = ?1 AND library_id = ?2",
        params![collection_id, library_id],
    )?;
    if changed == 0 {
        return Err(CoreError::CollectionNotFound);
    }
    let revision = bump_revision(&transaction, timestamp)?;
    transaction.commit()?;
    Ok(revision)
}

pub fn set_collection_membership(
    connection: &Connection,
    library_id: &str,
    collection_id: &str,
    asset_ids: &[String],
    member: bool,
) -> Result<(u64, u64), CoreError> {
    validate_uuid(collection_id, CoreError::CollectionNotFound)?;
    if asset_ids.is_empty() || asset_ids.len() > MAX_COLLECTION_MEMBERSHIP_BATCH {
        return Err(CoreError::CollectionMembershipInvalid(
            "assetIds must contain between 1 and 250 IDs".into(),
        ));
    }
    let mut unique = asset_ids.to_vec();
    unique.sort();
    unique.dedup();
    if unique.len() != asset_ids.len() {
        return Err(CoreError::CollectionMembershipInvalid(
            "assetIds must not contain duplicates".into(),
        ));
    }
    for id in &unique {
        validate_uuid(
            id,
            CoreError::CollectionMembershipInvalid("invalid Asset ID".into()),
        )?;
    }
    let timestamp = now_ms() as i64;
    let transaction = connection.unchecked_transaction()?;
    collection_by_id(&transaction, library_id, collection_id)?;
    let mut statement = transaction
        .prepare("SELECT EXISTS(SELECT 1 FROM assets WHERE id = ?1 AND library_id = ?2)")?;
    for id in &unique {
        let exists: bool = statement.query_row(params![id, library_id], |row| row.get(0))?;
        if !exists {
            return Err(CoreError::CollectionMembershipInvalid(
                "an Asset was not found".into(),
            ));
        }
    }
    drop(statement);
    let mut affected = 0_u64;
    for id in &unique {
        let changed = if member {
            transaction.execute(
                "INSERT OR IGNORE INTO collection_assets (collection_id, asset_id, added_at_ms)
                 VALUES (?1, ?2, ?3)",
                params![collection_id, id, timestamp],
            )?
        } else {
            transaction.execute(
                "DELETE FROM collection_assets WHERE collection_id = ?1 AND asset_id = ?2",
                params![collection_id, id],
            )?
        };
        affected += changed as u64;
    }
    let revision = if affected > 0 {
        transaction.execute(
            "UPDATE collections SET revision = revision + 1, updated_at_ms = ?1
             WHERE id = ?2",
            params![timestamp, collection_id],
        )?;
        bump_revision(&transaction, timestamp)?
    } else {
        transaction.query_row(
            "SELECT library_revision FROM library_meta WHERE id = ?1",
            params![library_id],
            |row| row.get::<_, i64>(0),
        )? as u64
    };
    transaction.commit()?;
    Ok((affected, revision))
}

fn asset_detail(
    connection: &Connection,
    library_id: &str,
    asset_id: &str,
) -> Result<AssetDetail, CoreError> {
    let mut detail = connection
        .query_row(
            "WITH preferred_location AS (
                SELECT l.id, l.relative_path_display, l.state, s.media_family,
                       ROW_NUMBER() OVER (
                           ORDER BY CASE l.state WHEN 'present' THEN 0 ELSE 1 END,
                                    l.created_at_ms, l.id
                       ) AS location_rank
                FROM asset_origins ao
                JOIN sources s ON s.id = ao.source_id
                JOIN locations l ON l.source_id = s.id
                WHERE ao.asset_id = ?1
             )
             SELECT a.id, pl.id, pl.relative_path_display, pl.media_family, pl.state,
                    a.review_state, a.custom_title, a.note, a.revision
             FROM assets a JOIN preferred_location pl ON pl.location_rank = 1
             WHERE a.id = ?1 AND a.library_id = ?2",
            params![asset_id, library_id],
            |row| {
                let relative_display_path: String = row.get(2)?;
                Ok(AssetDetail {
                    asset_id: row.get(0)?,
                    location_id: row.get(1)?,
                    original_display_name: display_name(&relative_display_path),
                    relative_display_path,
                    media_family: row.get(3)?,
                    availability: row.get(4)?,
                    review_state: row.get(5)?,
                    custom_title: row.get(6)?,
                    note: row.get(7)?,
                    revision: row.get::<_, i64>(8)? as u64,
                    collection_ids: Vec::new(),
                })
            },
        )
        .optional()?
        .ok_or(CoreError::AssetNotFound)?;
    let mut statement = connection.prepare(
        "SELECT collection_id FROM collection_assets WHERE asset_id = ?1 ORDER BY collection_id",
    )?;
    detail.collection_ids = statement
        .query_map(params![asset_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(detail)
}

fn validate_query(
    connection: &Connection,
    library_id: &str,
    query: &AssetQuery,
) -> Result<(), CoreError> {
    if let Some(search) = &query.search
        && (search.chars().count() > MAX_SEARCH_CHARS || search.contains('\0'))
    {
        return Err(CoreError::QueryInvalid("search text is invalid".into()));
    }
    if query.review_states.len() > 4 || query.availability.len() > 4 {
        return Err(CoreError::QueryInvalid("filter list is too large".into()));
    }
    if let Some(root_id) = &query.root_id {
        validate_root(connection, library_id, root_id)?;
    }
    Ok(())
}

fn validate_root(
    connection: &Connection,
    library_id: &str,
    root_id: &str,
) -> Result<(), CoreError> {
    validate_uuid(root_id, CoreError::RootNotFound)?;
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM roots WHERE id = ?1 AND library_id = ?2)",
        params![root_id, library_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(CoreError::RootNotFound);
    }
    Ok(())
}

fn normalize_text_patch(
    patch: TextPatch,
    max_chars: usize,
    trim_nonblank: bool,
) -> Result<TextPatch, CoreError> {
    match patch {
        TextPatch::Set(value) => {
            if value.contains('\0') || value.chars().count() > max_chars {
                return Err(CoreError::QueryInvalid("editorial text is invalid".into()));
            }
            if value.trim().is_empty() {
                Ok(TextPatch::Clear)
            } else if trim_nonblank {
                Ok(TextPatch::Set(value.trim().to_owned()))
            } else {
                Ok(TextPatch::Set(value))
            }
        }
        other => Ok(other),
    }
}

fn apply_patch(current: Option<String>, patch: TextPatch) -> Option<String> {
    match patch {
        TextPatch::Unchanged => current,
        TextPatch::Clear => None,
        TextPatch::Set(value) => Some(value),
    }
}

fn normalize_collection_name(name: &str) -> Result<String, CoreError> {
    let name = name.trim();
    if name.is_empty() || name.contains('\0') || name.chars().count() > MAX_COLLECTION_NAME_CHARS {
        return Err(CoreError::CollectionMembershipInvalid(
            "Collection name is invalid".into(),
        ));
    }
    Ok(name.to_owned())
}

fn ensure_collection_name_available(
    connection: &Connection,
    library_id: &str,
    except_id: Option<&str>,
    name: &str,
) -> Result<(), CoreError> {
    let conflict: bool = connection.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM collections
             WHERE library_id = ?1 AND lower(name) = lower(?2)
               AND (?3 IS NULL OR id <> ?3)
         )",
        params![library_id, name, except_id],
        |row| row.get(0),
    )?;
    if conflict {
        return Err(CoreError::CollectionNameConflict);
    }
    Ok(())
}

fn collection_by_id(
    connection: &Connection,
    library_id: &str,
    collection_id: &str,
) -> Result<CollectionSummary, CoreError> {
    connection
        .query_row(
            "SELECT c.id, c.name, COUNT(ca.asset_id), c.revision
             FROM collections c LEFT JOIN collection_assets ca ON ca.collection_id = c.id
             WHERE c.id = ?1 AND c.library_id = ?2 GROUP BY c.id, c.name, c.revision",
            params![collection_id, library_id],
            collection_summary_row,
        )
        .optional()?
        .ok_or(CoreError::CollectionNotFound)
}

fn collection_summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CollectionSummary> {
    Ok(CollectionSummary {
        collection_id: row.get(0)?,
        name: row.get(1)?,
        asset_count: row.get::<_, i64>(2)? as u64,
        revision: row.get::<_, i64>(3)? as u64,
    })
}

fn parse_job_state(value: &str) -> JobState {
    match value {
        "queued" => JobState::Queued,
        "running" => JobState::Running,
        "completed" => JobState::Completed,
        "failed" => JobState::Failed,
        "cancelled" => JobState::Cancelled,
        _ => JobState::Failed,
    }
}

fn validate_uuid(value: &str, error: CoreError) -> Result<(), CoreError> {
    if value.contains('/') || value.contains('\\') || value.contains("..") || value.contains(':') {
        return Err(error);
    }
    Uuid::parse_str(value).map_err(|_| error)?;
    Ok(())
}

fn push_text_values<'a>(
    values: &mut Vec<Value>,
    items: impl IntoIterator<Item = &'a str>,
) -> String {
    let mut slots = Vec::new();
    for item in items {
        values.push(Value::Text(item.to_owned()));
        slots.push(format!("?{}", values.len()));
    }
    slots.join(",")
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn display_name(relative_display_path: &str) -> String {
    Path::new(relative_display_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(relative_display_path)
        .to_owned()
}

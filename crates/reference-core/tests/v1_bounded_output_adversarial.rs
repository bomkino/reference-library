use std::collections::BTreeSet;

use reference_core::canonical;
use reference_protocol::{
    CanonicalEntity, CanonicalRecord, CommandResult, MAX_CANONICAL_PAGE_SIZE, MAX_FRAME_BYTES,
    MAX_NOTE_CHARS, MAX_REQUEST_ID_BYTES, MAX_TITLE_CHARS, PROTOCOL_VERSION, ServerFrame,
    write_frame,
};
use rusqlite::{Connection, params};

const MIGRATION_0001: &str = include_str!("../../../migrations/0001_t01.sql");
const MIGRATION_0002: &str = include_str!("../../../migrations/0002_v1_domain.sql");
const MIGRATION_0003: &str = include_str!("../../../migrations/0003_rendition_jobs.sql");

#[test]
fn worst_case_canonical_asset_pages_fit_the_public_frame_without_gaps() {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch(MIGRATION_0001).unwrap();
    connection
        .execute(
            "INSERT INTO library_meta (
                id, schema_version, name, library_revision, created_at_ms, updated_at_ms
             ) VALUES ('00000000-0000-4000-8000-000000000001', 1, 'Bounded', 0, 1, 1)",
            [],
        )
        .unwrap();
    connection.execute_batch(MIGRATION_0002).unwrap();
    connection.execute_batch(MIGRATION_0003).unwrap();

    let note = "🧪".repeat(MAX_NOTE_CHARS);
    let title = "界".repeat(MAX_TITLE_CHARS);
    let transaction = connection.unchecked_transaction().unwrap();
    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO assets (
                    id, library_id, custom_title, review_state, created_at_ms,
                    updated_at_ms, note, revision
                 ) VALUES (?1, '00000000-0000-4000-8000-000000000001', ?2,
                           'unreviewed', ?3, ?3, ?4, 0)",
            )
            .unwrap();
        for index in 0..MAX_CANONICAL_PAGE_SIZE {
            statement
                .execute(params![
                    format!("00000000-0000-4000-8000-{index:012}"),
                    title,
                    i64::from(index),
                    note,
                ])
                .unwrap();
        }
    }
    transaction.commit().unwrap();

    let digest = canonical::digest(&connection).unwrap();
    let mut cursor = None;
    let mut observed = BTreeSet::new();
    let mut page_count = 0;
    loop {
        let page = canonical::page(
            &connection,
            &digest.digest,
            CanonicalEntity::Assets,
            cursor.as_deref(),
            MAX_CANONICAL_PAGE_SIZE,
        )
        .unwrap();
        assert!(!page.records.is_empty());
        assert_eq!(page.total, u64::from(MAX_CANONICAL_PAGE_SIZE));
        for record in &page.records {
            let CanonicalRecord::Asset(asset) = record else {
                panic!("asset page returned a non-Asset record")
            };
            assert!(observed.insert(asset.id.clone()), "duplicate Asset record");
        }

        let frame = ServerFrame::Response {
            protocol_version: PROTOCOL_VERSION,
            request_id: "r".repeat(MAX_REQUEST_ID_BYTES),
            result: CommandResult::CanonicalPage(page.clone()),
        };
        let mut encoded = Vec::new();
        write_frame(&mut encoded, &frame).unwrap();
        assert!(encoded.len() <= MAX_FRAME_BYTES + 4);

        page_count += 1;
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert!(
        page_count > 1,
        "fixture must exercise byte-budget pagination"
    );
    assert_eq!(observed.len(), MAX_CANONICAL_PAGE_SIZE as usize);
}

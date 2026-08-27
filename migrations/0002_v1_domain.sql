BEGIN IMMEDIATE;

ALTER TABLE assets ADD COLUMN note TEXT;
ALTER TABLE assets ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN root_id TEXT REFERENCES roots(id) ON DELETE SET NULL;

CREATE INDEX jobs_root_state_idx ON jobs(root_id, state, created_at_ms);

CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    name TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(library_id, name)
) STRICT;

CREATE INDEX collections_library_order_idx
    ON collections(library_id, created_at_ms, id);

CREATE TABLE collection_assets (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    added_at_ms INTEGER NOT NULL,
    PRIMARY KEY(collection_id, asset_id)
) STRICT;

CREATE INDEX collection_assets_asset_idx ON collection_assets(asset_id);

UPDATE library_meta SET schema_version = 2;

INSERT INTO schema_migrations (
    version, name, applied_at_ms, application_version, checksum
) VALUES (2, 'v1_curation_and_flat_collections', 0, '0.1.0',
          'embedded-migration-0002-v1-domain');

PRAGMA user_version = 2;
COMMIT;

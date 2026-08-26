PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

BEGIN IMMEDIATE;

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at_ms INTEGER NOT NULL,
    application_version TEXT NOT NULL,
    checksum TEXT NOT NULL
) STRICT;

CREATE TABLE library_meta (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    name TEXT NOT NULL,
    library_revision INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE roots (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    root_kind TEXT NOT NULL CHECK (root_kind IN ('linked', 'embedded')),
    last_known_display_path TEXT,
    state TEXT NOT NULL CHECK (state IN (
        'connected', 'scanning', 'ready', 'needs_permission',
        'offline_volume', 'unavailable', 'error'
    )),
    scan_policy_json TEXT NOT NULL DEFAULT '{}',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    last_seen_at_ms INTEGER
) STRICT;

CREATE INDEX roots_library_idx ON roots(library_id);

CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    media_family TEXT NOT NULL,
    current_revision_id TEXT,
    lineage_state TEXT NOT NULL DEFAULT 'active'
        CHECK (lineage_state IN ('active', 'missing', 'archived')),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX sources_library_idx ON sources(library_id);

CREATE TABLE source_revisions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    mtime_observed_ms INTEGER,
    quick_fingerprint TEXT,
    mime_detected TEXT NOT NULL,
    extension_observed TEXT,
    media_metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX source_revisions_source_idx
    ON source_revisions(source_id, created_at_ms DESC);

CREATE TABLE locations (
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    relative_path_bytes BLOB NOT NULL,
    relative_path_display TEXT NOT NULL,
    platform_file_id BLOB,
    platform_file_id_kind TEXT,
    state TEXT NOT NULL CHECK (state IN (
        'present', 'missing', 'permission_denied', 'offline_root',
        'unreadable', 'moved_candidate'
    )),
    last_stat_size INTEGER,
    last_stat_mtime_ms INTEGER,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(root_id, relative_path_bytes)
) STRICT;

CREATE INDEX locations_source_idx ON locations(source_id);
CREATE INDEX locations_root_state_idx ON locations(root_id, state);

CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    custom_title TEXT,
    review_state TEXT NOT NULL DEFAULT 'unreviewed'
        CHECK (review_state IN ('unreviewed', 'keep', 'maybe', 'reject')),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX assets_library_order_idx ON assets(library_id, created_at_ms, id);

CREATE TABLE asset_origins (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    origin_kind TEXT NOT NULL CHECK (origin_kind = 'whole'),
    origin_spec_json TEXT NOT NULL DEFAULT '{"kind":"whole"}',
    revision_binding TEXT NOT NULL CHECK (revision_binding = 'latest'),
    created_at_ms INTEGER NOT NULL,
    UNIQUE(asset_id, source_id, origin_kind)
) STRICT;

CREATE INDEX asset_origins_source_idx ON asset_origins(source_id);

CREATE TABLE renditions (
    id TEXT PRIMARY KEY,
    asset_origin_id TEXT NOT NULL REFERENCES asset_origins(id) ON DELETE CASCADE,
    source_revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE CASCADE,
    profile TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_version TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'ready', 'failed', 'evicted')),
    error_code TEXT,
    created_at_ms INTEGER NOT NULL,
    UNIQUE(asset_origin_id, source_revision_id, profile, provider, provider_version)
) STRICT;

CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    job_kind TEXT NOT NULL CHECK (job_kind = 'initial_scan'),
    state TEXT NOT NULL CHECK (state IN (
        'queued', 'running', 'completed', 'failed', 'cancelled'
    )),
    progress_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    finished_at_ms INTEGER
) STRICT;

CREATE INDEX jobs_state_idx ON jobs(state, created_at_ms);

CREATE TABLE app_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    library_revision INTEGER NOT NULL,
    event_kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
) STRICT;

INSERT INTO schema_migrations (
    version, name, applied_at_ms, application_version, checksum
) VALUES (1, 't01_canonical_slice', 0, '0.1.0', 'embedded-migration-0001');

PRAGMA user_version = 1;
COMMIT;

BEGIN IMMEDIATE;

DROP INDEX jobs_state_idx;
DROP INDEX jobs_root_state_idx;
ALTER TABLE jobs RENAME TO jobs_schema_2;

CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    job_kind TEXT NOT NULL CHECK (job_kind IN ('initial_scan', 'rendition_generation')),
    state TEXT NOT NULL CHECK (state IN (
        'queued', 'running', 'completed', 'failed', 'cancelled'
    )),
    progress_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    finished_at_ms INTEGER,
    root_id TEXT REFERENCES roots(id) ON DELETE SET NULL
) STRICT;

INSERT INTO jobs (
    id, library_id, job_kind, state, progress_json, error_code,
    created_at_ms, updated_at_ms, finished_at_ms, root_id
)
SELECT id, library_id, job_kind, state, progress_json, error_code,
       created_at_ms, updated_at_ms, finished_at_ms, root_id
FROM jobs_schema_2;

DROP TABLE jobs_schema_2;
CREATE INDEX jobs_state_idx ON jobs(state, created_at_ms);
CREATE INDEX jobs_root_state_idx ON jobs(root_id, state, created_at_ms);

UPDATE library_meta SET schema_version = 3;

INSERT INTO schema_migrations (
    version, name, applied_at_ms, application_version, checksum
) VALUES (3, 'v1_async_rendition_jobs', 0, '0.1.0',
          'embedded-migration-0003-rendition-jobs');

PRAGMA user_version = 3;
COMMIT;

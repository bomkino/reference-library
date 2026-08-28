BEGIN IMMEDIATE;

ALTER TABLE assets ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE assets ADD COLUMN used_in_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX source_revisions_extension_idx
    ON source_revisions(extension_observed, source_id);
CREATE INDEX source_revisions_size_idx
    ON source_revisions(byte_size, source_id);
CREATE INDEX sources_media_family_idx
    ON sources(media_family, library_id);

UPDATE library_meta SET schema_version = 4;

INSERT INTO schema_migrations (
    version, name, applied_at_ms, application_version, checksum
) VALUES (4, 'asset_browser_feature_parity', 0, '0.2.0',
          '0ea805d7e80ba293de0a86c40ea4a13d67feddcbfe3f725062e49fbce45249cb');

PRAGMA user_version = 4;
COMMIT;

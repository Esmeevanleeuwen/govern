\set ON_ERROR_STOP on
\getenv reader PG_READ_USER
\getenv writer PG_USER
\getenv sql_role PG_SQL_USER
\getenv restorer PG_RESTORE_USER
BEGIN;
-- The foundation script must have established and validated this namespace first.
SELECT signature FROM :"studio_schema"._govern_studio_migrations WHERE version=1;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('govern-dictation-migration:' || current_database() || ':' || :'studio_schema',0));
SELECT to_regclass(format('%I._govern_dictation_migrations', :'studio_schema')) IS NOT NULL AS dictation_initialized \gset
\if :dictation_initialized
SELECT count(*)=1 AND bool_and(version=1 AND signature='govern-dictation-v1') AS dictation_supported FROM :"studio_schema"._govern_dictation_migrations \gset
\if :dictation_supported
\else
\echo Unsupported dictation migration; no changes applied.
\quit 1
\endif
\else
CREATE TABLE :"studio_schema"._govern_dictation_migrations(version integer PRIMARY KEY,signature text NOT NULL);
CREATE TABLE :"studio_schema"._govern_dictation_recordings (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    filename text NOT NULL CHECK (octet_length(filename) BETWEEN 1 AND 500),
    sha256 text NOT NULL UNIQUE CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    audio bytea NOT NULL CHECK (octet_length(audio) BETWEEN 1 AND 16777216),
    duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 1 AND 1800000),
    next_ms integer NOT NULL DEFAULT 0 CHECK (next_ms >= 0 AND next_ms <= duration_ms),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE :"studio_schema"._govern_dictation_segments (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    recording_id uuid NOT NULL REFERENCES :"studio_schema"._govern_dictation_recordings(id) ON DELETE CASCADE,
    sequence integer NOT NULL CHECK (sequence BETWEEN 0 AND 300),
    start_ms integer NOT NULL CHECK (start_ms>=0),
    end_ms integer NOT NULL CHECK (end_ms>start_ms AND end_ms<=1800000),
    text text NOT NULL CHECK (octet_length(text)<=8000),
    provider text NOT NULL DEFAULT 'whisper',
    UNIQUE(recording_id,sequence)
);
CREATE VIEW :"studio_schema".dictation_recordings AS
SELECT id,filename,sha256,duration_ms,next_ms,status,created_at FROM :"studio_schema"._govern_dictation_recordings;
CREATE VIEW :"studio_schema".dictation_transcripts AS
SELECT s.*,r.filename FROM :"studio_schema"._govern_dictation_segments s
JOIN :"studio_schema"._govern_dictation_recordings r ON r.id=s.recording_id;
CREATE INDEX ON :"studio_schema"._govern_dictation_recordings(created_at DESC);
INSERT INTO :"studio_schema"._govern_dictation_migrations VALUES(1,'govern-dictation-v1');
\endif
SELECT format('GRANT SELECT ON %I.dictation_recordings,%I.dictation_transcripts TO %I', :'studio_schema', :'studio_schema', role_name)
FROM unnest(ARRAY[:'reader',:'writer',:'sql_role',:'restorer']) AS roles(role_name) \gexec
SELECT format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I._govern_dictation_recordings,%I._govern_dictation_segments TO %I', :'studio_schema', :'studio_schema', role_name)
FROM unnest(ARRAY[:'writer',:'sql_role',:'restorer']) AS roles(role_name) \gexec
COMMIT;

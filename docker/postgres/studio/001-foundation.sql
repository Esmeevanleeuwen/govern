\set ON_ERROR_STOP on
-- Run only with the private PostgreSQL bootstrap account. No web-request DDL.
\getenv reader PG_READ_USER
\getenv writer PG_USER
\getenv sql_role PG_SQL_USER
\getenv restorer PG_RESTORE_USER
\getenv configured_schemas PG_SCHEMAS

BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('govern-studio-migration:' || current_database() || ':' || :'studio_schema',0));
SELECT pg_catalog.set_config('govern.studio_schema', :'studio_schema', true);
SELECT pg_catalog.set_config('govern.studio_schemas', :'configured_schemas', true);
DO $$
DECLARE target text := current_setting('govern.studio_schema');
BEGIN
    IF target !~ '^[A-Za-z_][A-Za-z0-9_]{0,62}$' OR target IN ('public','information_schema') OR target LIKE 'pg\_%' ESCAPE '\' THEN
        RAISE EXCEPTION 'Studio requires a separate, non-system schema using letters, digits and underscores.';
    END IF;
    IF NOT target = ANY(string_to_array(replace(current_setting('govern.studio_schemas'),' ',''),',')) THEN
        RAISE EXCEPTION 'Studio schema must be explicitly included in PG_SCHEMAS.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=target)
       AND to_regclass(format('%I._govern_studio_migrations',target)) IS NULL
       AND (EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=target)
         OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=target)
         OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=target)) THEN
        RAISE EXCEPTION 'Studio will not adopt or replace an existing nonempty schema.';
    END IF;
END $$;
SELECT format('CREATE SCHEMA %I', :'studio_schema') WHERE NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=:'studio_schema') \gexec
SELECT to_regclass(format('%I._govern_studio_migrations', :'studio_schema')) IS NOT NULL AS studio_initialized \gset
\if :studio_initialized
DO $$
DECLARE valid boolean; target text := current_setting('govern.studio_schema');
BEGIN
    EXECUTE format('SELECT count(*)=1 AND bool_and(version=1 AND signature=%L) FROM %I._govern_studio_migrations','govern-studio-foundation-v1',target) INTO valid;
    IF NOT valid THEN RAISE EXCEPTION 'Unsupported Studio migration version; no changes were applied.'; END IF;
END $$;
\else
CREATE TABLE :"studio_schema"._govern_studio_migrations (
    version integer PRIMARY KEY,
    signature text NOT NULL,
    installation_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE :"studio_schema"._govern_studio_boards (
    id uuid PRIMARY KEY,
    title text NOT NULL CHECK (octet_length(title) BETWEEN 1 AND 300 AND btrim(title)<>''),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON :"studio_schema"._govern_studio_boards (updated_at DESC,id);
CREATE TABLE :"studio_schema"._govern_studio_recordings (
    board_id uuid NOT NULL REFERENCES :"studio_schema"._govern_studio_boards(id) ON DELETE CASCADE,
    id uuid NOT NULL,
    status text NOT NULL DEFAULT 'recording' CHECK (status IN ('recording','stopped')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    stopped_at timestamptz,
    PRIMARY KEY (board_id,id),
    CHECK ((status='recording' AND stopped_at IS NULL) OR (status='stopped' AND stopped_at IS NOT NULL))
);
CREATE TABLE :"studio_schema"._govern_studio_segments (
    board_id uuid NOT NULL,
    id uuid NOT NULL,
    recording_id uuid NOT NULL,
    sequence integer NOT NULL CHECK (sequence BETWEEN 0 AND 10000),
    start_ms bigint NOT NULL CHECK (start_ms BETWEEN 0 AND 86400000),
    end_ms bigint NOT NULL CHECK (end_ms BETWEEN 1 AND 86400000 AND end_ms>start_ms AND end_ms-start_ms<=12000),
    text text NOT NULL CHECK (octet_length(text)<=8000),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    provider text NOT NULL CHECK (octet_length(provider) BETWEEN 1 AND 128),
    operation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (board_id,id),
    UNIQUE (board_id,recording_id,sequence),
    UNIQUE (operation_id),
    FOREIGN KEY (board_id,recording_id) REFERENCES :"studio_schema"._govern_studio_recordings(board_id,id) ON DELETE CASCADE
);
CREATE TABLE :"studio_schema"._govern_studio_nodes (
    board_id uuid NOT NULL REFERENCES :"studio_schema"._govern_studio_boards(id) ON DELETE CASCADE,
    id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('note','idea','screen','stroke')),
    text text NOT NULL DEFAULT '' CHECK (octet_length(text)<=8000),
    x double precision NOT NULL CHECK (x BETWEEN -1000000 AND 1000000),
    y double precision NOT NULL CHECK (y BETWEEN -1000000 AND 1000000),
    width double precision NOT NULL CHECK (width BETWEEN 1 AND 10000),
    height double precision NOT NULL CHECK (height BETWEEN 1 AND 10000),
    data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data)='object' AND octet_length(data::text)<=131072),
    version bigint NOT NULL DEFAULT 1 CHECK (version>0),
    source_segment_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (board_id,id),
    UNIQUE (board_id,source_segment_id),
    FOREIGN KEY (board_id,source_segment_id) REFERENCES :"studio_schema"._govern_studio_segments(board_id,id)
);
CREATE TABLE :"studio_schema"._govern_studio_edges (
    board_id uuid NOT NULL REFERENCES :"studio_schema"._govern_studio_boards(id) ON DELETE CASCADE,
    id uuid NOT NULL,
    from_node_id uuid NOT NULL,
    to_node_id uuid NOT NULL,
    label text NOT NULL DEFAULT '' CHECK (octet_length(label)<=512),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (board_id,id),
    FOREIGN KEY (board_id,from_node_id) REFERENCES :"studio_schema"._govern_studio_nodes(board_id,id) ON DELETE CASCADE,
    FOREIGN KEY (board_id,to_node_id) REFERENCES :"studio_schema"._govern_studio_nodes(board_id,id) ON DELETE CASCADE,
    CHECK (from_node_id<>to_node_id)
);
CREATE INDEX ON :"studio_schema"._govern_studio_edges (board_id,from_node_id);
CREATE INDEX ON :"studio_schema"._govern_studio_edges (board_id,to_node_id);
CREATE TABLE :"studio_schema"._govern_studio_operations (
    id uuid PRIMARY KEY,
    board_id uuid NOT NULL REFERENCES :"studio_schema"._govern_studio_boards(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('create-board','mutate','start-recording')),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL CHECK (jsonb_typeof(response)='object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON :"studio_schema"._govern_studio_operations (board_id,created_at);

-- Deliberately non-updatable: aggregate/join views expose data to Govern's regular catalog.
CREATE VIEW :"studio_schema".studio_boards AS
SELECT b.id,b.title,b.revision,b.created_at,b.updated_at,count(n.id) AS objects
FROM :"studio_schema"._govern_studio_boards b LEFT JOIN :"studio_schema"._govern_studio_nodes n ON n.board_id=b.id
GROUP BY b.id;
CREATE VIEW :"studio_schema".studio_notes AS
SELECT n.id,n.board_id,b.title AS board_title,n.kind,n.text,n.x,n.y,n.width,n.height,n.version,n.source_segment_id,
       s.recording_id,s.start_ms,s.end_ms,n.created_at,n.updated_at
FROM :"studio_schema"._govern_studio_nodes n JOIN :"studio_schema"._govern_studio_boards b ON b.id=n.board_id
LEFT JOIN :"studio_schema"._govern_studio_segments s ON s.board_id=n.board_id AND s.id=n.source_segment_id;
CREATE VIEW :"studio_schema".studio_transcripts AS
SELECT s.id,s.board_id,b.title AS board_title,s.recording_id,s.sequence,s.start_ms,s.end_ms,s.text,s.provider,s.sha256,s.created_at
FROM :"studio_schema"._govern_studio_segments s JOIN :"studio_schema"._govern_studio_boards b ON b.id=s.board_id;
INSERT INTO :"studio_schema"._govern_studio_migrations (version,signature) VALUES (1,'govern-studio-foundation-v1');
\endif

-- These roles already exist; Studio never creates accounts, replaces passwords or grants globally.
SELECT format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', :'studio_schema') \gexec
SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', :'studio_schema') \gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'studio_schema', role_name)
FROM unnest(ARRAY[:'reader',:'writer',:'sql_role',:'restorer']) AS roles(role_name) \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', :'studio_schema', :'reader') \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', :'studio_schema', :'writer') \gexec
SELECT format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE %I.%I TO %I', :'studio_schema', table_name, :'writer')
FROM unnest(ARRAY['_govern_studio_boards','_govern_studio_nodes','_govern_studio_edges','_govern_studio_recordings','_govern_studio_segments','_govern_studio_operations']) AS tables(table_name) \gexec
-- Native snapshots use the existing SQL/restore rights, identical to other configured work schemas.
SELECT format('GRANT USAGE,CREATE ON SCHEMA %I TO %I', :'studio_schema', role_name)
FROM unnest(ARRAY[:'sql_role',:'restorer']) AS roles(role_name) \gexec
SELECT format('GRANT SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER ON ALL TABLES IN SCHEMA %I TO %I', :'studio_schema', role_name)
FROM unnest(ARRAY[:'sql_role',:'restorer']) AS roles(role_name) \gexec
COMMIT;

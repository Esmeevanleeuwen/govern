-- Only for the explicitly confirmed, disposable PostgreSQL integration database.
\set ON_ERROR_STOP on
DO $$ BEGIN
    IF current_database() <> 'govern_pg' THEN
        RAISE EXCEPTION 'PostgreSQL fixtures require the isolated govern_pg database';
    END IF;
END $$;
\getenv reader PG_READ_USER

CREATE SCHEMA IF NOT EXISTS archive;
CREATE TABLE public.govern_pg_parent (
    tenant_id integer NOT NULL,
    id integer NOT NULL,
    label text NOT NULL,
    PRIMARY KEY (tenant_id, id) INCLUDE (label),
    UNIQUE (id, tenant_id)
);
CREATE TABLE public.govern_pg_child (
    id integer PRIMARY KEY,
    parent_id integer NOT NULL,
    tenant_id integer NOT NULL,
    CONSTRAINT govern_pg_composite_fk FOREIGN KEY (parent_id, tenant_id)
        REFERENCES public.govern_pg_parent (id, tenant_id)
);
CREATE TABLE public.govern_pg_values (
    id bigint PRIMARY KEY,
    label text NOT NULL,
    amount numeric(30,2) NOT NULL,
    metadata jsonb NOT NULL,
    missing text,
    payload bytea,
    active boolean NOT NULL DEFAULT true,
    display_label text GENERATED ALWAYS AS (label || '!') STORED
);
COMMENT ON TABLE public.govern_pg_values IS 'PostgreSQL integration values';
COMMENT ON COLUMN public.govern_pg_values.amount IS 'Exact decimal amount';
CREATE TABLE archive.govern_pg_values (id integer PRIMARY KEY, label text NOT NULL);
CREATE TABLE public._govern_pg_internal_probe (id integer PRIMARY KEY);
CREATE VIEW public.govern_pg_values_view AS SELECT id, label FROM public.govern_pg_values;

INSERT INTO public.govern_pg_parent VALUES (7, 11, 'Parent');
INSERT INTO public.govern_pg_child VALUES (1, 11, 7);
INSERT INTO public.govern_pg_values (id, label, amount, metadata, missing, payload)
VALUES (9007199254740993, 'literal%_value', 123456789012345678901234.12,
        '{"nested":{"value":3},"label":"first"}', NULL, decode('00ff41', 'hex')),
       (9007199254740994, 'Second row', 2.00, '{"label":"second"}', '', NULL);
INSERT INTO archive.govern_pg_values VALUES (1, 'Archive-only row');
GRANT USAGE ON SCHEMA public, archive TO :"reader";
GRANT SELECT ON ALL TABLES IN SCHEMA public, archive TO :"reader";
ANALYZE public.govern_pg_parent, public.govern_pg_child, public.govern_pg_values;

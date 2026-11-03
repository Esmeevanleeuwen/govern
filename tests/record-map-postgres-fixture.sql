-- Only the explicitly isolated govern_pg database used by CI.
\set ON_ERROR_STOP on
DO $$ BEGIN
    IF current_database() <> 'govern_pg' THEN
        RAISE EXCEPTION 'Record-map fixtures require isolated govern_pg';
    END IF;
END $$;
\getenv reader PG_READ_USER
CREATE SCHEMA IF NOT EXISTS archive;
CREATE TABLE archive.zz_record_map_people (id bigint PRIMARY KEY, name text NOT NULL);
INSERT INTO archive.zz_record_map_people VALUES (9007199254740993, 'Archive-only record');
CREATE TABLE public.zz_record_map_people (
    id bigint PRIMARY KEY, name text NOT NULL, manager_id bigint NULL,
    external_id bigint NULL, amount numeric(30,2) NOT NULL DEFAULT 0, notes text NULL, payload bytea NULL,
    CONSTRAINT zz_record_map_people_manager FOREIGN KEY (manager_id) REFERENCES public.zz_record_map_people(id),
    CONSTRAINT zz_record_map_people_external FOREIGN KEY (external_id) REFERENCES archive.zz_record_map_people(id)
);
INSERT INTO public.zz_record_map_people (id,name,manager_id,external_id,amount,notes,payload) VALUES
    (0,'Zero',NULL,NULL,0,NULL,NULL),
    (9007199254740993,'Atlas%_',NULL,9007199254740993,123456789012345678901234.12,
        '<img src=x onerror="window.mapInjected=1">',decode('00ff41','hex')),
    (9007199254740994,'Beta',9007199254740993,NULL,2.00,'',NULL),
    (9007199254740995,'Gamma',NULL,NULL,3.00,NULL,NULL);
UPDATE public.zz_record_map_people SET manager_id=id WHERE id=9007199254740993;
CREATE TABLE public.zz_record_map_projects (
    tenant_id integer NOT NULL, id integer NOT NULL, name text NOT NULL, lead_id bigint NULL,
    PRIMARY KEY (tenant_id,id) INCLUDE (name), UNIQUE (id,tenant_id),
    CONSTRAINT zz_record_map_project_lead FOREIGN KEY (lead_id) REFERENCES public.zz_record_map_people(id)
);
INSERT INTO public.zz_record_map_projects VALUES (7,11,'Project Alpha',9007199254740993),
    (7,12,'Project Beta',9007199254740993),(8,11,'Other tenant',9007199254740994);
CREATE TABLE public.zz_record_map_tasks (
    id integer PRIMARY KEY, name text NOT NULL, project_id integer NULL, tenant_id integer NOT NULL,
    CONSTRAINT zz_record_map_task_project FOREIGN KEY (project_id,tenant_id) REFERENCES public.zz_record_map_projects(id,tenant_id)
);
INSERT INTO public.zz_record_map_tasks VALUES (1,'Task one',11,7),(2,'Task two',11,7),(3,'Task three',11,7),(4,'No project',NULL,7);
CREATE TABLE public.zz_record_map_float_parent (id double precision PRIMARY KEY, name text);
CREATE TABLE public.zz_record_map_float_child (id integer PRIMARY KEY, parent_id double precision NOT NULL,
    CONSTRAINT zz_record_map_float_link FOREIGN KEY(parent_id) REFERENCES public.zz_record_map_float_parent(id));
INSERT INTO public.zz_record_map_float_parent VALUES (1.2345678901234567,'First float'),(1.2345678901234569,'Second float');
INSERT INTO public.zz_record_map_float_child VALUES (1,1.2345678901234567),(2,1.2345678901234569);
CREATE TABLE public.zz_record_map_no_identity (name text);
INSERT INTO public.zz_record_map_no_identity VALUES ('Unkeyed row'),('Unkeyed row');
CREATE TABLE public.zz_record_map_binary_key (id bytea PRIMARY KEY, name text);
INSERT INTO public.zz_record_map_binary_key VALUES (decode('00ff','hex'),'Binary identity');
CREATE TABLE public."zz_record_map_odd`table" ("odd`id" integer PRIMARY KEY, name text);
INSERT INTO public."zz_record_map_odd`table" VALUES (1,'Quoted identifier');
CREATE TABLE public._govern_zz_record_map_probe (id integer PRIMARY KEY);
CREATE VIEW public.zz_record_map_people_view AS SELECT id,name FROM public.zz_record_map_people;
GRANT USAGE ON SCHEMA public,archive TO :"reader";
GRANT SELECT ON public.zz_record_map_people,public.zz_record_map_projects,public.zz_record_map_tasks,
    public.zz_record_map_float_parent,public.zz_record_map_float_child,
    public.zz_record_map_no_identity,public.zz_record_map_binary_key,public."zz_record_map_odd`table",
    public._govern_zz_record_map_probe,public.zz_record_map_people_view,archive.zz_record_map_people TO :"reader";

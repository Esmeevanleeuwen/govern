-- Optional, fictional examples for public PostgreSQL workspaces.
-- Run with load-postgres-demo.cmd or sh load-postgres-demo.sh.
\set ON_ERROR_STOP on
\getenv reader PG_READ_USER
\getenv schemas PG_SCHEMAS

SELECT EXISTS (SELECT 1 FROM regexp_split_to_table(:'schemas', ',') AS configured(name)
               WHERE btrim(name) = 'public') AS public_enabled \gset
\if :public_enabled
\else
  DO $$ BEGIN
      RAISE EXCEPTION 'PG_SCHEMAS must include public to load these examples. Existing data was not changed.';
  END $$;
\endif
SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
               WHERE rolname = :'reader' AND rolname <> current_user
                 AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb) AS reader_ready \gset
\if :reader_ready
\else
  DO $$ BEGIN
      RAISE EXCEPTION 'Start Govern first with its separate PostgreSQL reader role. Existing data was not changed.';
  END $$;
\endif

BEGIN;
SELECT pg_advisory_xact_lock(1735357046, 1);

-- A complete recognized demo is left intact, including user edits.
SELECT (obj_description(to_regclass('public.demo_organizations'), 'pg_class')
            = 'Govern PostgreSQL demo v1: fictional organizations.'
        AND NOT EXISTS (
            SELECT 1 FROM (VALUES ('demo_organizations'), ('demo_systems'),
                ('demo_projects'), ('demo_contacts'), ('demo_project_participants'),
                ('demo_project_overview')) AS expected(name)
            WHERE to_regclass('public.' || name) IS NULL
        )) IS TRUE AS demo_already_loaded \gset

\if :demo_already_loaded
  -- Retain the existing sample records.
\else
  -- Refuse name collisions before creating or inserting anything.
  DO $$
  BEGIN
      IF EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname IN (
              'demo_organizations', 'demo_systems', 'demo_projects', 'demo_contacts',
              'demo_project_participants', 'demo_project_overview')
      ) THEN
          RAISE EXCEPTION 'A demo object name already exists. No example data was added; existing objects were preserved.';
      END IF;
  END $$;

  CREATE TABLE public.demo_organizations (
      id integer PRIMARY KEY,
      name text NOT NULL,
      organization_type text NOT NULL,
      city text NOT NULL,
      active boolean NOT NULL DEFAULT true
  );
  COMMENT ON TABLE public.demo_organizations IS 'Govern PostgreSQL demo v1: fictional organizations.';

  CREATE TABLE public.demo_systems (
      id integer PRIMARY KEY,
      owner_organization_id integer NOT NULL REFERENCES public.demo_organizations(id),
      name text NOT NULL,
      status text NOT NULL CHECK (status IN ('planned', 'live', 'retiring')),
      annual_budget numeric(12,2) NOT NULL CHECK (annual_budget >= 0),
      launched_on date,
      details jsonb NOT NULL DEFAULT '{}'
  );
  COMMENT ON TABLE public.demo_systems IS 'Fictional digital services and their owning organizations.';

  CREATE TABLE public.demo_projects (
      id integer PRIMARY KEY,
      system_id integer NOT NULL REFERENCES public.demo_systems(id),
      lead_organization_id integer NOT NULL REFERENCES public.demo_organizations(id),
      name text NOT NULL,
      status text NOT NULL CHECK (status IN ('planned', 'in_progress', 'completed')),
      starts_on date NOT NULL,
      target_date date NOT NULL,
      CHECK (target_date >= starts_on)
  );
  COMMENT ON TABLE public.demo_projects IS 'Fictional improvement projects linked to systems and lead organizations.';

  CREATE TABLE public.demo_contacts (
      id integer PRIMARY KEY,
      organization_id integer NOT NULL REFERENCES public.demo_organizations(id),
      full_name text NOT NULL,
      role text NOT NULL,
      email text NOT NULL UNIQUE
  );
  COMMENT ON TABLE public.demo_contacts IS 'Fictional people; example email addresses do not belong to real users.';

  CREATE TABLE public.demo_project_participants (
      project_id integer NOT NULL REFERENCES public.demo_projects(id),
      organization_id integer NOT NULL REFERENCES public.demo_organizations(id),
      role text NOT NULL,
      PRIMARY KEY (project_id, organization_id)
  );
  COMMENT ON TABLE public.demo_project_participants IS 'Many-to-many project participation with a composite primary key.';

  INSERT INTO public.demo_organizations VALUES
      (1, 'Northbridge Council', 'Municipality', 'Northbridge', true),
      (2, 'Riverside Council', 'Municipality', 'Riverside', true),
      (3, 'Regional Digital Office', 'Regional partnership', 'Northbridge', true),
      (4, 'Shared Services Cooperative', 'Service provider', 'Brookfield', true),
      (5, 'Civic Research Institute', 'Research organization', 'Riverside', true);

  INSERT INTO public.demo_systems VALUES
      (1, 1, 'Resident Services Portal', 'live', 125000.00, '2023-04-12', '{"channels":["web","mobile"],"accessibility":"AA"}'),
      (2, 2, 'Permit Desk', 'live', 87000.50, '2022-09-01', '{"channels":["web"],"languages":["nl","en"]}'),
      (3, 3, 'Regional Data Exchange', 'live', 210000.00, '2024-02-15', '{"format":"JSON","participants":5}'),
      (4, 4, 'Appointment Planner', 'live', 42000.00, '2021-06-21', '{"channels":["web","phone"]}'),
      (5, 1, 'Public Space Reporter', 'planned', 65000.00, NULL, '{"channels":["mobile"],"pilot":true}'),
      (6, 5, 'Community Survey Archive', 'retiring', 18000.00, '2018-03-05', '{"retention_years":7}');

  INSERT INTO public.demo_projects VALUES
      (1, 1, 1, 'Accessible online applications', 'in_progress', '2026-01-15', '2026-12-15'),
      (2, 2, 2, 'Permit status notifications', 'in_progress', '2026-03-01', '2026-11-30'),
      (3, 3, 3, 'Shared organization directory', 'completed', '2025-09-01', '2026-06-30'),
      (4, 4, 4, 'Regional appointment rollout', 'in_progress', '2026-04-01', '2027-02-28'),
      (5, 5, 1, 'Public space reporting pilot', 'planned', '2027-01-15', '2027-09-30'),
      (6, 6, 5, 'Survey archive migration', 'in_progress', '2026-05-01', '2026-12-31'),
      (7, 1, 3, 'Plain-language service pages', 'completed', '2025-10-01', '2026-04-30'),
      (8, 3, 3, 'Data quality dashboard', 'planned', '2027-02-01', '2027-10-31');

  INSERT INTO public.demo_contacts VALUES
      (1, 1, 'Alex Example', 'Service owner', 'alex@northbridge.example'),
      (2, 1, 'Robin Example', 'Project coordinator', 'robin@northbridge.example'),
      (3, 2, 'Sam Example', 'Permit coordinator', 'sam@riverside.example'),
      (4, 2, 'Jamie Example', 'Accessibility adviser', 'jamie@riverside.example'),
      (5, 3, 'Morgan Example', 'Data steward', 'morgan@digital-office.example'),
      (6, 4, 'Taylor Example', 'Platform manager', 'taylor@shared-services.example'),
      (7, 4, 'Casey Example', 'Implementation lead', 'casey@shared-services.example'),
      (8, 5, 'Jordan Example', 'Research coordinator', 'jordan@civic-research.example');

  INSERT INTO public.demo_project_participants VALUES
      (1, 1, 'Lead'), (1, 4, 'Delivery partner'),
      (2, 2, 'Lead'), (2, 4, 'Delivery partner'),
      (3, 1, 'Participant'), (3, 2, 'Participant'), (3, 3, 'Lead'),
      (4, 4, 'Lead'), (5, 1, 'Lead'), (6, 5, 'Lead'),
      (7, 3, 'Lead'), (8, 3, 'Lead');

  CREATE VIEW public.demo_project_overview WITH (security_invoker = true) AS
      SELECT p.id, p.name AS project, p.status, s.name AS system,
             o.name AS lead_organization, p.starts_on, p.target_date
      FROM public.demo_projects p
      JOIN public.demo_systems s ON s.id = p.system_id
      JOIN public.demo_organizations o ON o.id = p.lead_organization_id;
  COMMENT ON VIEW public.demo_project_overview IS 'Fictional project overview joining projects, systems and organizations.';

  ANALYZE public.demo_organizations, public.demo_systems, public.demo_projects,
      public.demo_contacts, public.demo_project_participants;
\endif

-- The web app retains its separate reader role; no write grants are added.
GRANT USAGE ON SCHEMA public TO :"reader";
GRANT SELECT ON public.demo_organizations, public.demo_systems, public.demo_projects,
    public.demo_contacts, public.demo_project_participants, public.demo_project_overview TO :"reader";
COMMIT;
\if :demo_already_loaded
  \echo 'Govern PostgreSQL examples already exist; existing records are preserved.'
\else
  \echo 'Added 5 example tables, 39 fictional records and 1 overview view.'
\endif

#!/usr/bin/env python3
"""Private PostgreSQL checkpoint helper. Never accepts SQL, credentials or paths."""
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import secrets
import socket
import stat
import subprocess
import sys
import tempfile
from urllib.parse import quote

ID = re.compile(r"[0-9]{8}T[0-9]{6}Z_[a-f0-9]{16}\Z")
MAX_REQUEST = 4096
MAX_RESPONSE = 1048576
MAX_DUMP = 536870912
APP_UID = APP_GID = 33


class Failure(Exception):
    def __init__(self, code):
        self.code = code


def identifier(value):
    if not isinstance(value, str) or not value or "\x00" in value:
        raise Failure("postgres_tools_invalid")
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def block(body):
    while True:
        delimiter = "$govern_" + secrets.token_hex(12) + "$"
        if delimiter not in body:
            return "DO " + delimiter + "\n" + body + "\n" + delimiter + ";\n"


class Tools:
    def __init__(self, environment=None):
        self.env = dict(os.environ if environment is None else environment)
        self.database = self.env.get("PGDATABASE", "")
        self.schemas = list(dict.fromkeys(x.strip() for x in self.env.get("PG_SCHEMAS", "public").split(",") if x.strip()))
        self.restore_user = self.env.get("PG_RESTORE_USER", "govern_pg_restore")
        self.root = Path(self.env.get("BACKUP_DIR", "/var/lib/govern/backups"))
        self.timeout = max(10, min(180, int(self.env.get("PG_TOOLS_TIMEOUT_SECONDS", "90"))))
        names = [self.database, self.restore_user, self.env.get("PGUSER", ""),
                 self.env.get("PG_READ_USER", ""), self.env.get("PG_USER", ""), self.env.get("PG_SQL_USER", "")]
        if any(not re.fullmatch(r"[A-Za-z0-9_]{1,63}", x) for x in names):
            raise Failure("postgres_tools_invalid")
        roles = names[1:]
        if len(set(roles)) != len(roles):
            raise Failure("postgres_tools_invalid")
        if not self.root.is_absolute() or not self.schemas or any(
                not x or x.startswith("pg_") or x == "information_schema" or len(x.encode()) > 63
                or any(ord(c) < 32 or ord(c) == 127 for c in x) for x in self.schemas):
            raise Failure("postgres_tools_invalid")
        if not self.env.get("PGPASSWORD") or not self.env.get("PG_READ_PASSWORD") or not self.env.get("PG_RESTORE_PASSWORD"):
            raise Failure("postgres_tools_invalid")

    def process_env(self, role):
        result = dict(self.env)
        if role == "reader":
            result["PGUSER"], result["PGPASSWORD"] = self.env["PG_READ_USER"], self.env["PG_READ_PASSWORD"]
        elif role == "restore":
            result["PGUSER"], result["PGPASSWORD"] = self.restore_user, self.env["PG_RESTORE_PASSWORD"]
        result["PGCONNECT_TIMEOUT"] = "5"
        result["PGOPTIONS"] = ("-c search_path=pg_catalog -c statement_timeout=90000 -c lock_timeout=5000 -c timezone=UTC"
                               " -c standard_conforming_strings=on -c client_encoding=UTF8")
        result["PGAPPNAME"] = "govern-checkpoints-" + role
        return result

    def run(self, argv, *, role="admin", input=None, output=None, error="postgres_snapshot_failed", max_file_bytes=None):
        def limit_files():
            inherited = resource.getrlimit(resource.RLIMIT_FSIZE)
            finite = [value for value in inherited if value != resource.RLIM_INFINITY]
            ceiling = min([max_file_bytes, *finite])
            resource.setrlimit(resource.RLIMIT_FSIZE, (ceiling, ceiling))

        try:
            result = subprocess.run(argv, input=input, stdout=output or subprocess.PIPE,
                                    stderr=subprocess.PIPE, env=self.process_env(role), timeout=self.timeout,
                                    check=False, preexec_fn=limit_files if max_file_bytes is not None else None)
        except (OSError, subprocess.SubprocessError):
            raise Failure(error) from None
        if result.returncode != 0:
            # Driver diagnostics may contain records or secrets. Only stable
            # application codes cross the socket boundary.
            raise Failure(error)
        return result.stdout if output is None else b""

    def sql(self, sql, *, role="admin", error="postgres_snapshot_failed"):
        return self.run(["psql", "-X", "-qAt", "--set", "ON_ERROR_STOP=1", "--dbname", self.database],
                        role=role, input=sql.encode(), error=error).decode().strip()

    def request(self, request):
        if not isinstance(request, dict) or request.get("database") != self.database or request.get("schema") not in self.schemas:
            raise Failure("postgres_tools_invalid")
        action, schema = request.get("action"), request["schema"]
        expected = {"action", "database", "schema"}
        if action == "create":
            expected.add("label")
        elif action in ("download", "restore"):
            expected.add("id")
        if set(request) != expected:
            raise Failure("postgres_tools_invalid")
        if action == "list":
            return self.list(schema)
        if action == "create":
            return self.create(schema, request["label"])
        if action == "download":
            return self.manifest(schema, request["id"], verify=True)
        if action == "restore":
            return self.restore(schema, request["id"])
        raise Failure("postgres_tools_invalid")

    def directory(self, schema):
        scope = "postgres:" + quote(self.database, safe="-_.~") + ":" + quote(schema, safe="-_.~")
        for directory in (self.root, self.root / "connections", self.root / "connections" / hashlib.sha256(scope.encode()).hexdigest()):
            if directory.is_symlink():
                raise Failure("backup_directory_invalid")
            directory.mkdir(mode=0o750, exist_ok=True)
            if not directory.is_dir():
                raise Failure("backup_directory_invalid")
            if directory != self.root:
                os.chown(directory, 0, APP_GID)
                os.chmod(directory, 0o750)
        return directory

    def path(self, schema, snapshot, suffix):
        if not isinstance(snapshot, str) or ID.fullmatch(snapshot) is None:
            raise Failure("snapshot_id_invalid")
        return self.directory(schema) / (snapshot + "." + suffix)

    @staticmethod
    def read_file(path, limit):
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as stream:
                metadata = os.fstat(stream.fileno())
                if (not stat.S_ISREG(metadata.st_mode) or metadata.st_size > limit
                        or metadata.st_uid != 0 or metadata.st_mode & 0o022):
                    raise Failure("snapshot_invalid")
                data = stream.read(limit + 1)
                if len(data) > limit:
                    raise Failure("snapshot_invalid")
                return data
        except OSError:
            raise Failure("snapshot_missing") from None

    def manifest(self, schema, snapshot, verify=False):
        try:
            data = json.loads(self.read_file(self.path(schema, snapshot, "json"), 8192))
        except (ValueError, UnicodeDecodeError):
            raise Failure("snapshot_invalid") from None
        if (not isinstance(data, dict) or data.get("id") != snapshot
                or data.get("format") != "postgres-custom-v1" or data.get("database") != self.database
                or data.get("schema") != schema or not isinstance(data.get("label"), str)
                or not isinstance(data.get("created_at"), str) or not isinstance(data.get("size_bytes"), int)
                or not 0 < data["size_bytes"] <= MAX_DUMP or not re.fullmatch(r"[a-f0-9]{64}", data.get("sha256", ""))):
            raise Failure("snapshot_invalid")
        archive = self.path(schema, snapshot, "dump")
        try:
            metadata = archive.lstat()
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != data["size_bytes"]:
                raise Failure("snapshot_invalid")
        except OSError:
            raise Failure("snapshot_missing") from None
        if verify:
            contents = self.read_file(archive, MAX_DUMP)
            if len(contents) != data["size_bytes"] or hashlib.sha256(contents).hexdigest() != data["sha256"]:
                raise Failure("snapshot_changed")
        return data

    def list(self, schema):
        result = []
        available = self.restore_available(schema)
        for path in sorted(self.directory(schema).glob("*.json"), reverse=True)[:500]:
            try:
                result.append({**self.manifest(schema, path.stem), "restore_available": available})
            except Failure:
                continue
        return result

    def restore_available(self, schema):
        try:
            self.supported(schema)
            self.external_dependencies(schema)
            return True
        except Failure:
            return False

    def owner(self, schema):
        return self.sql("SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace WHERE nspname=" + literal(schema) + ";") or None

    def restricted_role(self, role):
        name = self.env["PG_READ_USER"] if role == "reader" else self.restore_user
        sql = ("SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls"
               " OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid))"
               " FROM pg_catalog.pg_roles r WHERE rolname=" + literal(name) + ";")
        if self.sql(sql) != "t":
            raise Failure("postgres_tools_invalid")

    def supported(self, schema):
        sql = """SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_depend d
          JOIN pg_catalog.pg_namespace n ON d.refclassid='pg_catalog.pg_namespace'::regclass AND d.refobjid=n.oid
          WHERE n.nspname={schema} AND d.classid NOT IN
            ('pg_catalog.pg_class'::regclass,'pg_catalog.pg_proc'::regclass,'pg_catalog.pg_type'::regclass,
             'pg_catalog.pg_constraint'::regclass,'pg_catalog.pg_default_acl'::regclass)
          UNION ALL
          SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname={schema} AND c.relkind NOT IN ('r','p','v','m','S','i','I','c')
          UNION ALL
          SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname={schema} AND p.prokind NOT IN ('f','p','w')
          UNION ALL
          SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname={schema} AND t.typtype NOT IN ('e','d','c','r','m') AND t.typelem=0
          UNION ALL
          SELECT 1 FROM pg_catalog.pg_depend d
          CROSS JOIN LATERAL pg_catalog.pg_identify_object(d.classid,d.objid,d.objsubid) obj
          WHERE obj.schema={schema} AND d.deptype='e'
        );""".format(schema=literal(schema))
        if self.sql(sql) == "t":
            raise Failure("postgres_snapshot_unsupported")

    def external_dependencies(self, schema):
        sql = """WITH RECURSIVE edges AS (
          SELECT refclassid AS src_class,refobjid AS src_oid,refobjsubid AS src_sub,
                 classid AS dst_class,objid AS dst_oid,objsubid AS dst_sub FROM pg_catalog.pg_depend
          UNION ALL
          SELECT classid,objid,objsubid,refclassid,refobjid,refobjsubid
            FROM pg_catalog.pg_depend WHERE deptype IN ('i','P','S')
        ), affected(classid,objid,objsubid) AS (
          SELECT 'pg_catalog.pg_namespace'::regclass::oid,oid,0
            FROM pg_catalog.pg_namespace WHERE nspname={schema}
          UNION
          SELECT e.dst_class,e.dst_oid,e.dst_sub FROM edges e JOIN affected a
            ON e.src_class=a.classid AND e.src_oid=a.objid AND (a.objsubid=0 OR e.src_sub=a.objsubid)
        ), objects AS (
          SELECT a.*, obj.schema AS direct_schema,
            CASE
              WHEN a.classid='pg_catalog.pg_namespace'::regclass THEN a.objid
              WHEN a.classid='pg_catalog.pg_class'::regclass THEN (SELECT c.relnamespace FROM pg_catalog.pg_class c WHERE c.oid=a.objid)
              WHEN a.classid='pg_catalog.pg_type'::regclass THEN (SELECT t.typnamespace FROM pg_catalog.pg_type t WHERE t.oid=a.objid)
              WHEN a.classid='pg_catalog.pg_constraint'::regclass THEN (SELECT c.connamespace FROM pg_catalog.pg_constraint c WHERE c.oid=a.objid)
              WHEN a.classid='pg_catalog.pg_rewrite'::regclass THEN (SELECT c.relnamespace FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class WHERE r.oid=a.objid)
              WHEN a.classid='pg_catalog.pg_trigger'::regclass THEN (SELECT COALESCE(con.connamespace,c.relnamespace) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid LEFT JOIN pg_catalog.pg_constraint con ON t.tgconstraint>0 AND con.oid=t.tgconstraint WHERE t.oid=a.objid)
              WHEN a.classid='pg_catalog.pg_attrdef'::regclass THEN (SELECT c.relnamespace FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_class c ON c.oid=d.adrelid WHERE d.oid=a.objid)
              WHEN a.classid='pg_catalog.pg_policy'::regclass THEN (SELECT c.relnamespace FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid WHERE p.oid=a.objid)
              WHEN a.classid='pg_catalog.pg_default_acl'::regclass THEN (SELECT d.defaclnamespace FROM pg_catalog.pg_default_acl d WHERE d.oid=a.objid)
            END AS namespace_oid
          FROM affected a CROSS JOIN LATERAL pg_catalog.pg_identify_object(a.classid,a.objid,a.objsubid) obj
        ), resolved AS (
          SELECT o.*, COALESCE(n.nspname,o.direct_schema) AS object_schema,
            CASE WHEN o.classid='pg_catalog.pg_class'::regclass THEN o.objid END AS relation_oid
          FROM objects o LEFT JOIN pg_catalog.pg_namespace n ON n.oid=o.namespace_oid
        ) SELECT EXISTS (
          SELECT 1 FROM resolved o
          WHERE NOT (o.object_schema IS NOT DISTINCT FROM {schema})
            AND NOT (o.object_schema='pg_toast' AND o.classid='pg_catalog.pg_class'::regclass
              AND EXISTS (SELECT 1 FROM pg_catalog.pg_class parent JOIN pg_catalog.pg_namespace pn ON pn.oid=parent.relnamespace
                WHERE pn.nspname={schema} AND parent.reltoastrelid=COALESCE(
                  (SELECT i.indrelid FROM pg_catalog.pg_index i WHERE i.indexrelid=o.relation_oid),o.relation_oid)))
        );""".format(schema=literal(schema))
        if self.sql(sql) == "t":
            raise Failure("postgres_snapshot_dependencies")

    def create(self, schema, label):
        if not isinstance(label, str) or not label.strip() or len(label.strip().encode()) > 600:
            raise Failure("snapshot_label_invalid")
        if self.owner(schema) is None:
            raise Failure("postgres_schema_unavailable")
        self.supported(schema)
        self.restricted_role("reader")
        snapshot = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ_") + secrets.token_hex(8)
        with tempfile.TemporaryDirectory(prefix="govern-pg-") as temporary:
            archive = Path(temporary) / "snapshot.dump"
            # An actual reader login prevents executing user-defined data output
            # functions with bootstrap authority while exporting.
            self.run(["pg_dump", "--format=custom", "--no-owner", "--no-acl", "--schema=" + identifier(schema),
                      "--file=" + str(archive), "--dbname=" + self.database], role="reader", max_file_bytes=MAX_DUMP)
            size = archive.stat().st_size
            if not 0 < size <= MAX_DUMP:
                raise Failure("postgres_snapshot_failed")
            checksum = hashlib.sha256()
            with archive.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1048576), b""):
                    checksum.update(chunk)
            manifest = {"id": snapshot, "format": "postgres-custom-v1", "database": self.database, "schema": schema,
                        "label": label.strip(), "created_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                        "size_bytes": size, "sha256": checksum.hexdigest(), "restore_available": self.restore_available(schema)}
            destination = self.path(schema, snapshot, "dump")
            metadata = self.path(schema, snapshot, "json")
            try:
                with archive.open("rb") as source:
                    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o440)
                    with os.fdopen(descriptor, "wb") as target:
                        for chunk in iter(lambda: source.read(1048576), b""):
                            target.write(chunk)
                        target.flush()
                        os.fsync(target.fileno())
                os.chown(destination, 0, APP_GID)
                descriptor = os.open(metadata, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o440)
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode() + b"\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                os.chown(metadata, 0, APP_GID)
            except OSError:
                for path in (destination, metadata):
                    with contextlib.suppress(OSError):
                        path.unlink()
                raise Failure("snapshot_write_failed") from None
            return manifest

    def drop_sql(self, schema):
        body = """
        DECLARE item record;
        BEGIN
          FOR item IN SELECT c.relname,c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname={schema} AND c.relkind IN ('v','m','r','p','S')
            ORDER BY CASE c.relkind WHEN 'v' THEN 0 WHEN 'm' THEN 1 WHEN 'p' THEN 2 WHEN 'r' THEN 3 ELSE 4 END,c.relname
          LOOP
            EXECUTE pg_catalog.format('DROP %s IF EXISTS %I.%I CASCADE',
              CASE item.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
              {schema},item.relname);
          END LOOP;
          FOR item IN SELECT p.proname,p.prokind,pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
            FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname={schema}
          LOOP
            EXECUTE pg_catalog.format('DROP %s IF EXISTS %I.%I(%s) CASCADE',
              CASE item.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,{schema},item.proname,item.args);
          END LOOP;
          FOR item IN SELECT t.typname,t.typtype FROM pg_catalog.pg_type t
            JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
            LEFT JOIN pg_catalog.pg_class c ON c.oid=t.typrelid
            WHERE n.nspname={schema} AND t.typelem=0 AND (t.typrelid=0 OR c.relkind='c')
          LOOP
            EXECUTE pg_catalog.format('DROP %s IF EXISTS %I.%I CASCADE',
              CASE item.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END,{schema},item.typname);
          END LOOP;
        END
        """.format(schema=literal(schema))
        return block(body)

    def grant_sql(self, schema):
        quoted = identifier(schema)
        reader, writer, sql = (identifier(self.env[key]) for key in ("PG_READ_USER", "PG_USER", "PG_SQL_USER"))
        normalize_body = """DECLARE item record; recipient text; BEGIN
          FOR item IN SELECT c.relname,c.relkind,a.grantee FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
            WHERE n.nspname={schema} AND c.relkind IN ('r','p','v','m','S') AND a.grantee<>c.relowner
          LOOP
            recipient := CASE WHEN item.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(item.grantee)) END;
            EXECUTE pg_catalog.format('REVOKE ALL ON %s %I.%I FROM %s',
              CASE item.relkind WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,{schema},item.relname,recipient);
          END LOOP;
          FOR item IN SELECT d.defaclnamespace,n.nspname,d.defaclobjtype,a.grantee FROM pg_catalog.pg_default_acl d
            LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
            CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
            WHERE d.defaclrole=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
              AND (d.defaclnamespace=0 OR n.nspname={schema}) AND d.defaclobjtype IN ('r','S') AND a.grantee<>d.defaclrole
          LOOP
            recipient := CASE WHEN item.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(item.grantee)) END;
            EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES %s REVOKE ALL ON %s FROM %s',
              CASE WHEN item.defaclnamespace=0 THEN '' ELSE pg_catalog.format('IN SCHEMA %I',item.nspname) END,
              CASE item.defaclobjtype WHEN 'S' THEN 'SEQUENCES' ELSE 'TABLES' END,recipient);
          END LOOP;
        END
        """.format(schema=literal(schema))
        normalize = block(normalize_body)
        return (normalize + f"GRANT USAGE ON SCHEMA {quoted} TO {reader},{writer},{sql};\n"
                f"GRANT SELECT ON ALL TABLES IN SCHEMA {quoted} TO {reader};\n"
                f"GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA {quoted} TO {writer};\n"
                f"GRANT SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER ON ALL TABLES IN SCHEMA {quoted} TO {sql};\n"
                f"GRANT SELECT ON ALL SEQUENCES IN SCHEMA {quoted} TO {reader};\n"
                f"GRANT USAGE ON ALL SEQUENCES IN SCHEMA {quoted} TO {writer},{sql};\n"
                f"ALTER DEFAULT PRIVILEGES IN SCHEMA {quoted} GRANT SELECT ON TABLES TO {reader};\n"
                f"ALTER DEFAULT PRIVILEGES IN SCHEMA {quoted} GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO {writer};\n"
                f"ALTER DEFAULT PRIVILEGES IN SCHEMA {quoted} GRANT SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER ON TABLES TO {sql};\n"
                f"ALTER DEFAULT PRIVILEGES IN SCHEMA {quoted} GRANT SELECT ON SEQUENCES TO {reader};\n"
                f"ALTER DEFAULT PRIVILEGES IN SCHEMA {quoted} GRANT USAGE ON SEQUENCES TO {writer},{sql};\n")

    def restore(self, schema, snapshot):
        self.restricted_role("restore")
        manifest = self.manifest(schema, snapshot, verify=True)
        original_owner = self.owner(schema)
        if original_owner is not None:
            self.supported(schema)
            self.external_dependencies(schema)
        safety = self.create(schema, "Automatic before restoring " + snapshot) if original_owner is not None else None
        with tempfile.TemporaryDirectory(prefix="govern-pg-") as temporary:
            temporary = Path(temporary)
            archive = temporary / "restore.dump"
            # A private checked copy closes the checksum-check/pg_restore race.
            contents = self.read_file(self.path(schema, snapshot, "dump"), MAX_DUMP)
            if hashlib.sha256(contents).hexdigest() != manifest["sha256"]:
                raise Failure("snapshot_changed")
            archive.write_bytes(contents)
            toc = self.run(["pg_restore", "--list", str(archive)], error="postgres_restore_failed").decode()
            use_list = temporary / "restore.list"
            use_list.write_text("\n".join(line for line in toc.splitlines()
                                          if re.match(r"^\d+;\s+\d+\s+\d+\s+SCHEMA\s", line) is None) + "\n")
            restored_sql = temporary / "restore.sql"
            with restored_sql.open("wb") as stream:
                self.run(["pg_restore", "--no-owner", "--no-acl", "--use-list=" + str(use_list),
                          "--file=-", str(archive)], output=stream, error="postgres_restore_failed", max_file_bytes=MAX_DUMP * 4)
            if restored_sql.stat().st_size > MAX_DUMP * 4:
                raise Failure("postgres_restore_failed")
            control_changed = success = False
            try:
                if original_owner is None:
                    self.sql("CREATE SCHEMA " + identifier(schema) + " AUTHORIZATION " + identifier(self.restore_user) + ";", error="postgres_restore_failed")
                else:
                    self.sql("ALTER SCHEMA " + identifier(schema) + " OWNER TO " + identifier(self.restore_user) + ";", error="postgres_restore_failed")
                control_changed = True
                input_sql = temporary / "transaction.sql"
                with input_sql.open("wb") as target:
                    target.write(("SET search_path=pg_catalog;\n" + self.drop_sql(schema)).encode())
                    with restored_sql.open("rb") as source:
                        for chunk in iter(lambda: source.read(1048576), b""):
                            target.write(chunk)
                    target.write(("\n" + self.grant_sql(schema)).encode())
                # AUTHENTICATE as the restricted login. User functions cannot
                # RESET ROLE/SESSION AUTHORIZATION back to a bootstrap identity.
                with input_sql.open("rb") as source:
                    try:
                        result = subprocess.run(["psql", "-X", "-q", "--single-transaction", "--set", "ON_ERROR_STOP=1", "--dbname", self.database],
                                                stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                                env=self.process_env("restore"), timeout=self.timeout, check=False)
                    except (OSError, subprocess.TimeoutExpired):
                        raise Failure("postgres_restore_failed") from None
                if result.returncode != 0:
                    raise Failure("postgres_restore_failed")
                success = True
            finally:
                if control_changed and original_owner is not None:
                    # OWNER changes rewrite ACLs; retain explicit scoped access
                    # for later restores that reference this schema from another.
                    self.sql("BEGIN;\nALTER SCHEMA " + identifier(schema) + " OWNER TO " + identifier(original_owner) + ";\n"
                             + "GRANT USAGE,CREATE ON SCHEMA " + identifier(schema) + " TO " + identifier(self.restore_user) + ";\nCOMMIT;",
                             error="postgres_restore_owner_failed")
                elif control_changed and not success:
                    self.sql("DROP SCHEMA " + identifier(schema) + " RESTRICT;", error="postgres_restore_owner_failed")
            return {"restored": snapshot, "safety_snapshot": safety, "database": self.database,
                    "schema": schema, "ownership_normalized": True}


def serve():
    tools = Tools()
    path = Path(os.environ.get("PG_TOOLS_SOCKET", "/run/govern-postgres/tools.sock"))
    if not path.is_absolute() or len(str(path).encode()) > 103 or path.parent.is_symlink():
        raise Failure("postgres_tools_invalid")
    path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(path.parent, 0, APP_GID)
    os.chmod(path.parent, 0o750)
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not stat.S_ISSOCK(path.lstat().st_mode):
            raise Failure("postgres_tools_invalid")
        path.unlink()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind(str(path))
        os.chown(path, 0, APP_GID)
        os.chmod(path, 0o660)
        server.listen(8)
        while True:
            connection, _ = server.accept()
            with connection:
                connection.settimeout(5)
                try:
                    raw = bytearray()
                    while not raw.endswith(b"\n") and len(raw) <= MAX_REQUEST:
                        chunk = connection.recv(min(1024, MAX_REQUEST + 1 - len(raw)))
                        if not chunk:
                            break
                        raw.extend(chunk)
                    if len(raw) > MAX_REQUEST or not raw.endswith(b"\n"):
                        raise Failure("postgres_tools_invalid")
                    request = json.loads(raw)
                    if request == {"action": "health"}:
                        response = {"ok": True, "data": {"status": "ready"}}
                    else:
                        response = {"ok": True, "data": tools.request(request)}
                except Failure as error:
                    response = {"ok": False, "error_code": error.code}
                except (ValueError, UnicodeDecodeError, OSError, socket.timeout):
                    response = {"ok": False, "error_code": "postgres_tools_invalid"}
                except Exception:
                    response = {"ok": False, "error_code": "postgres_snapshot_failed"}
                raw = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode() + b"\n"
                if len(raw) > MAX_RESPONSE:
                    raw = b'{"ok":false,"error_code":"postgres_tools_invalid"}\n'
                with contextlib.suppress(OSError):
                    connection.sendall(raw)


def health():
    path = os.environ.get("PG_TOOLS_SOCKET", "/run/govern-postgres/tools.sock")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(2)
        client.connect(path)
        client.sendall(b'{"action":"health"}\n')
        data = json.loads(client.recv(1024))
        return 0 if data == {"ok": True, "data": {"status": "ready"}} else 1


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--health"]:
            raise SystemExit(health())
        serve()
    except Failure as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1) from None

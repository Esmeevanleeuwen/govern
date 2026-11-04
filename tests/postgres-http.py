#!/usr/bin/env python3
"""Authenticated PostgreSQL API scope/capability checks against an isolated local stack."""
import argparse
import http.cookiejar
import json
import urllib.error
import urllib.parse
import urllib.request

from auth_http import ensure_authenticated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--confirm-database", required=True)
    args = parser.parse_args()
    if args.confirm_database != "govern_pg":
        raise RuntimeError("Only the isolated govern_pg fixture database is supported")
    base = args.base_url.rstrip("/")
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    ensure_authenticated(client, base)
    csrf = ""
    checks = 0
    scope = {"connection": "postgres", "database": "govern_pg", "schema": "public"}

    def check(condition, description):
        nonlocal checks
        if not condition:
            raise AssertionError(description)
        checks += 1

    def request(action, payload=None, parameters=None, *, authenticated=True, token=True, upload=False):
        query = {key: value for key, value in {"action": action, **scope, **(parameters or {})}.items()
                 if value is not None}
        headers = {"Accept": "application/json", "Accept-Language": "en"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers.update({"Content-Type": "application/json"})
            if token:
                headers["X-CSRF-Token"] = csrf
        if upload:
            boundary = "govern-import-capability-check"
            data = ("--" + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="scope.csv"'
                    + '\r\nContent-Type: text/csv\r\n\r\nname\r\nScoped import\r\n--' + boundary + "--\r\n").encode()
            headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
            if token:
                headers["X-CSRF-Token"] = csrf
        req = urllib.request.Request(base + "/api.php?" + urllib.parse.urlencode(query), data=data, headers=headers)
        opener = client if authenticated else urllib.request.build_opener()
        try:
            response = opener.open(req, timeout=40)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    status, result = request("bootstrap", authenticated=False)
    check(status == 401 and not result["ok"], "Guests cannot enumerate the PostgreSQL connection")
    status, result = request("bootstrap")
    check(status == 200 and result["ok"], "Authenticated PostgreSQL bootstrap succeeds")
    data = result["data"]
    csrf = data["csrf"]
    packed = {"database": "postgres:govern_pg:public", "connection": None, "schema": None}
    status, result = request("bootstrap", parameters=packed)
    check(status == 200 and result["data"]["scope_key"] == "postgres:govern_pg:public",
          "A cached API module can bootstrap using the complete workspace key")
    status, result = request("browse", parameters={**packed, "database": "postgres:govern_pg:archive", "table": "govern_pg_values"})
    check(status == 200 and result["data"]["rows"] == [{"id": "1", "label": "Archive-only row"}],
          "Packed keys retain schema isolation when browsing")
    status, result = request("query", {"sql": "SELECT 1"}, parameters=packed)
    check(status == 200 and result["data"]["statements"][0]["rows"] == [["1"]],
          "Compatibility requests retain the selected PostgreSQL SQL connection")
    for invalid in ["postgres:other:public", "postgres:govern_pg:pg_catalog", "postgres:govern_pg:missing",
                    "postgres:govern_pg", "postgres::public", "postgres:govern_pg:",
                    "postgres:govern_pg:public:extra", "postgres:govern_pg:%ZZ", "postgres:govern_pg:%00"]:
        status, result = request("bootstrap", parameters={**packed, "database": invalid})
        check(status == 403 and result.get("error_code") == "database_not_available",
              "Packed keys cannot select malformed or unconfigured scopes")
    for metadata in [{"connection": "mariadb"}, {"connection": "postgres"}, {"connection": ""},
                     {"schema": "archive"}, {"schema": "public"}, {"schema": ""}]:
        status, result = request("bootstrap", parameters={**packed, **metadata})
        check(status == 403 and result.get("error_code") == "database_not_available",
              "Packed keys cannot replace explicit connection or schema parameters")
    check(data["database"]["name"] == "govern_pg" and data["database"]["schema"] == "public"
          and data["database"]["connection"] == "postgres" and data["database"]["available"],
          "Bootstrap reports the actual engine, database and schema")
    check(data["scope_key"] == "postgres:govern_pg:public", "Selection carries its stable scoped identity")
    check(all(data["capabilities"].get(name) is True for name in ["browse", "schema", "structure", "write", "query", "snapshots", "import", "create_table"]),
          "PostgreSQL advertises its supported catalog, SQL, import and checkpoint operations")
    check(all(data["capabilities"].get(name) is False for name in ["query_builder", "saved_queries",
          "phpmyadmin", "ai", "context"]), "Unsupported capabilities remain explicit")
    status, result = request("database-workflows")
    check(status == 200 and result.get("ok"), "The authenticated workflow capability catalog is available")
    postgres_engine = next(item for item in result["data"]["engines"] if item["id"] == "postgres")
    check(postgres_engine["can_create"] is True and data["capabilities"]["create_database"] is True
          and data["can_create_database"] is True,
          "A ready private PostgreSQL provisioner enables explicit database creation")
    entries = [item for item in data["databases"] if item.get("connection") == "postgres" and item["name"] == "govern_pg"]
    check(len(entries) == 1 and entries[0]["scope_key"] == "postgres:govern_pg:public"
          and {"public", "archive"}.issubset(entries[0]["schemas"])
          and {"public", "archive"}.issubset(entries[0]["available_schemas"]),
          "The picker has one PostgreSQL database identity with public and archive as secondary schemas")
    status, result = request("bootstrap", parameters={**packed, "database": "postgres:govern_pg:archive"})
    check(status == 200 and result["data"]["scope_key"] == "postgres:govern_pg:archive"
          and result["data"]["database"]["schema"] == "archive",
          "Existing packed schema URLs retain their exact namespace after picker normalization")

    status, result = request("schema")
    check(status == 200 and result["data"]["database"] == "public", "Diagram metadata uses the selected namespace")
    tables = {item["name"]: item for item in result["data"]["tables"]}
    fk = tables["govern_pg_child"]["foreign_keys"][0]
    check(fk["columns"] == ["parent_id", "tenant_id"] and fk["referenced_columns"] == ["id", "tenant_id"],
          "Composite key pairs survive JSON serialization")
    status, result = request("browse", parameters={"table": "govern_pg_values", "page_size": 1})
    row = result["data"]["rows"][0]
    check(status == 200 and row["id"] == "9007199254740993" and row["amount"] == "123456789012345678901234.12"
          and row["missing"] is None and row["payload"] == "0x00ff41", "HTTP previews preserve exact values, NULL and binary data")
    status, result = request("browse", parameters={"schema": "archive", "table": "govern_pg_values"})
    check(status == 200 and result["data"]["rows"] == [{"id": "1", "label": "Archive-only row"}],
          "The same table name resolves to the explicitly requested schema")
    status, result = request("browse", parameters={"table": "govern_pg_values"})
    check(status == 200 and result["data"]["rows"][0]["label"] == "literal%_value", "Schema selection does not leak between requests")
    status, result = request("structure", parameters={"table": "govern_pg_values"})
    check(status == 200 and result["data"]["create_sql"] == "", "Structure does not invent complete PostgreSQL DDL")

    for action in ["queries", "context", "ai-status"]:
        status, result = request(action, parameters={"table": "govern_pg_values", "id": "unavailable"})
        check(status == 403 and result.get("error_code") == "postgres_read_only", "PostgreSQL rejects unsupported GET " + action)
    for action, payload in [
        ("query", {"design": {}}), ("build-query", {"design": {}}),
        ("save-query", {"name": "unsupported", "sql": "SELECT 1"}), ("delete-query", {"id": 1}),
        ("prepare-database", {"name": "unsupported"}), ("ai-context", {}), ("ai-chat", {}),
    ]:
        status, result = request(action, payload)
        check(status == 403 and result.get("error_code") == "postgres_read_only", "PostgreSQL rejects unsupported POST " + action)
        check(set(result.get("error_i18n", {})) == {"nl", "en"}, "Capability errors remain bilingual")
    for action in ["dataset-preview", "dataset-import"]:
        status, result = request(action, upload=True, authenticated=False)
        check(status == 401 and result.get("error_code") == "auth_required",
              "Multipart import requires an approved account before inspecting uploads")
        status, result = request(action, upload=True, token=False)
        check(status == 403 and result.get("error_code") == "csrf_invalid",
              "Multipart import preserves CSRF validation")
        status, result = request(action, upload=True)
        check((status == 200 and result.get("ok")) if action == "dataset-preview" else status == 409 and result.get("error_code") == "dataset_changed",
              "PostgreSQL previews table files and refuses import without explicit confirmation")
    status, result = request("query", {"sql": "SELECT 1"}, token=False)
    check(status == 403 and result.get("error_code") == "csrf_invalid", "CSRF remains enforced for writable PostgreSQL SQL")
    status, result = request("bootstrap", parameters={"schema": "pg_catalog"})
    check(status == 403 and not result["ok"], "Unconfigured PostgreSQL namespaces are not selectable")
    status, result = request("bootstrap", parameters={"database": "postgres"})
    check(status == 403 and not result["ok"], "A caller cannot change to another PostgreSQL database")
    status, result = request("bootstrap", parameters={"connection": "mariadb", "database": "bestuursatlas", "schema": ""})
    check(status == 200 and result["data"]["database"]["available"] and any(table["name"] == "organizations" for table in result["data"]["tables"]),
          "The original MariaDB workspace is still available after PostgreSQL requests")
    print(f"PASS: {checks} authenticated PostgreSQL HTTP, scope, capability and guest-access checks.")


if __name__ == "__main__":
    main()

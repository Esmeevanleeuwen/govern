#!/usr/bin/env python3
"""Authenticated read-only PostgreSQL API checks against an isolated local stack."""
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

    def request(action, payload=None, parameters=None, *, authenticated=True, token=True):
        query = {"action": action, **scope, **(parameters or {})}
        headers = {"Accept": "application/json", "Accept-Language": "en"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers.update({"Content-Type": "application/json"})
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
    check(data["database"]["name"] == "govern_pg" and data["database"]["schema"] == "public"
          and data["database"]["connection"] == "postgres" and data["database"]["available"],
          "Bootstrap reports the actual engine, database and schema")
    check(data["scope_key"] == "postgres:govern_pg:public", "Selection carries its stable scoped identity")
    check(all(data["capabilities"].get(name) is True for name in ["browse", "schema", "structure"]),
          "The first slice advertises its supported read operations")
    check(all(data["capabilities"].get(name) is False for name in ["write", "query", "saved_queries", "snapshots",
          "phpmyadmin", "import", "create_database", "ai", "context"]), "Unsupported capabilities are explicit")
    public_entry = next(item for item in data["databases"] if item.get("scope_key") == "postgres:govern_pg:public")
    archive_entry = next(item for item in data["databases"] if item.get("scope_key") == "postgres:govern_pg:archive")
    check(public_entry["name"] == archive_entry["name"] == "govern_pg" and public_entry["schema"] != archive_entry["schema"],
          "The connection picker distinguishes schemas within the same database")

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

    for action in ["queries", "snapshots", "download-snapshot", "context", "import-inspection", "row-editor", "ai-status"]:
        status, result = request(action, parameters={"table": "govern_pg_values", "id": "unavailable"})
        check(status == 403 and result.get("error_code") == "postgres_read_only", "PostgreSQL rejects unsupported GET " + action)
    for action, payload in [
        ("query", {"sql": "SELECT 1"}), ("build-query", {"design": {}}),
        ("insert-row", {"table": "govern_pg_values", "values": {}}),
        ("update-row", {"table": "govern_pg_values", "key": {"id": "1"}, "values": {}}),
        ("delete-row", {"table": "govern_pg_values", "key": {"id": "1"}}),
        ("save-query", {"name": "unsupported", "sql": "SELECT 1"}), ("delete-query", {"id": 1}),
        ("create-snapshot", {"label": "unsupported"}), ("restore-snapshot", {"id": "unsupported", "confirmation": "govern_pg"}),
        ("prepare-database", {"name": "unsupported"}), ("ai-context", {}), ("ai-chat", {}),
    ]:
        status, result = request(action, payload)
        check(status == 403 and result.get("error_code") == "postgres_read_only", "PostgreSQL rejects unsupported POST " + action)
        check(set(result.get("error_i18n", {})) == {"nl", "en"}, "Capability errors remain bilingual")
    status, result = request("query", {"sql": "SELECT 1"}, token=False)
    check(status == 403 and result.get("error_code") == "csrf_invalid", "CSRF checks still precede unsupported mutation handling")
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

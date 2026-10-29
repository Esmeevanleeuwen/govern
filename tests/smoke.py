#!/usr/bin/env python3
"""HTTP user flows against an already running, isolated Govern test stack.

Creates then removes one saved query and creates a downloadable checkpoint.
Does not restore or delete a database; backup_integration.php owns that test.
Uses only Python's standard library, not an application-side database shortcut.
"""
import argparse
import http.cookiejar
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    client = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    csrf = None
    checks = []

    def check(condition, title):
        if not condition:
            raise AssertionError(title)
        checks.append(title)

    def request(action, payload=None, parameters=None, token=True):
        query = {"action": action, **(parameters or {})}
        headers = {"Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
            if token:
                headers["X-CSRF-Token"] = csrf or ""
        req = urllib.request.Request(
            base + "/api.php?" + urllib.parse.urlencode(query),
            data=data,
            headers=headers,
        )
        try:
            response = client.open(req, timeout=60)
        except urllib.error.HTTPError as error:
            response = error
        body = response.read()
        content_type = response.headers.get("Content-Type", "")
        value = json.loads(body) if "application/json" in content_type else body
        return response.status, value, response.headers

    for attempt in range(40):
        try:
            status, result, _ = request("bootstrap")
            if status == 200 and result.get("data", {}).get("database", {}).get("available"):
                break
        except (OSError, ValueError):
            pass
        time.sleep(1)
    else:
        raise RuntimeError("Govern did not become available within40seconds")

    data = result["data"]
    csrf = data["csrf"]
    database = data["database"]["name"]
    check(len(csrf) >= 32 and data["stats"]["tables"] >= 23, "Real bootstrap and CSRF session")
    check(all(not t["name"].startswith("_govern_") for t in data["tables"]), "Content explorer keeps internal metadata separate in its display")

    status, result, _ = request("schema")
    check(status == 200 and result["ok"] is True, "Schema visualizer metadata is available over HTTP")
    schema = result["data"]
    check(set(schema) == {"database", "tables"} and schema["database"] == database,
          "Schema response names only the configured database and its diagram metadata")
    schema_tables = {table["name"]: table for table in schema["tables"]}
    check(set(schema_tables) == {table["name"] for table in data["tables"]}
          and len(schema_tables) == data["stats"]["tables"] + data["stats"]["views"],
          "Schema diagram includes every bootstrap table and view")
    check(all(set(table) == {"name", "type", "comment", "columns", "foreign_keys"}
              and not table["name"].startswith("_govern_") for table in schema["tables"]),
          "Schema metadata contains no rows, DDL, saved research or internal support tables")
    check(all(isinstance(table["columns"], list) and isinstance(table["foreign_keys"], list)
              and all(isinstance(column["primary"], bool) and isinstance(column["nullable"], bool)
                      and isinstance(column["name"], str) and isinstance(column["type"], str)
                      for column in table["columns"]) for table in schema["tables"]),
          "Schema exposes exact column names, types and primary-key/nullability flags")
    check(all(len(key["columns"]) == len(key["referenced_columns"]) > 0
              and isinstance(key["referenced_schema"], str)
              for table in schema["tables"] for key in table["foreign_keys"]),
          "Schema relationships retain ordered key pairs and qualified targets")
    status, result, _ = request("schema", {})
    check(status == 405 and result["ok"] is False, "Schema endpoint accepts read-only GET requests only")

    status, result, _ = request("browse", parameters={"table": "digital_systems"})
    check(status == 200 and result["data"]["total"] >= 1 and result["data"]["rows"], "Browse real seeded rows")
    status, result, _ = request("browse", parameters={"table": "digital_systems", "q": "DigiD", "page_size": 1})
    check(status == 200 and result["data"]["total"] == 1 and len(result["data"]["rows"]) == 1, "Filter and pagination return the expected row")
    status, result, _ = request("structure", parameters={"table": "system_responsibilities"})
    check(status == 200 and result["data"]["foreign_keys"] and "CREATE TABLE" in result["data"]["create_sql"], "Structure describes actual foreign keys and DDL")
    check(any(c["generated"] for c in result["data"]["columns"]), "Generated columns remain identified")
    organization_link = next(fk for fk in result["data"]["foreign_keys"] if fk["referenced_table"] == "organizations")
    check(schema_tables["system_responsibilities"]["columns"] == result["data"]["columns"]
          and schema_tables["system_responsibilities"]["foreign_keys"] == result["data"]["foreign_keys"],
          "Schema diagram metadata agrees with live single-table structure")

    design = {
        "table": "digital_systems", "join": None,
        "columns": [{"source": "base", "column": "code"}, {"source": "base", "column": "name"}],
        "filters": [{"source": "base", "column": "name", "operator": "contains", "value": "DigiD"}],
        "match": "all", "order": [{"source": "base", "column": "code", "direction": "asc"}], "limit": 25,
    }
    status, result, _ = request("build-query", {"design": design})
    check(status == 200 and result["ok"] and result["data"]["explanation"], "Visual design produces editable SQL and an explanation")
    designed_sql = result["data"]["sql"]
    status, result, _ = request("query", {"design": design})
    check(status == 200 and result["data"]["columns"] == ["code", "name"] and len(result["data"]["rows"]) == 1
          and result["data"]["rows"][0][1] == "DigiD", "Visual design executes against actual data with bound filter values")
    designed_rows = result["data"]["rows"]
    status, result, _ = request("query", {"sql": designed_sql})
    check(status == 200 and result["data"]["statements"][0]["rows"] == designed_rows, "Editable generated SQL returns the same rows as the bound design")

    join_design = {
        "table": "system_responsibilities", "join": {"foreign_key": organization_link["name"], "type": "left"},
        "columns": [{"source": "base", "column": "responsibility_role"}, {"source": "related", "column": "name"}],
        "filters": [], "match": "all", "order": [{"source": "related", "column": "name", "direction": "asc"}], "limit": 25,
    }
    status, result, _ = request("query", {"design": join_design})
    check(status == 200 and result["data"]["columns"] == ["basis.responsibility_role", "gekoppeld.name"]
          and result["data"]["returned_rows"] > 0, "Visual JOIN follows the live foreign key and preserves distinct column labels")
    status, result, _ = request("build-query", {"design": design}, token=False)
    check(status == 403 and result["ok"] is False, "Visual query generation requires the session CSRF token")
    status, result, _ = request("query", {"sql": "SELECT 1", "design": design})
    check(status == 422 and result["ok"] is False, "A request cannot silently choose between a design and manual SQL")
    invalid_design = {**design, "columns": [{"source": "base", "column": "name` FROM mysql.user --"}]}
    status, result, _ = request("build-query", {"design": invalid_design})
    check(status == 422 and result["ok"] is False, "A fabricated identifier cannot bypass live column validation")

    status, result, _ = request("query", {"sql": "SELECT 1 AS value, 2 AS value, NULL AS missing"})
    check(status == 200 and result["data"]["statements"][0]["columns"] == ["value", "value", "missing"] and result["data"]["statements"][0]["rows"] == [["1", "2", None]], "Query preserves duplicate aliases and NULL")
    status, result, _ = request("query", {"sql": "SELECT 1"}, token=False)
    check(status == 403 and result["ok"] is False, "A write-style request requires the browser CSRF token")
    status, result, _ = request("query", {"sql": "UPDATE digital_systems SET name='should not happen'"})
    check(status == 200 and result["data"]["confirm_required"] is True
          and result["data"]["destructive"][0]["reason"] == "update_no_where", "UPDATE without WHERE asks for confirmation and changes nothing")
    status, result, _ = request("query", {"sql": "SELECT 1; SELECT 2"})
    check(status == 200 and [s["rows"] for s in result["data"]["statements"]] == [[["1"]], [["2"]]], "Several statements run in one request")

    saved_id = None
    try:
        name = "HTTP-check " + uuid.uuid4().hex[:8]
        status, result, _ = request("save-query", {"name": name, "sql": designed_sql, "notes": "Visueel samengesteld, bewaard als gewone SQL"})
        check(status in (200, 201) and result["ok"], "Save a real investigation")
        saved_id = result["data"]["id"]
        status, result, _ = request("queries")
        check(any(str(q["id"]) == str(saved_id) for q in result["data"]), "Saved investigation is read back")
        saved_query = next(q for q in result["data"] if str(q["id"]) == str(saved_id))
        status, result, _ = request("query", {"sql": saved_query["sql"]})
        check(status == 200 and result["data"]["statements"][0]["rows"] == designed_rows, "Saved visual investigation remains executable ordinary SQL")
        status, context, headers = request("context")
        check(status == 200 and context["format"] == "govern-context" and "attachment" in headers.get("Content-Disposition", ""), "Schema and query context can be downloaded")
        check("rows" not in context and "password" not in context and len(context["schema"]) >= 23, "Context is schema-based, without record export or credentials")
    finally:
        if saved_id is not None:
            status, result, _ = request("delete-query", {"id": saved_id})
            check(status == 200 and result["ok"], "Test investigation is removed")

    status, result, _ = request("create-snapshot", {"label": "HTTP-integratiecontrole"})
    check(status == 201 and result["data"]["size_bytes"] > 1000, "Create a real SQL checkpoint over HTTP")
    snapshot_id = result["data"]["id"]
    status, dump, headers = request("download-snapshot", parameters={"id": snapshot_id})
    check(status == 200 and b"CREATE TABLE" in dump and "attachment" in headers.get("Content-Disposition", ""), "Download contains actual schema and data")
    status, result, _ = request("restore-snapshot", {"id": snapshot_id, "confirmation": "incorrect"})
    check(status == 422 and result["ok"] is False, "Incorrect restore confirmation makes no destructive change")

    pma_url = base + "/phpmyadmin/index.php?" + urllib.parse.urlencode({"route": "/sql", "db": database, "table": "digital_systems"})
    response = client.open(pma_url, timeout=30)
    body = response.read().decode("utf-8", errors="replace")
    check(response.status == 200 and "digital_systems" in body and "phpMyAdmin" in body and "mysqli_sql_exception" not in body, "Real phpMyAdmin renders the selected table behind the proxy")
    check(response.headers.get("X-Frame-Options", "").upper() == "SAMEORIGIN", "Embedding is limited to the same origin")
    check(all("/phpmyadmin/phpmyadmin/" not in cookie for cookie in response.headers.get_all("Set-Cookie", [])), "Proxy does not duplicate the phpMyAdmin cookie path")
    print(json.dumps({"passed": len(checks), "failed": 0, "checks": checks}, indent=2))


if __name__ == "__main__":
    main()

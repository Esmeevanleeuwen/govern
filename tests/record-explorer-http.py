#!/usr/bin/env python3
"""Read-only record exploration through the authenticated, isolated HTTP API."""
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
        raise RuntimeError("Use the isolated govern_pg fixture and demo dataset")
    base = args.base_url.rstrip("/")
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    session = ensure_authenticated(client, base)
    csrf = session["csrf"]
    checks = 0
    scope = {"connection": "postgres", "database": "govern_pg", "schema": "public"}

    def check(condition, message):
        nonlocal checks
        if not condition:
            raise AssertionError(message)
        checks += 1

    def request(action="explore", parameters=None, *, body=None, authenticated=True):
        query = {key: value for key, value in {"action": action, **scope, **(parameters or {})}.items()
                 if value is not None}
        headers = {"Accept": "application/json", "Accept-Language": "en"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers.update({"Content-Type": "application/json", "X-CSRF-Token": csrf})
        req = urllib.request.Request(base + "/api.php?" + urllib.parse.urlencode(query), data=data, headers=headers)
        opener = client if authenticated else urllib.request.build_opener()
        try:
            response = opener.open(req, timeout=40)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read()), response.headers

    public = {"table": "demo_organizations", "key": json.dumps({"id": "1"})}
    status, result, _ = request(parameters=public, authenticated=False)
    check(status == 401 and not result["ok"], "Guests cannot read record graphs")
    status, result, headers = request(parameters=public, body={})
    check(status == 405 and not result["ok"] and headers.get("Allow") == "GET",
          "Record exploration accepts GET only")

    status, result, _ = request(parameters=public)
    check(status == 200 and result["ok"], "An authenticated record neighborhood is available")
    data = result["data"]
    check(data["scope_key"] == "postgres:govern_pg:public" and data["table"] == "demo_organizations",
          "The graph identifies its exact connection, database and schema")
    nodes = {node["id"]: node for node in data["nodes"]}
    center = nodes[data["center"]]
    check(center["table"] == "demo_organizations" and center["key"] == {"id": "1"}
          and center["label"] == "Northbridge Council", "The requested exact record is the graph center")
    check(len(data["candidates"]) == 5 and any(item["key"] == {"id": "2"} for item in data["candidates"]),
          "The root picker has real records from the requested table")
    check(any(node["table"] == "demo_systems" and node["key"] == {"id": "1"} for node in nodes.values()),
          "Incoming ownership links include the actual Resident Services Portal record")
    check(any(node["table"] == "demo_contacts" and node["key"] == {"id": "1"} for node in nodes.values()),
          "Incoming contact links include actual contact records")
    check(any(node["table"] == "demo_project_participants" and node["key"] == {"project_id": "1", "organization_id": "1"}
              for node in nodes.values()), "Composite-key participation records retain both exact identity columns")
    check(all(edge["source"] in nodes and edge["target"] in nodes for edge in data["edges"]),
          "Every displayed edge has two returned source records")
    check(all(data["center"] in [edge["source"], edge["target"]] for edge in data["edges"]),
          "The first slice reports an explicit one-hop neighborhood")
    status, schema, _ = request("schema")
    check(status == 200 and schema["ok"], "The live catalog is available for evidence comparison")
    catalog = {table["name"]: table for table in schema["data"]["tables"]}
    for edge in data["edges"]:
        matching = [key for key in catalog[edge["source_table"]]["foreign_keys"]
                    if key["name"] == edge["name"] and key["referenced_table"] == edge["target_table"]
                    and key["columns"] == edge["columns"] and key["referenced_columns"] == edge["referenced_columns"]]
        check(len(matching) == 1, "A graph edge names the actual catalog foreign key")
        check(nodes[edge["source"]]["table"] == edge["source_table"]
              and nodes[edge["target"]]["table"] == edge["target_table"], "Edge direction is child record to referenced parent")
        check(all(edge["source_values"][left] == edge["target_values"][right]
                  for left, right in zip(edge["columns"], edge["referenced_columns"])),
              "Relationship evidence contains the genuine matching source and target values")
    check(len(nodes) <= data["limits"]["max_nodes"] and len(data["edges"]) <= data["limits"]["max_edges"],
          "The returned graph respects its published bounds")
    check(isinstance(data["partial"], bool) and isinstance(data["omitted"], list)
          and isinstance(data["elapsed_ms"], (int, float)), "Coverage and query timing are explicit metadata")
    status, again, _ = request(parameters=public)
    check(status == 200 and again["data"]["center"] == data["center"]
          and {node["id"] for node in again["data"]["nodes"]} == set(nodes), "Record IDs remain stable between equivalent reads")

    status, result, _ = request(parameters={"table": "govern_pg_values", "key": json.dumps({"id": "9007199254740993"})})
    check(status == 200 and result["ok"], "A BIGINT-key record is available through HTTP")
    big = next(node for node in result["data"]["nodes"] if node["id"] == result["data"]["center"])
    check(big["key"] == {"id": "9007199254740993"}
          and big["values"]["id"] == "9007199254740993", "BIGINT identities never pass through floating-point conversion")
    check(big["values"]["amount"] == "123456789012345678901234.12", "Exact DECIMAL previews remain exact strings")

    composite = {"table": "govern_pg_parent", "key": json.dumps({"tenant_id": "7", "id": "11"})}
    status, result, _ = request(parameters=composite)
    check(status == 200 and result["ok"], "A complete composite primary key selects its parent")
    parent_graph = result["data"]
    composite_edge = next(edge for edge in parent_graph["edges"] if edge["name"] == "govern_pg_composite_fk")
    check(composite_edge["columns"] == ["parent_id", "tenant_id"]
          and composite_edge["referenced_columns"] == ["id", "tenant_id"]
          and composite_edge["source_values"] == {"parent_id": "11", "tenant_id": "7"},
          "Composite relationship evidence preserves key-column pairing and exact values")

    for key in ["[]", "null", "{", json.dumps({"id": None}), json.dumps({"id": ["1"]}),
                json.dumps({"id": "1", "name": "extra"})]:
        status, result, _ = request(parameters={"table": "demo_organizations", "key": key})
        check(status == 422 and not result["ok"], "Malformed or non-exact record keys are rejected")
    status, result, _ = request(parameters={"table": "govern_pg_parent", "key": json.dumps({"id": "11"})})
    check(status == 422 and not result["ok"], "A partial composite key cannot choose a record")
    status, result, _ = request(parameters={"table": "demo_organizations", "key": json.dumps({"id": "999999"})})
    check(status == 404 and not result["ok"], "A missing record is distinct from an empty graph")
    for table in ["not_a_real_table", "pg_catalog.pg_class", "_govern_pg_internal_probe"]:
        status, result, _ = request(parameters={"table": table})
        check(status == 404 and not result["ok"], "Only tables in the selected visible catalog are explored")
    status, result, _ = request(parameters={"table": "demo_project_overview"})
    check(status == 200 and result["data"]["center"] is None and result["data"]["nodes"] == []
          and any(item["code"] == "keyless" for item in result["data"]["omitted"]),
          "A keyless view reports unavailable identity without inventing record nodes")

    status, result, _ = request(parameters={"table": "govern_pg_values", "schema": "archive", "key": json.dumps({"id": "1"})})
    check(status == 200 and result["data"]["scope_key"] == "postgres:govern_pg:archive"
          and all(node["table"] == "govern_pg_values" and node["values"].get("label") == "Archive-only row"
                  for node in result["data"]["nodes"]), "A same-named table in another configured schema has separate records")
    for metadata in [{"schema": "pg_catalog"}, {"database": "postgres"}, {"connection": "unknown"}]:
        status, result, _ = request(parameters={**public, **metadata})
        check(status == 403 and result.get("error_code") == "database_not_available",
              "Exploration cannot leave the configured connection and schema")
    packed = {"table": "demo_organizations", "key": json.dumps({"id": "1"}),
              "database": "postgres:govern_pg:public", "connection": None, "schema": None}
    status, result, _ = request(parameters=packed)
    check(status == 200 and result["data"]["center"] == data["center"], "Cached-client packed scopes retain the same record identity")
    status, result, _ = request("query", body={"sql": "SELECT 1"})
    check(status == 200 and result["ok"] and result["data"]["failed"] is None
          and result["data"]["executed"] == 1 and result["data"]["statements"][0]["rows"] == [["1"]],
          "The separate native SQL route works alongside the read-only record explorer")
    status, result, _ = request(parameters={"connection": "mariadb", "database": "bestuursatlas", "schema": None,
                                           "table": "organizations"})
    check(status == 200 and result["data"]["scope_key"] == "bestuursatlas"
          and result["data"]["nodes"], "The same read-only explorer works with MariaDB catalog metadata")
    print(f"PASS: {checks} authenticated record-explorer HTTP, evidence, exact-key and scope checks.")


if __name__ == "__main__":
    main()

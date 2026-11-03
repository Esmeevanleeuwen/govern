#!/usr/bin/env python3
"""Authenticated map reads and boundaries in the disposable two-engine Docker stack."""
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
    parser.add_argument("--confirm-fixtures", required=True, choices=["record-map-ci"])
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    account = ensure_authenticated(client, base)
    csrf = account["csrf"]
    checks = 0

    def check(condition, message):
        nonlocal checks
        if not condition:
            raise AssertionError(message)
        checks += 1

    def request(scope, action, payload=None, params=None, *, guest=False, token=True):
        query = {"action": action, **scope, **(params or {})}
        headers = {"Accept": "application/json", "Accept-Language": "en"}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
            if token:
                headers["X-CSRF-Token"] = csrf
        req = urllib.request.Request(base + "/api.php?" + urllib.parse.urlencode(query), data=body, headers=headers)
        opener = urllib.request.build_opener() if guest else client
        try:
            response = opener.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    nodes_by_engine = {}
    for engine, scope in [
        ("mariadb", {"database": "bestuursatlas"}),
        ("postgres", {"connection": "postgres", "database": "govern_pg", "schema": "public"}),
    ]:
        params = {"table": "zz_record_map_people", "q": "%_"}
        status, result = request(scope, "record-map-records", params=params, guest=True)
        check(status == 401 and result.get("error_code") == "auth_required", engine + " root records require login")
        status, result = request(scope, "bootstrap")
        check(status == 200 and result["data"]["capabilities"]["record_map"] is True, engine + " advertises the read-only map capability")
        status, result = request(scope, "record-map-records", params=params)
        check(status == 200 and result["ok"] and result["data"]["supported"], engine + " live root choices are available")
        roots = result["data"]["nodes"]
        check(len(roots) == 1 and roots[0]["key"] == {"id": "9007199254740993"}, engine + " seed keys survive JSON without precision loss")
        root = roots[0]
        nodes_by_engine[engine] = root["id"]
        check(isinstance(root["row"], dict) and root["row"]["payload"] == "0x00ff41"
              and root["row"]["amount"] == "123456789012345678901234.12", engine + " source data preserves exact and binary values")
        body = {"table": root["table"], "key": root["key"]}
        status, result = request(scope, "record-map", body, token=False)
        check(status == 403 and result.get("error_code") == "csrf_invalid", engine + " inspection POST retains CSRF protection")
        status, result = request(scope, "record-map", body, guest=True)
        check(status == 401 and result.get("error_code") == "auth_required", engine + " inspection POST rejects guests before reading records")
        status, result = request(scope, "record-map", body)
        check(status == 200 and result["data"]["focus"]["id"] == root["id"], engine + " explicit inspection selects the same exact root")
        relations = result["data"]["relations"]
        incoming = next(item for item in relations if item["constraint"] == "zz_record_map_project_lead" and item["direction"] == "incoming")
        status, result = request(scope, "record-map", {**body, "relation": incoming["id"], "page_size": 1})
        check(status == 200 and len(result["data"]["edges"]) == 1 and result["data"]["has_more"], engine + " expansion has explicit paginated neighbours")
        edge = result["data"]["edges"][0]
        check(edge["kind"] == "foreign_key" and edge["target"] == root["id"] and edge["target_key"] == root["key"], engine + " evidence retains actual FK direction and identity")
        check(edge["evidence"]["column_pairs"] == [{"source": "lead_id", "target": "id"}]
              and "zz_record_map_projects" in edge["evidence"]["sql"], engine + " source inspector receives declared column and SQL provenance")
        external = next(item for item in relations if item["constraint"] == "zz_record_map_people_external")
        status, result = request(scope, "record-map", {**body, "relation": external["id"]})
        check(status == 422 and result.get("error_code") == "record_map_relation_unsupported", engine + " cannot expand a relationship outside the selected scope")
        status, result = request(scope, "record-map", {**body, "sql": "DROP TABLE zz_record_map_people"})
        check(status == 422 and result.get("error_code") == "record_map_input_invalid", engine + " map endpoint accepts no caller-supplied SQL")
        check(set(result.get("error_i18n", {})) == {"en", "nl"}, engine + " map failures remain bilingual")
        status, result = request(scope, "record-map", {"table": root["table"], "key": {"id": 9007199254740993}})
        check(status == 422 and result.get("error_code") == "record_map_input_invalid", engine + " numeric JSON keys cannot silently lose identity precision")
        status, result = request(scope, "record-map", params={"table": root["table"]})
        check(status == 405, engine + " record inspection requires its authenticated read POST shape")
        status, result = request(scope, "record-map-records", params={"table": "zz_record_map_no_identity"})
        check(status == 200 and result["data"]["supported"] is False and not result["data"]["nodes"], engine + " unkeyed data receives an explicit unsupported state")
    check(nodes_by_engine["mariadb"] != nodes_by_engine["postgres"], "Equal table and key names in different engines cannot share node identity")
    scope = {"connection": "postgres", "database": "govern_pg", "schema": "archive"}
    status, result = request(scope, "record-map", {"table": "zz_record_map_people", "key": {"id": "9007199254740993"}})
    check(status == 200 and result["data"]["focus"]["row"]["name"] == "Archive-only record"
          and result["data"]["focus"]["id"] != nodes_by_engine["postgres"], "Explicit PostgreSQL schema selects different source data and graph identity")
    print(f"PASS: {checks} record-map HTTP, auth, exact-value, source and scope checks.")


if __name__ == "__main__":
    main()

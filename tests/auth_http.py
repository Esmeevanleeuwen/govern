#!/usr/bin/env python3
"""Real login helper for the isolated HTTP/browser suites, never an auth bypass.

An explicit --initialize creates the first owner only when none exists. Test
credentials come from GOVERN_TEST_EMAIL/GOVERN_TEST_PASSWORD and are not printed.
"""
import argparse
import http.cookiejar
import json
import os
import urllib.error
import urllib.parse
import urllib.request


def ensure_authenticated(client, base, *, initialize=False):
    if urllib.parse.urlparse(base).hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("Use only an isolated loopback test stack")
    email = os.environ.get("GOVERN_TEST_EMAIL")
    password = os.environ.get("GOVERN_TEST_PASSWORD")
    if not email or not password:
        raise RuntimeError("Set dedicated GOVERN_TEST_EMAIL and GOVERN_TEST_PASSWORD for this isolated test stack")

    def request(action, payload=None, csrf=None):
        headers = {"Accept": "application/json"}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
            headers.update({"Content-Type": "application/json", "X-CSRF-Token": csrf or ""})
        req = urllib.request.Request(base.rstrip("/") + "/auth-api.php?action=" + action,
                                     data=body, headers=headers)
        try:
            response = client.open(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            value = json.loads(response.read())
            if response.status >= 400 or not value.get("ok"):
                raise RuntimeError("Test account authentication failed (" + str(value.get("error_code", response.status)) + ")")
            return value["data"]

    status = request("status")
    if (status.get("user") or {}).get("email") == email:
        return status
    if initialize and not status["has_owner"]:
        result = request("register", {"name": "Govern integration tests", "email": email, "password": password}, status["csrf"])
    else:
        result = request("login", {"email": email, "password": password}, status["csrf"])
    if not result.get("user") or result["user"].get("status") != "active":
        raise RuntimeError("The dedicated test account must be approved by the owner")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--initialize", action="store_true", help="Create the first owner in this disposable test installation")
    args = parser.parse_args()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    ensure_authenticated(client, args.base_url, initialize=args.initialize)
    print("Dedicated integration test account authenticated.")


if __name__ == "__main__":
    main()

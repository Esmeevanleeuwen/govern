#!/usr/bin/env python3
"""Verify the real Nginx/phpMyAdmin account boundary on an isolated Docker stack.

Requires the dedicated GOVERN_TEST_EMAIL/GOVERN_TEST_PASSWORD owner initialized
by tests/auth_http.py. Uses a separate browser cookie jar and changes no data.
"""
import argparse
import http.cookiejar
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from auth_http import ensure_authenticated


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, target):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    if urllib.parse.urlparse(base).hostname not in {"localhost", "127.0.0.1", "::1"}:
        parser.error("Use only an isolated loopback Docker gateway")
    if not os.environ.get("GOVERN_TEST_EMAIL") or not os.environ.get("GOVERN_TEST_PASSWORD"):
        parser.error("Set dedicated GOVERN_TEST_EMAIL and GOVERN_TEST_PASSWORD for this isolated stack")
    jar = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect())
    checks = []

    def check(condition, message):
        if not condition:
            raise AssertionError(message)
        checks.append(message)

    def request(path, payload=None, csrf=None, headers=None):
        headers = {"Accept-Language": "en", **(headers or {})}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers.update({"Content-Type": "application/json", "X-CSRF-Token": csrf or ""})
        req = urllib.request.Request(base + path, data=data, headers=headers)
        try:
            response = client.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read().decode("utf-8", errors="replace")
            return response.status, body, response.headers

    def cache_directives(headers):
        return {directive.strip().lower() for value in headers.get_all("Cache-Control", [])
                for directive in value.split(",")}

    # Cover entry modules and imported modules: refreshing only app.js is not
    # enough when api.js still has an older engine-selection contract cached.
    for path in ("/assets/app.js", "/assets/api.js", "/assets/styles.css"):
        code, body, headers = request(path)
        check(code == 200 and bool(body), "The gateway serves " + path)
        check("no-cache" in cache_directives(headers), "Browsers must revalidate " + path + " after an update")
        if headers.get("ETag"):
            code, _, validated = request(path, headers={"If-None-Match": headers["ETag"]})
            check(code == 304 and "no-cache" in cache_directives(validated),
                  "Conditional asset responses retain the revalidation policy for " + path)

    native = "/phpmyadmin/index.php?route=%2F&server=1&lang=en"

    def denied(path, state):
        code, body, headers = request(path)
        check(code == 302, state + " receives an explicit gateway redirect for " + path)
        check(urllib.parse.urljoin(base + "/", headers.get("Location", "")) == base + "/auth.php?mode=login",
              state + " is redirected only to the Govern login page")
        check("phpMyAdmin" not in body, state + " receives no native phpMyAdmin content")

    for path in ("/phpmyadmin/", native):
        denied(path, "Guest")

    code, body, session_headers = request("/auth-api.php?action=status")
    status = json.loads(body)
    check(code == 200 and status["ok"] and status["data"]["user"] is None,
          "The separate gateway test session starts as a guest")
    # session_start() emits its own no-cache directive alongside no-store.
    # Compare the session policy and header count, so an extra asset-only
    # header is still detected without forbidding PHP's existing policy.
    session_policy = cache_directives(session_headers)
    session_header_count = len(session_headers.get_all("Cache-Control", []))
    check("no-store" in session_policy, "Account sessions retain a no-store cache policy")
    code, body, _ = request("/auth-api.php?action=login", {
        "email": os.environ["GOVERN_TEST_EMAIL"],
        "password": os.environ["GOVERN_TEST_PASSWORD"] + "-deliberately-incorrect",
    }, status["data"]["csrf"])
    failure = json.loads(body)
    check(code == 401 and failure.get("error_code") == "auth_credentials_invalid",
          "An incorrect password does not authenticate the session")
    denied(native, "Failed login")

    session = ensure_authenticated(client, base)
    check(session["user"]["role"] == "owner", "The dedicated approved owner signs in through the real endpoint")
    code, body, headers = request("/api.php?action=databases")
    check(code == 200 and json.loads(body)["ok"], "The approved owner can still list database connections")
    check(cache_directives(headers) == session_policy
          and len(headers.get_all("Cache-Control", [])) == session_header_count,
          "The asset policy leaves the database API's session cache response unchanged")
    code, body, headers = request("/workspace.php")
    check(code == 200 and "app-shell" in body, "The approved owner can still load the workspace document")
    check(cache_directives(headers) == session_policy
          and len(headers.get_all("Cache-Control", [])) == session_header_count,
          "The asset policy leaves the workspace's session cache response unchanged")
    code, body, _ = request(native)
    check(code == 200 and "phpMyAdmin" in body, "The real gateway serves native phpMyAdmin to the approved owner")
    code, body, _ = request("/auth-api.php?action=logout", {}, session["csrf"])
    logged_out = json.loads(body)
    check(code == 200 and logged_out["ok"] and logged_out["data"]["user"] is None,
          "The same browser session logs out through the real endpoint")
    for path in ("/phpmyadmin/", native):
        denied(path, "Logged-out session")

    print(json.dumps({"passed": len(checks), "failed": 0, "checks": checks}, indent=2))


if __name__ == "__main__":
    main()

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

    def request(path, payload=None, csrf=None):
        headers = {"Accept-Language": "en"}
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

    native = "/phpmyadmin/index.php?route=%2F&server=1&lang=en"

    def denied(path, state):
        code, body, headers = request(path)
        check(code == 302, state + " receives an explicit gateway redirect for " + path)
        check(urllib.parse.urljoin(base + "/", headers.get("Location", "")) == base + "/auth.php?mode=login",
              state + " is redirected only to the Govern login page")
        check("phpMyAdmin" not in body, state + " receives no native phpMyAdmin content")

    for path in ("/phpmyadmin/", native):
        denied(path, "Guest")

    code, body, _ = request("/auth-api.php?action=status")
    status = json.loads(body)
    check(code == 200 and status["ok"] and status["data"]["user"] is None,
          "The separate gateway test session starts as a guest")
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

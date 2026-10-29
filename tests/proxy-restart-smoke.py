#!/usr/bin/env python3
"""Force changed backend addresses in an explicitly disposable Docker stack.

The database container and its volumes are never removed. This stops/recreates
only the two web containers, temporarily allocates extra network endpoints,
and verifies that the unchanged gateway resolves their changed IP addresses.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--confirm-project", required=True,
                        help="Name of an isolated Compose project whose web containers may be recreated")
    args = parser.parse_args()
    if os.environ.get("GOVERN_DOCKER_NETWORK_TEST") != "1":
        parser.error("Set GOVERN_DOCKER_NETWORK_TEST=1 only for an isolated Docker test stack")
    base = args.base_url.rstrip("/")
    if urllib.parse.urlparse(base).hostname not in {"localhost", "127.0.0.1", "::1"}:
        parser.error("The test gateway must be on loopback")
    if re.fullmatch(r"[a-z0-9][a-z0-9_-]*", args.confirm_project) is None:
        parser.error("Invalid Compose project name")
    repo = Path(__file__).resolve().parent.parent
    compose = ["docker", "compose", "-p", args.confirm_project]

    def command(*parts, check=True):
        result = subprocess.run(list(parts), cwd=repo, check=False, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=150)
        if check and result.returncode:
            raise RuntimeError("Docker network check command failed:\n" + result.stdout[-3000:])
        return result.stdout.strip()

    def inspect(container, template):
        return command("docker", "inspect", "--format", template, container)

    def service_id(service):
        value = command(*compose, "ps", "-q", service)
        if re.fullmatch(r"[0-9a-f]{12,64}", value) is None:
            raise RuntimeError("Expected one running test container for " + service)
        actual = inspect(value, '{{index .Config.Labels "com.docker.compose.project"}}')
        if actual != args.confirm_project:
            raise RuntimeError("Refusing to change a container outside the confirmed project")
        return value

    def request(path):
        with urllib.request.urlopen(base + path, timeout=4) as response:
            return response.status, response.read().decode("utf-8", errors="replace")

    def routes_work():
        status, html = request("/")
        if status != 200 or 'id="database-select"' not in html:
            return False
        status, body = request("/api.php?action=health")
        health = json.loads(body)
        if status != 200 or health.get("ok") is not True or health.get("data", {}).get("status") != "ok":
            return False
        status, pma = request("/phpmyadmin/index.php?route=%2F&server=1&lang=en")
        return status == 200 and "phpMyAdmin" in pma and 'id="database-select"' not in pma

    gateway = service_id("gateway")
    gateway_networks = json.loads(inspect(gateway, "{{json .NetworkSettings.Networks}}"))
    targets = []
    for service in ["app", "phpmyadmin"]:
        container = service_id(service)
        networks = json.loads(inspect(container, "{{json .NetworkSettings.Networks}}"))
        common = [name for name in networks if name in gateway_networks]
        if len(common) != 1 or not networks[common[0]].get("IPAddress"):
            raise RuntimeError("Expected one shared bridge network for " + service)
        targets.append({"service": service, "network": common[0],
                        "ip": networks[common[0]]["IPAddress"], "image": inspect(container, "{{.Image}}")})
    if not routes_work():
        raise RuntimeError("Initial Govern/API/phpMyAdmin routes are not healthy")

    reservations = []
    web_removed = False
    try:
        command(*compose, "rm", "--stop", "--force", "app", "phpmyadmin")
        web_removed = True
        token = uuid.uuid4().hex[:10]
        for attempt in range(3):
            for target in targets:
                name = "govern-proxy-test-" + token + "-" + str(attempt) + "-" + target["service"]
                reservations.append(name)
                # Default Compose networks do not allow user-specified --ip.
                # Let IPAM allocate the holders: first-free allocators occupy
                # old addresses, while sequential allocators advance naturally.
                command("docker", "run", "--detach", "--name", name,
                        "--network", target["network"],
                        "--entrypoint", "/bin/sh", target["image"], "-c", "sleep 300")

            command(*compose, "up", "--detach", "--no-deps", "--wait", "--wait-timeout", "90", "app", "phpmyadmin")
            if service_id("gateway") != gateway:
                raise AssertionError("The gateway must remain the same container during backend replacement")
            changed = []
            for target in targets:
                container = service_id(target["service"])
                networks = json.loads(inspect(container, "{{json .NetworkSettings.Networks}}"))
                changed.append(networks[target["network"]]["IPAddress"] != target["ip"])
            if all(changed):
                break
            # Keep the holders and retry only if an allocator reused an old IP.
            # The test must demonstrate changed addresses, never assume them.
            command(*compose, "rm", "--stop", "--force", "app", "phpmyadmin")
        else:
            raise AssertionError("Could not force changed app and phpMyAdmin IPs within three attempts")

        last_error = None
        for _ in range(30):
            try:
                if routes_work():
                    print("Proxy restart checks passed: changed app and phpMyAdmin IPs; unchanged gateway; correct Govern, API and phpMyAdmin routes.")
                    return
            except (OSError, ValueError, urllib.error.HTTPError) as error:
                last_error = str(error)
            time.sleep(1)
        raise AssertionError("The unchanged gateway did not recover both backend routes: " + (last_error or "wrong application response"))
    finally:
        for name in reservations:
            command("docker", "rm", "--force", name, check=False)
        if web_removed:
            # Leave the isolated stack usable for diagnostics and later checks.
            command(*compose, "up", "--detach", "--no-deps", "--wait", "--wait-timeout", "90", "app", "phpmyadmin", check=False)


if __name__ == "__main__":
    main()

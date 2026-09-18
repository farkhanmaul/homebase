"""Integration tests for the /api/office PocketBase backend.

These tests launch the real pinned PocketBase executable (tools/pocketbase)
against a throwaway data directory and port, then exercise the HTTP contract
over the network. Nothing is mocked: a failure here reflects the shipped
migration + hooks, not a test double.

Run with: npm run backend:test
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PB_BIN = Path(os.environ.get("POCKETBASE_BIN", REPO_ROOT / "tools" / "pocketbase"))
HOOKS_DIR = REPO_ROOT / "backend" / "pb_hooks"
MIGRATIONS_DIR = REPO_ROOT / "backend" / "pb_migrations"
ALLOWED_ORIGIN = "http://127.0.0.1:5173"
TIME_PATTERN = re.compile(r"^\d{2}:\d{2}$")
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
CLIENT_IP = "127.0.0.1"


def free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class Response:
    def __init__(self, status: int, headers: dict, body: bytes):
        self.status = status
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.body = body

    def json(self):
        return json.loads(self.body.decode("utf-8") or "{}")

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")


class PocketBaseServer:
    """Runs the real PocketBase binary on a temporary data dir/port."""

    def __init__(self, migrations_dir: Path | None = None, data_dir: str | None = None, **env_overrides: str):
        self.env_overrides = env_overrides
        self.migrations_dir = migrations_dir or MIGRATIONS_DIR
        # A caller may supply an existing data dir to exercise a real restart
        # (same database, a new process) instead of always starting empty.
        self.data_dir = data_dir or tempfile.mkdtemp(prefix="pb-office-test-")
        self.port = free_port()
        self.process: subprocess.Popen | None = None
        self._log_handle = None
        self._log_path = os.path.join(self.data_dir, "server.log")

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> "PocketBaseServer":
        if not PB_BIN.exists():
            raise unittest.SkipTest(f"PocketBase binary missing at {PB_BIN}; run npm run backend:setup")
        command = [
            str(PB_BIN),
            "serve",
            f"--dir={self.data_dir}",
            f"--hooksDir={HOOKS_DIR}",
            f"--migrationsDir={self.migrations_dir}",
            f"--http=127.0.0.1:{self.port}",
            f"--origins={ALLOWED_ORIGIN}",
        ]
        env = {**os.environ, **self.env_overrides}
        self._log_handle = open(self._log_path, "w", encoding="utf-8")
        self.process = subprocess.Popen(command, env=env, stdout=self._log_handle, stderr=subprocess.STDOUT)
        self._wait_until_ready()
        return self

    def _wait_until_ready(self, timeout: float = 30.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.process and self.process.poll() is not None:
                raise RuntimeError(f"PocketBase exited early:\n{self.log_tail()}")
            try:
                response = self.request("GET", "/api/health")
                if response.status == 200:
                    return
            except (urllib.error.URLError, ConnectionError, OSError):
                pass
            time.sleep(0.1)
        raise RuntimeError(f"PocketBase did not become ready in time:\n{self.log_tail()}")

    def log_tail(self, lines: int = 40) -> str:
        try:
            with open(self._log_path, "r", encoding="utf-8") as handle:
                return "".join(handle.readlines()[-lines:])
        except OSError:
            return "(no log)"

    def request(
        self,
        method: str,
        path: str,
        body=None,
        token: str | None = None,
        headers: dict | None = None,
    ) -> Response:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(self.url + path, data=data, method=method)
        request.add_header("Content-Type", "application/json")
        if token is not None:
            request.add_header("X-Office-Session", token)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with OPENER.open(request, timeout=15) as response:
                return Response(response.status, dict(response.headers), response.read())
        except urllib.error.HTTPError as error:
            return Response(error.code, dict(error.headers), error.read())

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        if self._log_handle:
            self._log_handle.close()
            self._log_handle = None

    def cleanup(self) -> None:
        self.stop()
        shutil.rmtree(self.data_dir, ignore_errors=True)

    def db(self) -> sqlite3.Connection:
        return sqlite3.connect(os.path.join(self.data_dir, "data.db"))


class ServerTestCase(unittest.TestCase):
    """Base class that gives each test class its own PocketBase process."""

    env: dict = {}

    @classmethod
    def setUpClass(cls):
        cls.server = PocketBaseServer(**cls.env).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.cleanup()

    def setUp(self):
        # Every rate-limited route reads the office_limits table on each request,
        # so wiping it here gives each test a clean, deterministic budget.
        self.reset_limits()

    def tearDown(self):
        # Surface server crashes with a useful log instead of an opaque failure.
        process = self.server.process
        if process and process.poll() is not None:
            self.fail(f"PocketBase exited during the test:\n{self.server.log_tail()}")

    # ----- helpers -------------------------------------------------------
    def characters(self):
        response = self.server.request("GET", "/api/office/characters")
        self.assertEqual(response.status, 200, response.text)
        return {row["id"]: row for row in response.json()["characters"]}

    def claim(self, character_id: int):
        response = self.server.request("POST", "/api/office/claim", {"id": character_id})
        self.assertEqual(response.status, 200, response.text)
        return response.json()["token"]

    def claim_with_cleanup(self, character_id: int) -> str:
        token = self.claim(character_id)
        self.addCleanup(self._release_quietly, token)
        return token

    def _release_quietly(self, token: str):
        try:
            self.server.request("POST", "/api/office/release", {}, token=token)
        except Exception:
            pass

    def messages(self):
        response = self.server.request("GET", "/api/office/messages")
        self.assertEqual(response.status, 200, response.text)
        return response.json()["messages"]

    def reset_limits(self):
        with self.server.db() as connection:
            connection.execute("DELETE FROM office_limits")

    def rate_count(self, bucket: str):
        with self.server.db() as connection:
            row = connection.execute("SELECT count FROM office_limits WHERE bucket = ?", (bucket,)).fetchone()
        return row[0] if row else None

    def insert_limit_row(self, bucket: str, window_start_ms: int, count: int = 1):
        record_id = ("stale_" + bucket)[:15]
        with self.server.db() as connection:
            connection.execute(
                "INSERT INTO office_limits (id, bucket, window_start, count) VALUES (?, ?, ?, ?)",
                (record_id, bucket, window_start_ms, count),
            )

    def clear_messages(self):
        with self.server.db() as connection:
            connection.execute("DELETE FROM office_messages")

    def lease_remaining_ms(self, character_id: int) -> int:
        with self.server.db() as connection:
            row = connection.execute(
                "SELECT lease_expires FROM office_characters WHERE cid = ?", (character_id,)
            ).fetchone()
        return row[0] - int(time.time() * 1000)

    def collection_fields(self, name: str) -> list[dict]:
        """The stored schema for a collection, straight from the PocketBase DB."""
        with self.server.db() as connection:
            row = connection.execute("SELECT fields FROM _collections WHERE name = ?", (name,)).fetchone()
        self.assertIsNotNone(row, f"collection {name} not found")
        return json.loads(row[0])

    def field_limits(self, collection: str, field: str) -> tuple[int, int]:
        fields = {entry["name"]: entry for entry in self.collection_fields(collection)}
        self.assertIn(field, fields)
        return fields[field]["min"], fields[field]["max"]


class CharacterContractTests(ServerTestCase):
    # Generous limits so the concurrency/claim-heavy contract tests stay
    # deterministic; each rate limit is verified explicitly by its own class.
    env = {
        "OFFICE_CLAIM_LIMIT": "100000",
        "OFFICE_RELEASE_LIMIT": "100000",
        "OFFICE_HEARTBEAT_LIMIT": "100000",
        "OFFICE_MESSAGE_LIMIT": "100000",
    }

    def test_characters_contract_has_exactly_six_and_no_token(self):
        response = self.server.request("GET", "/api/office/characters")
        self.assertEqual(response.status, 200)
        self.assertNotIn("lease_token_hash", response.text.lower())
        self.assertNotIn('"token"', response.text.lower())

        characters = response.json()["characters"]
        self.assertEqual(len(characters), 6)
        self.assertEqual(sorted(row["id"] for row in characters), [1, 2, 3, 4, 5, 6])
        for row in characters:
            self.assertIsInstance(row["active"], bool)
            self.assertIsInstance(row["x"], (int, float))
            self.assertIsInstance(row["y"], (int, float))
            self.assertGreaterEqual(row["x"], 0)
            self.assertLessEqual(row["x"], 1920)
            self.assertGreaterEqual(row["y"], 0)
            self.assertLessEqual(row["y"], 960)
            self.assertIn(row["direction"], ["up", "down", "left", "right"])
            self.assertIsInstance(row["status"], str)

    def test_claim_rejects_invalid_ids(self):
        for bad in [0, 7, -1, "abc", None, 1.5, {}]:
            response = self.server.request("POST", "/api/office/claim", {"id": bad})
            self.assertEqual(response.status, 400, f"id={bad!r} -> {response.text}")

    def test_claim_marks_active_and_duplicate_conflicts(self):
        token = self.claim_with_cleanup(1)
        self.assertIsInstance(token, str)
        self.assertGreaterEqual(len(token), 20)
        self.assertTrue(self.characters()[1]["active"])

        duplicate = self.server.request("POST", "/api/office/claim", {"id": 1})
        self.assertEqual(duplicate.status, 409, duplicate.text)

    def test_heartbeat_requires_token_and_persists_position(self):
        token = self.claim_with_cleanup(2)
        ok = self.server.request(
            "POST",
            "/api/office/heartbeat",
            {"x": 420, "y": 300, "direction": "left", "status": "Sibuk"},
            token=token,
        )
        self.assertEqual(ok.status, 200, ok.text)

        row = self.characters()[2]
        self.assertEqual(row["x"], 420)
        self.assertEqual(row["y"], 300)
        self.assertEqual(row["direction"], "left")
        self.assertEqual(row["status"], "Sibuk")

    def test_heartbeat_validation(self):
        token = self.claim_with_cleanup(3)
        cases = [
            {"x": -5, "y": 300, "direction": "left"},
            {"x": 1921, "y": 300, "direction": "left"},
            {"x": 100, "y": 961, "direction": "left"},
            {"x": "nope", "y": 300, "direction": "left"},
            {"x": 100, "y": 300, "direction": "north"},
            {"x": 100, "y": 300, "direction": "left", "status": "x" * 81},
        ]
        for payload in cases:
            response = self.server.request("POST", "/api/office/heartbeat", payload, token=token)
            self.assertEqual(response.status, 400, f"{payload} -> {response.text}")

    def test_release_then_reclaim(self):
        token = self.claim(4)
        released = self.server.request("POST", "/api/office/release", {}, token=token)
        self.assertEqual(released.status, 200, released.text)
        self.assertFalse(self.characters()[4]["active"])

        stale = self.server.request(
            "POST", "/api/office/heartbeat", {"x": 100, "y": 200, "direction": "down"}, token=token
        )
        self.assertEqual(stale.status, 401, stale.text)

        self.claim_with_cleanup(4)

    def test_messages_write_read_and_identity(self):
        token = self.claim_with_cleanup(4)
        text = f"halo geng {time.time_ns()}"
        spoofed = f"spoof {time.time_ns()}"
        posted = self.server.request("POST", "/api/office/messages", {"text": text}, token=token)
        self.assertEqual(posted.status, 200, posted.text)

        # Client-supplied identity fields must be ignored in favour of the token.
        forged = self.server.request(
            "POST",
            "/api/office/messages",
            {"text": spoofed, "name": "Penyusup", "sprite": 99, "character": 6},
            token=token,
        )
        self.assertEqual(forged.status, 200, forged.text)

        by_text = {message["text"]: message for message in self.messages()}
        self.assertIn(text, by_text)
        entry = by_text[text]
        self.assertEqual(entry["name"], "Malla")
        self.assertEqual(entry["sprite"], 3)
        self.assertIsInstance(entry["id"], str)
        self.assertRegex(entry["time"], TIME_PATTERN)
        self.assertEqual(by_text[spoofed]["name"], "Malla")
        self.assertEqual(by_text[spoofed]["sprite"], 3)

    def test_message_validation(self):
        token = self.claim_with_cleanup(4)
        for payload in [{"text": ""}, {"text": "   "}, {"text": "x" * 501}, {"text": 123}, {}]:
            response = self.server.request("POST", "/api/office/messages", payload, token=token)
            self.assertEqual(response.status, 400, f"{payload} -> {response.text}")

    def test_unauthorized_writes_are_rejected_without_leaking_tokens(self):
        secret = "definitely-not-a-real-session-token"
        writes = [
            ("/api/office/heartbeat", {"x": 100, "y": 200, "direction": "down"}),
            ("/api/office/release", {}),
            ("/api/office/messages", {"text": "hi"}),
        ]
        for path, payload in writes:
            anonymous = self.server.request("POST", path, payload)
            self.assertEqual(anonymous.status, 401, path)
            self.assertNotIn(secret, anonymous.text)

            forged = self.server.request("POST", path, payload, token=secret)
            self.assertEqual(forged.status, 401, path)
            self.assertNotIn(secret, forged.text)

    def test_concurrent_claims_have_exactly_one_winner(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=25) as pool:
            futures = [pool.submit(self.server.request, "POST", "/api/office/claim", {"id": 5}) for _ in range(25)]
            responses = [future.result() for future in futures]

        winners = [r for r in responses if r.status == 200]
        losers = [r for r in responses if r.status != 200]
        self.assertEqual(len(winners), 1, [r.text for r in responses])
        self.assertEqual(len(losers), 24)
        for loser in losers:
            self.assertEqual(loser.status, 409, loser.text)

        token = winners[0].json()["token"]
        self.addCleanup(self._release_quietly, token)
        held = self.characters()[5]
        self.assertTrue(held["active"])

    def test_cors_is_restricted_to_configured_origin(self):
        preflight = self.server.request(
            "OPTIONS",
            "/api/office/claim",
            headers={
                "Origin": ALLOWED_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "X-Office-Session,Content-Type",
            },
        )
        self.assertEqual(preflight.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN)
        allowed_headers = preflight.headers.get("access-control-allow-headers", "").lower()
        self.assertIn("x-office-session", allowed_headers)

        blocked = self.server.request("GET", "/api/office/characters", headers={"Origin": "http://evil.example"})
        self.assertNotEqual(blocked.headers.get("access-control-allow-origin"), "http://evil.example")


class SeedContractTests(ServerTestCase):
    """A fresh install seeds the six characters on the manifest's assigned seats.

    Runs on its own server: the contract tests deliberately move characters with
    heartbeats, so seed checks cannot share their database.
    """

    def test_seeded_positions_match_the_frontend_manifest(self):
        # The custom routes never serialize name/sprite, so read them straight
        # from the seed database; x/y/direction/name/sprite must equal the
        # generated manifest's seats (sprite is the app's cid-1 convention).
        manifest = json.loads((REPO_ROOT / "lib" / "office-map.json").read_text(encoding="utf-8"))
        with self.server.db() as connection:
            rows = connection.execute(
                "SELECT cid, name, sprite, x, y, direction FROM office_characters ORDER BY cid"
            ).fetchall()
        self.assertEqual(len(rows), 6)
        by_cid = {row[0]: row for row in rows}
        for seat in manifest["seats"]:
            row = by_cid[seat["cid"]]
            self.assertEqual(row[1], seat["character"], f"cid {seat['cid']} name")
            self.assertEqual(row[2], seat["cid"] - 1, f"cid {seat['cid']} sprite")
            self.assertEqual(row[3], seat["x"], f"cid {seat['cid']} x")
            self.assertEqual(row[4], seat["y"], f"cid {seat['cid']} y")
            self.assertEqual(row[5], seat["direction"], f"cid {seat['cid']} direction")


class AuthBeforeBodyValidationTests(ServerTestCase):
    """Heartbeat/messages authenticate before parsing route-specific body fields.

    The committed IP rate count happens first, then the session is resolved, and
    only then is the payload validated. Anonymous callers therefore always see
    401 for a malformed body, never a 400 that would leak validation behaviour.
    """

    env = {
        "OFFICE_CLAIM_LIMIT": "100000",
        "OFFICE_HEARTBEAT_LIMIT": "100000",
        "OFFICE_MESSAGE_LIMIT": "100000",
    }

    MALFORMED_HEARTBEAT = {"x": "nope", "y": "nope", "direction": "north", "status": 9}
    MALFORMED_MESSAGE = {"text": 123}

    def test_anonymous_malformed_heartbeat_is_401(self):
        response = self.server.request("POST", "/api/office/heartbeat", self.MALFORMED_HEARTBEAT)
        self.assertEqual(response.status, 401, response.text)

    def test_anonymous_malformed_message_is_401(self):
        response = self.server.request("POST", "/api/office/messages", self.MALFORMED_MESSAGE)
        self.assertEqual(response.status, 401, response.text)

    def test_anonymous_empty_message_body_is_401(self):
        response = self.server.request("POST", "/api/office/messages", {})
        self.assertEqual(response.status, 401, response.text)

    def test_forged_token_with_malformed_body_is_401(self):
        cases = [
            ("/api/office/heartbeat", self.MALFORMED_HEARTBEAT),
            ("/api/office/messages", self.MALFORMED_MESSAGE),
            ("/api/office/messages", {}),
        ]
        for path, payload in cases:
            response = self.server.request("POST", path, payload, token="forged-session-token")
            self.assertEqual(response.status, 401, f"{path} -> {response.text}")

    def test_valid_session_still_gets_400_for_malformed_body(self):
        token = self.claim_with_cleanup(1)

        heartbeat = self.server.request("POST", "/api/office/heartbeat", self.MALFORMED_HEARTBEAT, token=token)
        self.assertEqual(heartbeat.status, 400, heartbeat.text)

        message = self.server.request("POST", "/api/office/messages", self.MALFORMED_MESSAGE, token=token)
        self.assertEqual(message.status, 400, message.text)

    def test_anonymous_malformed_bodies_still_consume_the_rate_budget(self):
        for _ in range(3):
            self.assertEqual(
                self.server.request("POST", "/api/office/heartbeat", self.MALFORMED_HEARTBEAT).status,
                401,
            )
        self.assertEqual(self.rate_count(f"heartbeat:{CLIENT_IP}"), 3)


class ClaimRateLimitTests(ServerTestCase):
    env = {"OFFICE_CLAIM_LIMIT": "3", "OFFICE_CLAIM_WINDOW_MS": "60000"}

    def test_claim_rate_limit_is_bounded(self):
        statuses = [self.server.request("POST", "/api/office/claim", {"id": cid}).status for cid in [1, 2, 3, 4]]
        self.assertEqual(statuses[:3], [200, 200, 200], statuses)
        self.assertEqual(statuses[3], 429, statuses)
        self.assertEqual(self.rate_count(f"claim:{CLIENT_IP}"), 4)


class InvalidClaimAttemptsConsumeBudgetTests(ServerTestCase):
    env = {"OFFICE_CLAIM_LIMIT": "3", "OFFICE_CLAIM_WINDOW_MS": "60000"}

    def test_invalid_claims_consume_the_claim_budget(self):
        for _ in range(3):
            invalid = self.server.request("POST", "/api/office/claim", {"id": 0})
            self.assertEqual(invalid.status, 400, invalid.text)

        # The budget is already spent by the rejected attempts, so even a valid
        # claim is now throttled.
        blocked = self.server.request("POST", "/api/office/claim", {"id": 1})
        self.assertEqual(blocked.status, 429, blocked.text)
        self.assertEqual(self.rate_count(f"claim:{CLIENT_IP}"), 4)


class ConflictClaimAttemptsConsumeBudgetTests(ServerTestCase):
    env = {"OFFICE_CLAIM_LIMIT": "2", "OFFICE_CLAIM_WINDOW_MS": "60000"}

    def test_conflicting_claim_consumes_budget(self):
        token = self.claim_with_cleanup(1)
        conflict = self.server.request("POST", "/api/office/claim", {"id": 1})
        self.assertEqual(conflict.status, 409, conflict.text)

        # One successful claim + one 409 already exhausted the 2-request budget.
        blocked = self.server.request("POST", "/api/office/claim", {"id": 2})
        self.assertEqual(blocked.status, 429, blocked.text)
        self.assertEqual(self.rate_count(f"claim:{CLIENT_IP}"), 3)


class Repeated429AttemptsConsumeBudgetTests(ServerTestCase):
    env = {"OFFICE_CLAIM_LIMIT": "1", "OFFICE_CLAIM_WINDOW_MS": "60000"}

    def test_repeated_429s_keep_counting_and_stay_enforced(self):
        token = self.claim_with_cleanup(1)
        for _ in range(3):
            blocked = self.server.request("POST", "/api/office/claim", {"id": 2})
            self.assertEqual(blocked.status, 429, blocked.text)

        # Every 429 attempt is still counted and persisted, so the counter keeps
        # growing instead of being rolled back with the error.
        self.assertEqual(self.rate_count(f"claim:{CLIENT_IP}"), 4)


class UnauthorizedAttemptsConsumeBudgetTests(ServerTestCase):
    env = {
        "OFFICE_CLAIM_LIMIT": "100000",
        "OFFICE_HEARTBEAT_LIMIT": "3",
        "OFFICE_HEARTBEAT_WINDOW_MS": "10000",
        "OFFICE_RELEASE_LIMIT": "3",
        "OFFICE_RELEASE_WINDOW_MS": "10000",
        "OFFICE_MESSAGE_LIMIT": "3",
        "OFFICE_MESSAGE_WINDOW_MS": "10000",
    }

    def test_unauthorized_heartbeat_consumes_budget(self):
        payload = {"x": 100, "y": 200, "direction": "down"}
        for _ in range(3):
            self.assertEqual(self.server.request("POST", "/api/office/heartbeat", payload).status, 401)
        self.assertEqual(self.server.request("POST", "/api/office/heartbeat", payload).status, 429)
        self.assertEqual(self.rate_count(f"heartbeat:{CLIENT_IP}"), 4)

    def test_unauthorized_release_consumes_budget(self):
        for _ in range(3):
            self.assertEqual(self.server.request("POST", "/api/office/release", {}).status, 401)
        self.assertEqual(self.server.request("POST", "/api/office/release", {}).status, 429)
        self.assertEqual(self.rate_count(f"release:{CLIENT_IP}"), 4)

    def test_unauthorized_message_consumes_budget(self):
        for _ in range(3):
            self.assertEqual(self.server.request("POST", "/api/office/messages", {"text": "hi"}).status, 401)
        self.assertEqual(self.server.request("POST", "/api/office/messages", {"text": "hi"}).status, 429)
        self.assertEqual(self.rate_count(f"message:{CLIENT_IP}"), 4)


class MessageRateLimitTests(ServerTestCase):
    env = {"OFFICE_MESSAGE_LIMIT": "12", "OFFICE_MESSAGE_WINDOW_MS": "10000", "OFFICE_CLAIM_LIMIT": "100000"}

    def test_message_rate_limit_is_bounded(self):
        token = self.claim_with_cleanup(6)
        statuses = [
            self.server.request("POST", "/api/office/messages", {"text": f"flood {i}"}, token=token).status
            for i in range(13)
        ]
        self.assertEqual(statuses[:12], [200] * 12, statuses)
        self.assertEqual(statuses[12], 429, statuses)
        self.assertEqual(self.rate_count(f"message:{CLIENT_IP}"), 13)


class RouteBucketIsolationTests(ServerTestCase):
    env = {"OFFICE_CLAIM_LIMIT": "1", "OFFICE_CLAIM_WINDOW_MS": "60000"}

    def test_exhausting_one_route_does_not_throttle_another(self):
        token = self.claim_with_cleanup(1)

        blocked = self.server.request("POST", "/api/office/claim", {"id": 2})
        self.assertEqual(blocked.status, 429, blocked.text)

        heartbeat = self.server.request(
            "POST", "/api/office/heartbeat", {"x": 100, "y": 200, "direction": "down"}, token=token
        )
        self.assertEqual(heartbeat.status, 200, heartbeat.text)

        posted = self.server.request("POST", "/api/office/messages", {"text": "isolated"}, token=token)
        self.assertEqual(posted.status, 200, posted.text)


class HeartbeatCapacityTests(ServerTestCase):
    # Default heartbeat budget only; nothing else is overridden so this proves
    # the shipped default clears normal six-user polling behind a single IP.
    env = {"OFFICE_CLAIM_LIMIT": "100000"}

    def test_six_users_polling_every_two_seconds_are_not_throttled(self):
        tokens = {cid: self.claim(cid) for cid in range(1, 7)}
        for token in tokens.values():
            self.addCleanup(self._release_quietly, token)

        statuses = []
        # Six users x five heartbeats each = 30 attempts inside a 10s window.
        for _ in range(5):
            for cid in range(1, 7):
                response = self.server.request(
                    "POST",
                    "/api/office/heartbeat",
                    {"x": 100 + cid, "y": 200, "direction": "down", "status": "Available"},
                    token=tokens[cid],
                )
                statuses.append(response.status)
        self.assertEqual(len(statuses), 30)
        self.assertEqual(statuses, [200] * 30, statuses)


class StaleLimitPruningTests(ServerTestCase):
    env = {"OFFICE_CLAIM_LIMIT": "100000"}

    def test_stale_limit_rows_are_pruned(self):
        stale_bucket = "stale:prune-test"
        day_ago_ms = int(time.time() * 1000) - 24 * 60 * 60 * 1000
        self.insert_limit_row(stale_bucket, day_ago_ms, count=9)
        self.assertEqual(self.rate_count(stale_bucket), 9)

        # Any rate-limited request prunes rows whose window has long expired.
        response = self.server.request("POST", "/api/office/claim", {"id": 0})
        self.assertEqual(response.status, 400, response.text)
        self.assertIsNone(self.rate_count(stale_bucket))


class LeaseExpiryTests(ServerTestCase):
    env = {"OFFICE_TEST_LEASE_TTL_MS": "700", "OFFICE_CLAIM_LIMIT": "100000"}

    def test_expired_lease_is_rejected_and_reclaimable(self):
        token = self.claim(1)
        self.assertTrue(self.characters()[1]["active"])

        time.sleep(1.2)
        expired = self.server.request(
            "POST", "/api/office/heartbeat", {"x": 250, "y": 365, "direction": "up"}, token=token
        )
        self.assertEqual(expired.status, 401, expired.text)
        self.assertFalse(self.characters()[1]["active"])

        reclaimed = self.claim(1)
        self.assertNotEqual(reclaimed, token)
        self.assertTrue(self.characters()[1]["active"])
        self.addCleanup(self._release_quietly, reclaimed)


class LeaseTtlShorteningTests(ServerTestCase):
    # The test override is valid and shorter than the fixed 90s production TTL,
    # so min(90000, 700) applies.
    env = {"OFFICE_TEST_LEASE_TTL_MS": "700", "OFFICE_CLAIM_LIMIT": "100000"}

    def test_test_override_shortens_the_fixed_ttl(self):
        token = self.claim(1)
        self.addCleanup(self._release_quietly, token)

        remaining = self.lease_remaining_ms(1)
        self.assertGreaterEqual(remaining, 300)
        self.assertLessEqual(remaining, 1500)


class LeaseTtlFixedTests(ServerTestCase):
    # OFFICE_LEASE_TTL_MS was removed: it must be ignored entirely, so a huge
    # value cannot extend the lease past the fixed 90s. The expiry delta is read
    # straight from the DB, so the assertion does not need to wait 90 seconds.
    env = {"OFFICE_LEASE_TTL_MS": "600000", "OFFICE_CLAIM_LIMIT": "100000"}

    def test_removed_ttl_env_cannot_extend_the_lease(self):
        token = self.claim(1)
        self.addCleanup(self._release_quietly, token)

        remaining = self.lease_remaining_ms(1)
        self.assertGreater(remaining, 85000)
        self.assertLessEqual(remaining, 90000)

    def test_heartbeat_renewal_also_uses_the_fixed_ttl(self):
        token = self.claim(1)
        self.addCleanup(self._release_quietly, token)

        response = self.server.request(
            "POST",
            "/api/office/heartbeat",
            {"x": 100, "y": 200, "direction": "down"},
            token=token,
        )
        self.assertEqual(response.status, 200, response.text)

        remaining = self.lease_remaining_ms(1)
        self.assertGreater(remaining, 85000)
        self.assertLessEqual(remaining, 90000)


class LeaseTtlOutOfRangeOverrideTests(ServerTestCase):
    # An out-of-range test override (above the 90s max) is ignored, so the fixed
    # 90s TTL stands rather than being extended by the override itself.
    env = {"OFFICE_TEST_LEASE_TTL_MS": "600000", "OFFICE_CLAIM_LIMIT": "100000"}

    def test_out_of_range_test_override_cannot_extend_the_lease(self):
        token = self.claim(1)
        self.addCleanup(self._release_quietly, token)

        remaining = self.lease_remaining_ms(1)
        self.assertGreater(remaining, 85000)
        self.assertLessEqual(remaining, 90000)


class MessageRetentionTests(ServerTestCase):
    env = {"OFFICE_MESSAGE_LIMIT": "100000", "OFFICE_MESSAGE_WINDOW_MS": "1000", "OFFICE_CLAIM_LIMIT": "100000"}

    def test_retains_only_latest_two_hundred_messages(self):
        token = self.claim_with_cleanup(1)
        for index in range(205):
            response = self.server.request("POST", "/api/office/messages", {"text": f"msg-{index}"}, token=token)
            self.assertEqual(response.status, 200, response.text)

        messages = self.messages()
        self.assertEqual(len(messages), 200)
        texts = [m["text"] for m in messages]
        self.assertNotIn("msg-0", texts)
        self.assertNotIn("msg-4", texts)
        self.assertIn("msg-5", texts)
        self.assertIn("msg-204", texts)

        with self.server.db() as connection:
            count = connection.execute("SELECT COUNT(*) FROM office_messages").fetchone()[0]
        self.assertEqual(count, 200)


class MessageOrderingTests(ServerTestCase):
    env = {"OFFICE_MESSAGE_LIMIT": "100000", "OFFICE_MESSAGE_WINDOW_MS": "1000", "OFFICE_CLAIM_LIMIT": "100000"}

    def setUp(self):
        super().setUp()
        self.clear_messages()

    def test_retrieval_order_is_insertion_order_when_timestamps_tie(self):
        token = self.claim_with_cleanup(1)
        texts = [f"tie-{index}" for index in range(6)]
        for text in texts:
            response = self.server.request("POST", "/api/office/messages", {"text": text}, token=token)
            self.assertEqual(response.status, 200, response.text)

        # Collapse every creation timestamp to a single value so only the
        # monotonic sequence can break the tie.
        with self.server.db() as connection:
            connection.execute("UPDATE office_messages SET created = ?", ("2000-01-01 00:00:00.000Z",))
            rows = connection.execute("SELECT text, seq, created FROM office_messages ORDER BY seq").fetchall()

        self.assertEqual(len(rows), len(texts))
        self.assertEqual(len({row[2] for row in rows}), 1)
        seqs = [row[1] for row in rows]
        self.assertEqual(seqs, sorted(seqs))
        expected = [row[0] for row in rows]
        self.assertEqual(expected, texts)

        actual = [message["text"] for message in self.messages()]
        self.assertEqual(actual, expected)

    def test_retention_eviction_is_deterministic_when_timestamps_tie(self):
        token = self.claim_with_cleanup(1)
        for index in range(205):
            response = self.server.request("POST", "/api/office/messages", {"text": f"ret-{index}"}, token=token)
            self.assertEqual(response.status, 200, response.text)

        with self.server.db() as connection:
            connection.execute("UPDATE office_messages SET created = ?", ("2000-01-01 00:00:00.000Z",))

        overflow = self.server.request("POST", "/api/office/messages", {"text": "ret-205"}, token=token)
        self.assertEqual(overflow.status, 200, overflow.text)

        texts = [message["text"] for message in self.messages()]
        self.assertEqual(len(texts), 200)
        self.assertNotIn("ret-4", texts)
        self.assertNotIn("ret-5", texts)
        self.assertIn("ret-6", texts)
        self.assertIn("ret-205", texts)

        with self.server.db() as connection:
            count, lowest, highest = connection.execute(
                "SELECT COUNT(*), MIN(seq), MAX(seq) FROM office_messages"
            ).fetchone()
        # seq 1..5 were evicted by retention (seq 6 on the last overflow), and the
        # sequence keeps climbing rather than being reset by deletions.
        self.assertEqual(count, 200)
        self.assertEqual(lowest, 7)
        self.assertEqual(highest, 206)


class MessageSequencingTests(ServerTestCase):
    """Incremental retrieval: every message carries a monotonic `seq` and
    `afterSeq` returns only messages strictly newer than it."""

    env = {"OFFICE_MESSAGE_LIMIT": "100000", "OFFICE_MESSAGE_WINDOW_MS": "1000", "OFFICE_CLAIM_LIMIT": "100000"}

    def setUp(self):
        super().setUp()
        self.clear_messages()

    def post_messages(self, texts):
        token = self.claim_with_cleanup(1)
        for text in texts:
            response = self.server.request("POST", "/api/office/messages", {"text": text}, token=token)
            self.assertEqual(response.status, 200, response.text)

    def messages_after(self, after_seq):
        query = urllib.parse.urlencode({"afterSeq": after_seq})
        response = self.server.request("GET", f"/api/office/messages?{query}")
        self.assertEqual(response.status, 200, response.text)
        return response.json()["messages"]

    def test_every_message_has_a_strictly_increasing_integer_seq(self):
        self.post_messages([f"seq-{index}" for index in range(4)])

        messages = self.messages()
        self.assertEqual(len(messages), 4)
        seqs = [message["seq"] for message in messages]
        for seq in seqs:
            self.assertIsInstance(seq, int)
        self.assertEqual(seqs, sorted(seqs))
        self.assertEqual(len(set(seqs)), len(seqs))
        # Existing clients ignore seq; the older fields must still be present.
        for message in messages:
            self.assertEqual(
                sorted(message.keys()),
                ["id", "name", "seq", "sprite", "text", "time"],
            )

    def test_after_seq_returns_only_newer_messages(self):
        self.post_messages(["one", "two", "three"])
        retained = self.messages()
        cutoff = retained[1]["seq"]

        newer = self.messages_after(cutoff)
        self.assertEqual([message["text"] for message in newer], ["three"])
        self.assertTrue(all(message["seq"] > cutoff for message in newer))

    def test_after_seq_zero_returns_the_retained_history(self):
        self.post_messages(["alpha", "beta"])
        self.assertEqual(
            [message["text"] for message in self.messages_after(0)],
            ["alpha", "beta"],
        )

    def test_after_seq_past_the_newest_returns_empty(self):
        self.post_messages(["only"])
        newest = self.messages()[-1]["seq"]
        self.assertEqual(self.messages_after(newest), [])

    def test_after_seq_stays_monotonic_across_retention_eviction(self):
        token = self.claim_with_cleanup(1)
        for index in range(205):
            response = self.server.request("POST", "/api/office/messages", {"text": f"inc-{index}"}, token=token)
            self.assertEqual(response.status, 200, response.text)

        retained = self.messages()
        self.assertEqual(len(retained), 200)
        # 205 writes evict seq 1..5, so the oldest retained seq is 6; asking for
        # everything after it yields exactly the newest tail.
        oldest = retained[0]["seq"]
        self.assertEqual(oldest, 6)
        self.assertEqual(
            [message["seq"] for message in self.messages_after(oldest)],
            [message["seq"] for message in retained[1:]],
        )


class AfterSeqValidationTests(ServerTestCase):
    env = {"OFFICE_CLAIM_LIMIT": "100000"}

    def test_invalid_after_seq_is_rejected(self):
        for bad in ["-1", "1.5", "abc", "", "1e3", "0x2", " 5", "5 ", "null"]:
            query = urllib.parse.urlencode({"afterSeq": bad})
            response = self.server.request("GET", f"/api/office/messages?{query}")
            self.assertEqual(response.status, 400, f"afterSeq={bad!r} -> {response.text}")

    def test_absent_after_seq_is_valid_full_history(self):
        response = self.server.request("GET", "/api/office/messages")
        self.assertEqual(response.status, 200, response.text)
        self.assertIn("messages", response.json())


class CharactersReadRateLimitTests(ServerTestCase):
    env = {"OFFICE_CHARACTERS_LIMIT": "3", "OFFICE_CHARACTERS_WINDOW_MS": "60000"}

    def test_characters_read_is_rate_limited(self):
        statuses = [self.server.request("GET", "/api/office/characters").status for _ in range(4)]
        self.assertEqual(statuses[:3], [200, 200, 200], statuses)
        self.assertEqual(statuses[3], 429, statuses)
        self.assertEqual(self.rate_count(f"characters:{CLIENT_IP}"), 4)


class MessagesReadRateLimitTests(ServerTestCase):
    env = {"OFFICE_MESSAGES_READ_LIMIT": "3", "OFFICE_MESSAGES_READ_WINDOW_MS": "60000", "OFFICE_CLAIM_LIMIT": "100000"}

    def test_messages_read_is_rate_limited(self):
        statuses = [self.server.request("GET", "/api/office/messages").status for _ in range(4)]
        self.assertEqual(statuses[:3], [200, 200, 200], statuses)
        self.assertEqual(statuses[3], 429, statuses)
        self.assertEqual(self.rate_count(f"messages-read:{CLIENT_IP}"), 4)


class ReadRouteBucketIsolationTests(ServerTestCase):
    env = {
        "OFFICE_CHARACTERS_LIMIT": "1",
        "OFFICE_CHARACTERS_WINDOW_MS": "60000",
        "OFFICE_MESSAGES_READ_LIMIT": "100000",
        "OFFICE_CLAIM_LIMIT": "100000",
    }

    def test_exhausting_characters_does_not_throttle_messages(self):
        self.assertEqual(self.server.request("GET", "/api/office/characters").status, 200)
        self.assertEqual(self.server.request("GET", "/api/office/characters").status, 429)
        self.assertEqual(self.server.request("GET", "/api/office/messages").status, 200)


class ReadCapacityTests(ServerTestCase):
    # Default read budgets only, so this proves the shipped limits clear normal
    # six-user polling behind a single IP.
    env = {"OFFICE_CLAIM_LIMIT": "100000"}

    def test_six_users_polling_reads_are_not_throttled(self):
        for path in ["/api/office/characters", "/api/office/messages"]:
            statuses = [self.server.request("GET", path).status for _ in range(30)]
            self.assertEqual(statuses, [200] * 30, (path, statuses))


class ReadRoutePruningTests(ServerTestCase):
    env = {"OFFICE_CHARACTERS_LIMIT": "100000"}

    def test_read_requests_prune_stale_limit_rows(self):
        stale_bucket = "stale:read-prune"
        day_ago_ms = int(time.time() * 1000) - 24 * 60 * 60 * 1000
        self.insert_limit_row(stale_bucket, day_ago_ms, count=9)
        self.assertEqual(self.rate_count(stale_bucket), 9)

        self.assertEqual(self.server.request("GET", "/api/office/characters").status, 200)
        self.assertIsNone(self.rate_count(stale_bucket))


# Pre-change schema, mirrored here so the upgrade test can start PocketBase at the
# previous revision and then apply the real forward migration. Using a fixture
# (rather than `git show`) keeps the upgrade test deterministic and offline.
LEGACY_SCHEMA_MIGRATION = r'''
migrate(
  (app) => {
    const characters = new Collection({
      type: "base",
      name: "office_characters",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "cid", type: "number", required: true, onlyInt: true, min: 1, max: 6 },
        { name: "name", type: "text", required: true, min: 1, max: 40 },
        { name: "sprite", type: "number", onlyInt: true, min: 0, max: 5 },
        { name: "x", type: "number", min: 0, max: 960 },
        { name: "y", type: "number", min: 0, max: 540 },
        { name: "direction", type: "select", maxSelect: 1, values: ["up", "down", "left", "right"] },
        { name: "status", type: "text", max: 80 },
        { name: "active", type: "bool" },
        { name: "lease_token_hash", type: "text", max: 64, hidden: true },
        { name: "lease_expires", type: "number", onlyInt: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_office_characters_cid ON office_characters (cid)",
        "CREATE INDEX idx_office_characters_token ON office_characters (lease_token_hash)",
      ],
    });
    app.save(characters);

    const seats = [
      { cid: 1, name: "Farkhan", sprite: 0, x: 250, y: 365, direction: "up" },
      { cid: 2, name: "Surya", sprite: 1, x: 865, y: 258, direction: "left" },
      { cid: 3, name: "Imam", sprite: 2, x: 250, y: 142, direction: "down" },
      { cid: 4, name: "Malla", sprite: 3, x: 600, y: 258, direction: "left" },
      { cid: 5, name: "Siska", sprite: 4, x: 390, y: 365, direction: "up" },
      { cid: 6, name: "Mona", sprite: 5, x: 390, y: 142, direction: "down" },
    ];
    for (const seat of seats) {
      const record = new Record(characters);
      record.set("cid", seat.cid);
      record.set("name", seat.name);
      record.set("sprite", seat.sprite);
      record.set("x", seat.x);
      record.set("y", seat.y);
      record.set("direction", seat.direction);
      record.set("status", "Available");
      record.set("active", false);
      record.set("lease_token_hash", "");
      record.set("lease_expires", 0);
      app.save(record);
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId("office_characters"));
    } catch (e) {
      // already removed
    }
  },
);
'''


class MapBoundsTests(ServerTestCase):
    """The office world is 1920x960, enforced at the schema and the route layer."""

    env = {"OFFICE_CLAIM_LIMIT": "100000", "OFFICE_HEARTBEAT_LIMIT": "100000"}

    def test_fresh_schema_has_the_enlarged_field_constraints(self):
        self.assertEqual(self.field_limits("office_characters", "x"), (0, 1920))
        self.assertEqual(self.field_limits("office_characters", "y"), (0, 960))

    def test_heartbeat_accepts_the_exact_world_corners(self):
        token = self.claim_with_cleanup(1)
        for payload in (
            {"x": 1920, "y": 960, "direction": "down"},
            {"x": 0, "y": 0, "direction": "up"},
            {"x": 1919.5, "y": 959.5, "direction": "left"},
        ):
            response = self.server.request("POST", "/api/office/heartbeat", payload, token=token)
            self.assertEqual(response.status, 200, f"{payload} -> {response.text}")

        row = self.characters()[1]
        self.assertEqual(row["x"], 1919.5)
        self.assertEqual(row["y"], 959.5)

    def test_heartbeat_rejects_just_outside_the_world(self):
        token = self.claim_with_cleanup(2)
        for payload in (
            {"x": 1921, "y": 100, "direction": "down"},
            {"x": 100, "y": 961, "direction": "down"},
            {"x": 1920.5, "y": 100, "direction": "down"},
            {"x": -0.5, "y": 100, "direction": "down"},
        ):
            response = self.server.request("POST", "/api/office/heartbeat", payload, token=token)
            self.assertEqual(response.status, 400, f"{payload} -> {response.text}")


class UpgradeMigrationTests(unittest.TestCase):
    """Realistic upgrades: start at the pre-change schema and apply the real forward migrations.

    Two forward migrations exist after the original:
      * ``1789689600`` widens the world bounds (bounds-only, no row moved);
      * ``1789776000`` re-seeds the six INACTIVE characters to the generated
        manifest seats, leaving active rows (and every lease field) alone.
    """

    def _legacy_dir(self, tmp: str, prefixes: list[str]) -> Path:
        migrations = Path(tmp)
        (migrations / "1789603200_office_schema.js").write_text(LEGACY_SCHEMA_MIGRATION, encoding="utf-8")
        for prefix in prefixes:
            matches = sorted(MIGRATIONS_DIR.glob(f"{prefix}*.js"))
            self.assertEqual(len(matches), 1, f"exactly one forward migration with prefix {prefix}")
            shutil.copy2(matches[0], migrations / matches[0].name)
        return migrations

    @staticmethod
    def _rows(server: PocketBaseServer) -> dict[int, tuple]:
        with server.db() as connection:
            rows = connection.execute(
                "SELECT cid, name, sprite, x, y, direction, status, active, lease_token_hash, lease_expires "
                "FROM office_characters ORDER BY cid"
            ).fetchall()
        return {row[0]: row for row in rows}

    def test_a_forward_migration_exists_after_the_original(self):
        forward = [path for path in sorted(MIGRATIONS_DIR.glob("*.js")) if not path.name.startswith("1789603200")]
        self.assertTrue(forward, "a forward migration exists after the original")

    def test_upgrade_enlarges_bounds_without_touching_existing_rows(self):
        # The bounds migration in isolation: it only widens the field limits, so
        # legacy rows keep their coordinates and stay valid in the enlarged world.
        with tempfile.TemporaryDirectory(prefix="pb-office-upgrade-") as tmp:
            migrations = self._legacy_dir(tmp, ["1789689600"])
            server = PocketBaseServer(migrations_dir=migrations).start()
            try:
                with server.db() as connection:
                    row = connection.execute(
                        "SELECT fields FROM _collections WHERE name = 'office_characters'"
                    ).fetchone()
                    rows = connection.execute("SELECT cid, x, y FROM office_characters ORDER BY cid").fetchall()

                fields = {entry["name"]: entry for entry in json.loads(row[0])}
                self.assertEqual((fields["x"]["min"], fields["x"]["max"]), (0, 1920))
                self.assertEqual((fields["y"]["min"], fields["y"]["max"]), (0, 960))
                self.assertEqual(len(rows), 6)
                self.assertEqual(rows[0], (1, 250, 365))
            finally:
                server.cleanup()

    def test_upgrade_moves_inactive_legacy_rows_to_the_manifest_seats(self):
        manifest = json.loads((REPO_ROOT / "lib" / "office-map.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory(prefix="pb-office-upgrade-") as tmp:
            migrations = self._legacy_dir(tmp, ["1789689600", "1789776000"])
            server = PocketBaseServer(migrations_dir=migrations).start()
            try:
                rows = self._rows(server)
                self.assertEqual(len(rows), 6)
                for seat in manifest["seats"]:
                    row = rows[seat["cid"]]
                    self.assertEqual(row[3], seat["x"], f"cid {seat['cid']} x")
                    self.assertEqual(row[4], seat["y"], f"cid {seat['cid']} y")
                    self.assertEqual(row[5], seat["direction"], f"cid {seat['cid']} direction")
            finally:
                server.cleanup()

    def test_upgrade_preserves_every_other_field(self):
        legacy = {
            1: ("Farkhan", 0),
            2: ("Surya", 1),
            3: ("Imam", 2),
            4: ("Malla", 3),
            5: ("Siska", 4),
            6: ("Mona", 5),
        }
        with tempfile.TemporaryDirectory(prefix="pb-office-upgrade-") as tmp:
            migrations = self._legacy_dir(tmp, ["1789689600", "1789776000"])
            server = PocketBaseServer(migrations_dir=migrations).start()
            try:
                rows = self._rows(server)
                for cid, (name, sprite) in legacy.items():
                    row = rows[cid]
                    self.assertEqual(row[1], name, f"cid {cid} name unchanged")
                    self.assertEqual(row[2], sprite, f"cid {cid} sprite unchanged")
                    self.assertEqual(row[6], "Available", f"cid {cid} status unchanged")
                    self.assertEqual(row[7], 0, f"cid {cid} active unchanged")
                    self.assertEqual(row[8], "", f"cid {cid} lease hash unchanged")
                    self.assertEqual(row[9], 0, f"cid {cid} lease expiry unchanged")
            finally:
                server.cleanup()

    def test_upgrade_leaves_an_active_row_and_its_lease_untouched(self):
        manifest = json.loads((REPO_ROOT / "lib" / "office-map.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory(prefix="pb-office-upgrade-") as tmp:
            migrations = self._legacy_dir(tmp, ["1789689600"])
            data_dir = tempfile.mkdtemp(prefix="pb-office-upgrade-data-")
            server = PocketBaseServer(migrations_dir=migrations, data_dir=data_dir).start()
            try:
                future = int(time.time() * 1000) + 90000
                with server.db() as connection:
                    connection.execute(
                        "UPDATE office_characters SET x=?, y=?, direction=?, status='Busy', active=1, "
                        "lease_token_hash=?, lease_expires=? WHERE cid=1",
                        (100, 200, "left", "deadbeef", future),
                    )
                # A new forward migration appears and the server restarts on the
                # same database — the realistic deploy.
                seat_migrations = sorted(MIGRATIONS_DIR.glob("1789776000*.js"))
                self.assertEqual(len(seat_migrations), 1)
                shutil.copy2(seat_migrations[0], migrations / seat_migrations[0].name)
            finally:
                server.stop()

            restarted = PocketBaseServer(migrations_dir=migrations, data_dir=data_dir).start()
            try:
                rows = self._rows(restarted)
                active = rows[1]
                self.assertEqual((active[3], active[4], active[5]), (100, 200, "left"), "an active row must not be teleported")
                self.assertEqual(active[6], "Busy")
                self.assertEqual(active[7], 1)
                self.assertEqual(active[8], "deadbeef")
                self.assertGreaterEqual(active[9], future)
                for seat in manifest["seats"]:
                    if seat["cid"] == 1:
                        continue
                    moved = rows[seat["cid"]]
                    self.assertEqual(
                        (moved[3], moved[4], moved[5]),
                        (seat["x"], seat["y"], seat["direction"]),
                        f"inactive cid {seat['cid']} moved to its manifest seat",
                    )
            finally:
                restarted.cleanup()

    def test_upgrade_is_idempotent_and_restart_safe(self):
        with tempfile.TemporaryDirectory(prefix="pb-office-upgrade-") as tmp:
            migrations = self._legacy_dir(tmp, ["1789689600", "1789776000"])
            data_dir = tempfile.mkdtemp(prefix="pb-office-upgrade-data-")
            server = PocketBaseServer(migrations_dir=migrations, data_dir=data_dir).start()
            try:
                first = self._rows(server)
            finally:
                server.stop()

            restarted = PocketBaseServer(migrations_dir=migrations, data_dir=data_dir).start()
            try:
                second = self._rows(restarted)
            finally:
                restarted.cleanup()

            self.assertEqual(len(second), 6)
            self.assertEqual(first, second, "restarting must not re-run or alter the seat migration")


if __name__ == "__main__":
    unittest.main(verbosity=2)

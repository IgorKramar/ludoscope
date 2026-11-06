"""Real disposable Chronicle HTTP fixture. No production configuration or Notion access.

Run with Chronicle's server dependencies installed and its src on PYTHONPATH.
The adapter and verification reader use HTTP only; SQLite is fixture-owned.
"""
import hashlib
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

import uvicorn
from chronicle.collector import create_app
from chronicle.memory_service import evidence, record_base


def grant(token, scopes):
    return {"sha256": hashlib.sha256(token.encode()).hexdigest(), "principal_id": token,
            "agent_id": "ludoscope", "scopes": scopes, "projects": ["game-one"],
            "allow_content": True}


def post(origin, path, value):
    request = urllib.request.Request(origin + path, json.dumps(value).encode(), method="POST",
        headers={"Authorization": "Bearer fixture-seed", "Content-Type": "application/json",
                 "FIP-Version": "v1", "Idempotency-Key": value["record_id"]})
    try:
        with urllib.request.urlopen(request) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Synthetic fixture seed failed: {error.code}: {error.read().decode()}") from None


def base(rid, status):
    return record_base(rid, "game-one", rid, timestamp="2026-11-01T00:00:00Z",
                       agent_id="ludoscope", provenance="agent_reported", status=status)


def main():
    with tempfile.TemporaryDirectory(prefix="chronicle-adapter-fixture-") as directory:
        app = create_app(str(Path(directory) / "fixture.db"), grants=[
            grant("fixture-seed", ["read", "write", "decide", "revise"]),
            grant("fixture-agent", ["read", "write"]),
            grant("fixture-reader", ["read"]), grant("fixture-writer", ["write"])])
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        origin = f"http://127.0.0.1:{sock.getsockname()[1]}"
        server = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off"))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
        thread.start()
        for _ in range(300):
            if server.started:
                break
            time.sleep(0.01)
        if not server.started:
            raise RuntimeError("Fixture did not start")
        proxy = None
        try:
            event = {**base("seed-event", "completed"), "event_id": "seed-event",
                "event_type": "experiment.result", "category": "experiment",
                "summary": json.dumps({"question": "Is repair worthwhile?",
                    "result": "Synthetic model favoured repair", "data_origin": "simulation"}),
                "knowledge": [], "test_results": []}
            post(origin, "/v1/memory/events", event)
            def decision(rid, identity, status, choice):
                return {**base(rid, status), "decision_id": identity,
                    "title": "Fixture decision", "category": "game_design", "problem": "Factory recovery",
                    "alternatives": ["Repair", "Scrap"], "choice": choice,
                    "rationale": "Synthetic fixture only", "consequences": [],
                    "source_event_ids": ["seed-event"],
                    "evidence": [evidence("game-one", "seed-event")]}
            post(origin, "/v1/memory/decisions", decision("accepted-decision", "ownership", "Accepted", "Keep ownership"))
            old = decision("old-decision", "repair", "Accepted", "Repair")
            post(origin, "/v1/memory/decisions", old)
            revised = {**decision("rejected-revision", "repair", "Rejected", "Repair"), "revision": 2, "supersedes": "old-decision"}
            post(origin, "/v1/memory/decisions", revised)

            class Proxy(http.server.BaseHTTPRequestHandler):
                lost = False

                def log_message(self, *_args):
                    pass

                def do_GET(self):
                    self.forward()

                def do_POST(self):
                    self.forward()

                def forward(self):
                    data = self.rfile.read(int(self.headers.get("Content-Length", 0))) if self.command == "POST" else None
                    req = urllib.request.Request(origin + self.path, data, method=self.command,
                        headers={k: v for k, v in self.headers.items() if k.lower() not in {"host", "connection"}})
                    try:
                        response = urllib.request.urlopen(req)
                    except urllib.error.HTTPError as error:
                        response = error
                    body = response.read()
                    if self.command == "POST" and not Proxy.lost and response.status == 200:
                        Proxy.lost = True
                        self.close_connection = True
                        self.connection.shutdown(socket.SHUT_RDWR)
                        return
                    self.send_response(response.status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)

            proxy = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
            proxy_thread = threading.Thread(target=proxy.serve_forever, daemon=True)
            proxy_thread.start()
            env = {**os.environ, "CHRONICLE_FIXTURE_URL": f"http://127.0.0.1:{proxy.server_port}"}
            subprocess.run(["node", str(Path(__file__).with_name("chronicle-live-client.mjs"))], env=env, check=True, timeout=60)
            assert Proxy.lost, "Lost ACK case was not exercised"
        finally:
            if proxy:
                proxy.shutdown()
                proxy.server_close()
            server.should_exit = True
            thread.join(10)
            sock.close()
            assert not thread.is_alive()


if __name__ == "__main__":
    main()

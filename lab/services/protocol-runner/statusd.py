#!/usr/bin/env python3
"""Lightweight status HTTP for protocol-runner (survives soft CLI paralyze)."""
from __future__ import annotations

import json
import os
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

MARKER = Path("/opt/hospital/PARALYZED")
BIN_DIR = Path("/opt/hospital/bin")
BACKUP_DIR = Path("/opt/hospital/bin.paralyzed.bak")
TOOLS = ("hl7-send", "dicom-test-store", "bacnet-write")
PORT = int(os.getenv("STATUS_PORT", "8093"))


def tool_ok(name: str) -> bool:
    for d in os.environ.get("PATH", "").split(":"):
        p = Path(d) / name
        if p.is_file() and os.access(p, os.X_OK):
            return True
    return False


def snapshot() -> dict:
    paralyzed = MARKER.is_file()
    tools = {t: tool_ok(t) for t in TOOLS}
    any_tool = any(tools.values())
    if paralyzed or not any_tool:
        status = "PARALYZED"
    else:
        status = "READY"
    return {
        "ok": True,
        "service": "protocol-runner",
        "status": status,
        "paralyzed": paralyzed or not any_tool,
        "tools": tools,
        "marker": str(MARKER) if paralyzed else None,
    }


def restore() -> dict:
    """Recovery-only endpoint for older lab states; no attack endpoint is exposed."""
    if BACKUP_DIR.exists():
        if BIN_DIR.exists():
            shutil.rmtree(BIN_DIR)
        shutil.copytree(BACKUP_DIR, BIN_DIR, symlinks=True)
        shutil.rmtree(BACKUP_DIR)
    MARKER.unlink(missing_ok=True)
    targets = {
        "hl7-send": BIN_DIR / "hl7_send.py",
        "bacnet-write": BIN_DIR / "bacnet_write.py",
        "dicom-test-store": BIN_DIR / "dicom_test_store.py",
    }
    for name, target in targets.items():
        link = Path("/usr/local/bin") / name
        if link.is_symlink() or link.exists():
            link.unlink()
        if target.exists():
            link.symlink_to(target)
    return snapshot()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # quiet
        return

    def _send(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/", "/health", "/status"):
            data = snapshot()
            self._send(200, data if path != "/health" else {"ok": True, "status": data["status"]})
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            if path == "/reset":
                self._send(200, {"ok": True, **restore()})
                return
        except OSError as exc:
            self._send(500, {"ok": False, "error": str(exc)})
            return
        self._send(404, {"ok": False, "error": "not found"})


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

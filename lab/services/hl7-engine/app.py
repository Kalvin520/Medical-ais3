"""HL7 MLLP engine + management API for mini hospital lab."""
from __future__ import annotations

import os
import threading
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from mllp_server import MLLPServer, get_state

RIS_URL = os.getenv("RIS_URL", "http://10.77.30.20:8080")
REJECT_DUPLICATE = os.getenv("REJECT_DUPLICATE_MSH10", "false").lower() == "true"
ALLOW_ANY = os.getenv("ALLOW_ANY_SOURCE", "true").lower() == "true"

app = FastAPI(title="hosp-hl7-engine", version="1.0.0")
_server: MLLPServer | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "hl7-engine", "mllp": 2575}


@app.get("/messages")
def messages() -> dict[str, Any]:
    return get_state()


@app.post("/reset")
def reset() -> dict[str, Any]:
    state = get_state()
    state["messages"].clear()
    state["seen_msh10"].clear()
    return {"ok": True}


@app.post("/send")
async def send_raw(payload: dict[str, Any]) -> JSONResponse:
    """Inject HL7 message via API (for reset / demo without MLLP client)."""
    from mllp_server import handle_message

    raw = payload.get("message", "")
    if not raw:
        return JSONResponse({"ok": False, "error": "message required"}, status_code=400)
    result = await handle_message(raw, peer="api")
    return JSONResponse(result)


def main() -> None:
    global _server
    _server = MLLPServer(
        host="0.0.0.0",
        port=2575,
        ris_url=RIS_URL,
        reject_duplicate=REJECT_DUPLICATE,
        allow_any_source=ALLOW_ANY,
    )
    t = threading.Thread(target=_server.serve_forever, daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=8075, log_level="info")


if __name__ == "__main__":
    main()

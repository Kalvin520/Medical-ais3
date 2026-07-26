"""BMS: cooling summary API + BACnet WriteProperty gateway to chiller."""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, Request

logger = logging.getLogger("bms")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

CHILLER_URL = os.getenv("CHILLER_URL", "http://10.77.50.20:8092")
ALLOW_ANY_WRITE = os.getenv("ALLOW_ANY_WRITE", "true").lower() == "true"

app = FastAPI(title="hosp-bms", version="1.0.0")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "bms"}


@app.get("/cooling")
def cooling() -> dict[str, Any]:
    with httpx.Client(timeout=5.0) as client:
        r = client.get(f"{CHILLER_URL}/status")
        r.raise_for_status()
        data = r.json()
    return {
        "status": data.get("status", "NORMAL"),
        "device_id": data.get("device_id", 42001),
        "source": "chiller-sim",
    }


@app.post("/bacnet/write")
async def bacnet_write(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    """Simulate BACnet WriteProperty (V-09: no source restriction)."""
    peer = request.client.host if request.client else "unknown"
    if not ALLOW_ANY_WRITE:
        return {"ok": False, "error": "write denied"}
    value = str(payload.get("value", payload.get("status", "ALARM"))).upper()
    if value not in {"NORMAL", "ALARM"}:
        return {"ok": False, "error": "value must be NORMAL or ALARM"}
    logger.info("BACnet WriteProperty peer=%s value=%s", peer, value)
    with httpx.Client(timeout=5.0) as client:
        r = client.post(f"{CHILLER_URL}/bacnet/write", json={"value": value, "peer": peer})
        data = r.json()
    return {"ok": r.is_success, "cooling": data, "peer": peer}


@app.post("/reset")
def reset() -> dict[str, Any]:
    with httpx.Client(timeout=5.0) as client:
        r = client.post(f"{CHILLER_URL}/reset")
        return {"ok": r.is_success, "chiller": r.json()}


def main() -> None:
    uvicorn.run(app, host="0.0.0.0", port=8091, log_level="info")


if __name__ == "__main__":
    main()

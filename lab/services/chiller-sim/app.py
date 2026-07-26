"""Chiller simulator: HTTP status API + real BACnet/IP (bacpypes3) Device.

Cooling status:
  NORMAL ↔ binary-value,1 present-value = inactive
  ALARM  ↔ binary-value,1 present-value = active

V-09: WriteProperty does not restrict source. HTTP /bacnet/write kept as dual-path.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
from typing import Any

import uvicorn
from fastapi import FastAPI, Request

logger = logging.getLogger("chiller-sim")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

DEVICE_ID = int(os.getenv("DEVICE_ID", "42001"))
BACNET_PORT = int(os.getenv("BACNET_PORT", "47808"))
HTTP_PORT = int(os.getenv("HTTP_PORT", "8092"))
ALLOW_ANY_WRITE = os.getenv("ALLOW_ANY_WRITE", "true").lower() == "true"
INITIAL = os.getenv("INITIAL_STATUS", "NORMAL").upper()
BACNET_ADDR = os.getenv("BACNET_ADDRESS", "10.77.50.20/24")
BACNET_NAME = os.getenv("BACNET_NAME", "HOSP-CHILLER")
COOLING_BV_INSTANCE = int(os.getenv("COOLING_BV_INSTANCE", "1"))

_STATE: dict[str, Any] = {
    "device_id": DEVICE_ID,
    "status": INITIAL if INITIAL in {"NORMAL", "ALARM"} else "NORMAL",
    "last_write_peer": None,
    "bacnet": {
        "address": BACNET_ADDR,
        "port": BACNET_PORT,
        "object": f"binary-value,{COOLING_BV_INSTANCE}",
        "mapping": {"inactive": "NORMAL", "active": "ALARM"},
    },
}

_bv_lock = threading.Lock()
_cooling_bv = None  # set when bacpypes app starts
_bacnet_ready = threading.Event()

app = FastAPI(title="hosp-chiller-sim", version="1.1.0")


def status_to_bv(value: str) -> str:
    return "active" if value == "ALARM" else "inactive"


def bv_to_status(pv: Any) -> str:
    text = str(pv).lower()
    if text in {"active", "1", "true", "alarm"}:
        return "ALARM"
    return "NORMAL"


def apply_write(value: str, peer: str) -> dict[str, Any]:
    # V-09: WriteProperty does not restrict source
    if not ALLOW_ANY_WRITE:
        return {"ok": False, "error": "write denied"}
    if value not in {"NORMAL", "ALARM"}:
        return {"ok": False, "error": "invalid value"}
    _STATE["status"] = value
    _STATE["last_write_peer"] = peer
    with _bv_lock:
        if _cooling_bv is not None:
            try:
                _cooling_bv.presentValue = status_to_bv(value)
            except Exception as exc:  # noqa: BLE001
                logger.warning("sync BACnet BV failed: %s", exc)
    logger.info("cooling write value=%s peer=%s", value, peer)
    return {"ok": True, **{k: _STATE[k] for k in ("device_id", "status", "last_write_peer", "bacnet")}}


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "chiller-sim",
        "status": _STATE["status"],
        "bacnet_ready": _bacnet_ready.is_set(),
    }


@app.get("/status")
def status() -> dict[str, Any]:
    return dict(_STATE)


@app.post("/bacnet/write")
async def bacnet_write_http(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    peer = payload.get("peer") or (request.client.host if request.client else "unknown")
    return apply_write(str(payload.get("value", "ALARM")).upper(), peer)


@app.post("/reset")
def reset() -> dict[str, Any]:
    return apply_write("NORMAL", "reset")


def _poll_bv_loop() -> None:
    """Mirror remote BACnet WriteProperty into HTTP-visible state."""
    while True:
        try:
            with _bv_lock:
                bv = _cooling_bv
                if bv is not None:
                    new_status = bv_to_status(bv.presentValue)
                    if new_status != _STATE["status"]:
                        _STATE["status"] = new_status
                        _STATE["last_write_peer"] = _STATE.get("last_write_peer") or "bacnet"
                        logger.info("BACnet BV change -> status=%s", new_status)
        except Exception as exc:  # noqa: BLE001
            logger.debug("BV poll: %s", exc)
        _bacnet_ready.wait(timeout=0.5)


async def _run_bacnet() -> None:
    global _cooling_bv
    from bacpypes3.argparse import SimpleArgumentParser
    from bacpypes3.app import Application
    from bacpypes3.local.binary import BinaryValueObject

    addr = BACNET_ADDR
    if ":" not in addr.split("/")[-1]:
        # append BACnet/IP port if not present (host/mask or host/mask:port)
        if "/" in addr and addr.count(":") == 0:
            addr = f"{addr}:{BACNET_PORT}"

    parser = SimpleArgumentParser()
    args = parser.parse_args(
        [
            "--name",
            BACNET_NAME,
            "--instance",
            str(DEVICE_ID),
            "--address",
            addr,
        ]
    )
    bac_app = Application.from_args(args)
    cooling = BinaryValueObject(
        objectIdentifier=("binary-value", COOLING_BV_INSTANCE),
        objectName="MRI-COOLING-ALARM",
        presentValue=status_to_bv(_STATE["status"]),
        description="MRI chiller alarm: inactive=NORMAL active=ALARM",
    )
    bac_app.add_object(cooling)
    with _bv_lock:
        _cooling_bv = cooling
    _bacnet_ready.set()
    logger.info(
        "BACnet/IP device_id=%s address=%s object=binary-value,%s",
        DEVICE_ID,
        addr,
        COOLING_BV_INSTANCE,
    )
    await asyncio.Future()


def _bacnet_thread() -> None:
    try:
        asyncio.run(_run_bacnet())
    except Exception:
        logger.exception("BACnet device failed to start")


def main() -> None:
    threading.Thread(target=_bacnet_thread, daemon=True, name="bacnet").start()
    threading.Thread(target=_poll_bv_loop, daemon=True, name="bv-poll").start()
    uvicorn.run(app, host="0.0.0.0", port=HTTP_PORT, log_level="info")


if __name__ == "__main__":
    main()

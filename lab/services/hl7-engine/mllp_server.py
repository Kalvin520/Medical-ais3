"""Lightweight HL7 v2 MLLP server (ADT^A01 / ORM^O01)."""
from __future__ import annotations

import asyncio
import logging
import socket
import threading
from datetime import datetime, timezone
from typing import Any

import httpx
import hl7

logger = logging.getLogger("hl7-engine")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

SB = b"\x0b"
EB = b"\x1c"
CR = b"\x0d"

_STATE: dict[str, Any] = {
    "messages": [],
    "seen_msh10": set(),
}


def get_state() -> dict[str, Any]:
    return {
        "messages": list(_STATE["messages"]),
        "seen_msh10": list(_STATE["seen_msh10"]),
        "count": len(_STATE["messages"]),
    }


def _field(seg: Any, idx: int, default: str = "") -> str:
    try:
        val = seg[idx]
        if hasattr(val, "__iter__") and not isinstance(val, (str, bytes)):
            # hl7 field may be nested
            return str(val[0]) if val else default
        return str(val) if val is not None else default
    except Exception:
        return default


def parse_hl7(raw: str) -> dict[str, Any]:
    msg = hl7.parse(raw.replace("\n", "\r"))
    msh = msg.segment("MSH")
    msg_type = _field(msh, 9)
    control_id = _field(msh, 10)
    info: dict[str, Any] = {
        "msh10": control_id,
        "type": msg_type,
        "raw": raw,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        pid = msg.segment("PID")
        info["patient_id"] = _field(pid, 3)
        info["patient_name"] = _field(pid, 5)
    except Exception:
        info["patient_id"] = ""
        info["patient_name"] = ""

    if "ORM" in msg_type.upper() or "O01" in msg_type.upper():
        try:
            orc = msg.segment("ORC")
            info["order_control"] = _field(orc, 1)
            info["placer_order"] = _field(orc, 2)
        except Exception:
            pass
        try:
            obr = msg.segment("OBR")
            info["accession"] = _field(obr, 3)
            info["modality"] = _field(obr, 24) or "MR"
            info["procedure"] = _field(obr, 4)
            info["scheduled_dt"] = _field(obr, 6) or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        except Exception:
            info["accession"] = info.get("placer_order", "ACC-UNKNOWN")
            info["modality"] = "MR"
            info["procedure"] = "MRI BRAIN"
            info["scheduled_dt"] = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    return info


def ack_message(control_id: str, ack_code: str = "AA") -> bytes:
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    msh = f"MSH|^~\\&|HL7ENGINE|HOSP|SENDER|HOSP|{now}||ACK^A01|{control_id}-ACK|P|2.5"
    msa = f"MSA|{ack_code}|{control_id}"
    body = f"{msh}\r{msa}\r".encode("utf-8")
    return SB + body + EB + CR


async def push_to_ris(info: dict[str, Any], ris_url: str) -> None:
    msg_type = (info.get("type") or "").upper()
    if "ADT" in msg_type:
        payload = {
            "patient_id": info.get("patient_id") or "UNKNOWN",
            "patient_name": info.get("patient_name") or "UNKNOWN",
            "event": "ADT",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(f"{ris_url}/patients", json=payload)
            logger.info("RIS patient upsert status=%s", r.status_code)
        return

    if "ORM" in msg_type or "O01" in msg_type:
        payload = {
            "accession": info.get("accession") or info.get("placer_order") or f"ACC-{info.get('msh10','X')}",
            "patient_id": info.get("patient_id") or "UNKNOWN",
            "patient_name": info.get("patient_name") or "UNKNOWN",
            "modality": info.get("modality") or "MR",
            "procedure": info.get("procedure") or "MRI BRAIN",
            "scheduled_dt": info.get("scheduled_dt"),
            "msh10": info.get("msh10"),
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(f"{ris_url}/worklist", json=payload)
            logger.info("RIS worklist upsert status=%s body=%s", r.status_code, r.text[:200])


async def handle_message(raw: str, peer: str = "unknown") -> dict[str, Any]:
    info = parse_hl7(raw)
    info["peer"] = peer
    msh10 = info.get("msh10") or ""

    # V-05: default does NOT reject duplicate MSH-10
    if REJECT_DUPLICATE and msh10 and msh10 in _STATE["seen_msh10"]:
        logger.warning("Rejected duplicate MSH-10=%s", msh10)
        return {"ok": False, "error": "duplicate MSH-10", "info": info}

    if msh10:
        _STATE["seen_msh10"].add(msh10)
    _STATE["messages"].append(info)
    logger.info("HL7 received type=%s msh10=%s pid=%s peer=%s", info.get("type"), msh10, info.get("patient_id"), peer)

    ris_url = getattr(handle_message, "ris_url", "http://10.77.30.20:8080")
    try:
        await push_to_ris(info, ris_url)
    except Exception as exc:
        logger.exception("RIS push failed: %s", exc)
        return {"ok": False, "error": str(exc), "info": info}

    return {"ok": True, "info": info}


# module-level flag set by server
REJECT_DUPLICATE = False


class MLLPServer:
    def __init__(
        self,
        host: str,
        port: int,
        ris_url: str,
        reject_duplicate: bool = False,
        allow_any_source: bool = True,
    ) -> None:
        self.host = host
        self.port = port
        self.ris_url = ris_url
        self.reject_duplicate = reject_duplicate
        self.allow_any_source = allow_any_source
        global REJECT_DUPLICATE
        REJECT_DUPLICATE = reject_duplicate
        handle_message.ris_url = ris_url  # type: ignore[attr-defined]

    def serve_forever(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.host, self.port))
        sock.listen(32)
        logger.info("MLLP listening on %s:%s (allow_any=%s reject_dup=%s)", self.host, self.port, self.allow_any_source, self.reject_duplicate)
        while True:
            conn, addr = sock.accept()
            threading.Thread(target=self._handle_conn, args=(conn, addr), daemon=True).start()

    def _handle_conn(self, conn: socket.socket, addr: tuple[str, int]) -> None:
        peer = f"{addr[0]}:{addr[1]}"
        # V-04: plaintext MLLP; any source accepted when allow_any_source
        if not self.allow_any_source:
            logger.warning("Source check would apply; peer=%s", peer)
        buf = b""
        try:
            conn.settimeout(30)
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                buf += chunk
                while True:
                    start = buf.find(SB)
                    end = buf.find(EB)
                    if start < 0 or end < 0 or end < start:
                        break
                    payload = buf[start + 1 : end]
                    if payload.endswith(CR):
                        payload = payload[:-1]
                    buf = buf[end + 1 :]
                    if buf.startswith(CR):
                        buf = buf[1:]
                    raw = payload.decode("utf-8", errors="replace")
                    result = asyncio.run(handle_message(raw, peer=peer))
                    ack = ack_message(result.get("info", {}).get("msh10", "0"), "AA" if result.get("ok") else "AE")
                    conn.sendall(ack)
        except Exception as exc:
            logger.exception("MLLP connection error peer=%s: %s", peer, exc)
        finally:
            conn.close()

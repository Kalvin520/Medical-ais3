"""Lab scene: aggregate facility status + serve isometric hospital UI."""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import socket
from pathlib import Path
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("lab-scene")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

STATIC_DIR = Path(__file__).resolve().parent / "static"
HTTP_TIMEOUT = float(os.getenv("PROBE_TIMEOUT", "2.0"))

MRI_URL = os.getenv("MRI_URL", "http://10.77.40.20:8090")
BMS_URL = os.getenv("BMS_URL", "http://10.77.50.10:8091")
CHILLER_URL = os.getenv("CHILLER_URL", "http://10.77.50.20:8092")
HL7_API = os.getenv("HL7_API", "http://10.77.30.10:8075")
RIS_URL = os.getenv("RIS_URL", "http://10.77.30.20:8080")
PACS_URL = os.getenv("PACS_URL", "http://10.77.40.10:8042")
PACS_USER = os.getenv("PACS_USER", "overprivileged")
PACS_PASS = os.getenv("PACS_PASS", "lab-dicomweb-token-overprivileged")
FHIR_URL = os.getenv("FHIR_URL", "http://10.77.20.20:8080/fhir")
FHIR_TOKEN = os.getenv("FHIR_TOKEN", "lab-fhir-token-overprivileged")
RESET_URL = os.getenv("RESET_URL", "http://10.77.99.10:8099")

VENDOR_HOST = os.getenv("VENDOR_HOST", "10.77.10.20")
BIOMED_HOST = os.getenv("BIOMED_HOST", "10.77.20.10")
RUNNER_HOST = os.getenv("RUNNER_HOST", "10.77.50.40")
RUNNER_STATUS_URL = os.getenv("RUNNER_STATUS_URL", "http://10.77.50.40:8093")

# Host-facing quick links (browser on lab host)
PUBLIC = {
    "orthanc": "http://127.0.0.1:8042",
    "fhir": os.getenv("PUBLIC_FHIR_URL", "http://127.0.0.1:8180/fhir"),
    "hl7_docs": "http://127.0.0.1:8075/docs",
    "ris_worklist": "http://127.0.0.1:8085/worklist",
    "ris_docs": "http://127.0.0.1:8085/docs",
    "mri_status": "http://127.0.0.1:8090/status",
    "mri_docs": "http://127.0.0.1:8090/docs",
    "bms_cooling": "http://127.0.0.1:8091/cooling",
    "bms_docs": "http://127.0.0.1:8091/docs",
    "chiller_status": "http://127.0.0.1:8092/status",
    "chiller_docs": "http://127.0.0.1:8092/docs",
    "reset_health": "http://127.0.0.1:8099/health",
    "reset_docs": "http://127.0.0.1:8099/docs",
}

app = FastAPI(title="hosp-lab-scene", version="1.0.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def tcp_open(host: str, port: int, timeout: float = HTTP_TIMEOUT) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


async def get_json(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: dict[str, str] | None = None,
) -> tuple[bool, Any]:
    try:
        r = await client.get(url, headers=headers)
        if r.status_code >= 400:
            return False, None
        if "application/json" in r.headers.get("content-type", "") or r.text[:1] in "{[":
            return True, r.json()
        return True, r.text
    except Exception as exc:  # noqa: BLE001
        logger.debug("probe fail %s: %s", url, exc)
        return False, None


async def probe_ssh(id_: str, label: str, zone: str, host: str, ip: str) -> dict[str, Any]:
    online = await asyncio.to_thread(tcp_open, host, 22)
    return {
        "id": id_,
        "label": label,
        "zone": zone,
        "ip": ip,
        "online": online,
        "level": "ok" if online else "offline",
        "detail": {"ssh": 22, "reachable": online},
        "links": [],
    }


async def probe_protocol_runner(client: httpx.AsyncClient) -> dict[str, Any]:
    """SSH reachability + tool status (soft paralyze shows as alarm)."""
    ssh_up = await asyncio.to_thread(tcp_open, RUNNER_HOST, 22)
    ok, data = await get_json(client, f"{RUNNER_STATUS_URL.rstrip('/')}/status")
    status = (data or {}).get("status") if ok else None
    paralyzed = bool((data or {}).get("paralyzed")) if ok else False
    tools = (data or {}).get("tools") if ok else None

    if not ssh_up and not ok:
        level = "offline"
        online = False
        status = status or "OFFLINE"
    elif paralyzed or status == "PARALYZED":
        level = "alarm"
        online = True
        status = "PARALYZED"
    elif ssh_up:
        level = "ok"
        online = True
        status = status or "READY"
    else:
        level = "offline"
        online = False
        status = "OFFLINE"

    return {
        "id": "protocol-runner",
        "label": "協議工具箱",
        "zone": "ot",
        "ip": "10.77.50.40",
        "online": online,
        "level": level,
        "detail": {
            "ssh": 22,
            "reachable": ssh_up,
            "status": status,
            "paralyzed": paralyzed,
            "tools": tools,
        },
        "links": [
            {"label": "Runner /status", "href": "http://127.0.0.1:8093/status"},
        ],
    }


async def probe_mri(client: httpx.AsyncClient) -> dict[str, Any]:
    ok, data = await get_json(client, f"{MRI_URL}/status")
    status = (data or {}).get("status", "UNKNOWN") if ok else "UNKNOWN"
    cooling = (data or {}).get("cooling", "UNKNOWN") if ok else "UNKNOWN"
    if not ok:
        level = "offline"
    elif status == "PROTECTIVE_STOP" or cooling == "ALARM":
        level = "alarm"
    else:
        level = "ok"
    return {
        "id": "mri-sim",
        "label": "MRI 掃描器",
        "zone": "imaging",
        "ip": "10.77.40.20",
        "online": ok,
        "level": level,
        "detail": {
            "status": status if ok else None,
            "cooling": cooling if ok else None,
            "last_scan": (data or {}).get("last_scan") if ok else None,
            "studies": len((data or {}).get("studies") or []) if ok else 0,
        },
        "links": [
            {"label": "MRI /status", "href": PUBLIC["mri_status"]},
            {"label": "MRI API docs", "href": PUBLIC["mri_docs"]},
        ],
    }


async def probe_bms(client: httpx.AsyncClient) -> dict[str, Any]:
    ok_h, _ = await get_json(client, f"{BMS_URL}/health")
    ok_c, cooling = await get_json(client, f"{BMS_URL}/cooling")
    ok = ok_h or ok_c
    status = (cooling or {}).get("status", "UNKNOWN") if ok_c else "UNKNOWN"
    if not ok:
        level = "offline"
    elif status == "ALARM":
        level = "alarm"
    else:
        level = "ok"
    return {
        "id": "bms",
        "label": "BMS 設施監控",
        "zone": "ot",
        "ip": "10.77.50.10",
        "online": ok,
        "level": level,
        "detail": {
            "cooling": status if ok_c else None,
            "device_id": (cooling or {}).get("device_id") if ok_c else None,
            "source": (cooling or {}).get("source") if ok_c else None,
        },
        "links": [
            {"label": "冷卻摘要", "href": PUBLIC["bms_cooling"]},
            {"label": "BMS API docs", "href": PUBLIC["bms_docs"]},
        ],
    }


async def probe_chiller(client: httpx.AsyncClient) -> dict[str, Any]:
    ok, data = await get_json(client, f"{CHILLER_URL}/status")
    status = (data or {}).get("status", "UNKNOWN") if ok else "UNKNOWN"
    if not ok:
        level = "offline"
    elif status == "ALARM":
        level = "alarm"
    else:
        level = "ok"
    return {
        "id": "chiller-sim",
        "label": "MRI 冷卻機",
        "zone": "ot",
        "ip": "10.77.50.20",
        "online": ok,
        "level": level,
        "detail": {
            "status": status if ok else None,
            "device_id": (data or {}).get("device_id") if ok else None,
            "last_write_peer": (data or {}).get("last_write_peer") if ok else None,
        },
        "links": [
            {"label": "Chiller /status", "href": PUBLIC["chiller_status"]},
            {"label": "Chiller API docs", "href": PUBLIC["chiller_docs"]},
        ],
    }


async def probe_hl7(client: httpx.AsyncClient) -> dict[str, Any]:
    ok_h, _ = await get_json(client, f"{HL7_API}/health")
    ok_m, msgs = await get_json(client, f"{HL7_API}/messages")
    ok = ok_h or ok_m
    count = 0
    if ok_m and isinstance(msgs, dict):
        count = len(msgs.get("messages") or [])
    return {
        "id": "hl7-engine",
        "label": "HL7 引擎",
        "zone": "integ",
        "ip": "10.77.30.10",
        "online": ok,
        "level": "ok" if ok else "offline",
        "detail": {"message_count": count},
        "links": [{"label": "HL7 API docs", "href": PUBLIC["hl7_docs"]}],
    }


async def probe_ris(client: httpx.AsyncClient) -> dict[str, Any]:
    ok_h, _ = await get_json(client, f"{RIS_URL}/health")
    ok_w, wl = await get_json(client, f"{RIS_URL}/worklist")
    ok = ok_h or ok_w
    count = 0
    if ok_w:
        if isinstance(wl, list):
            count = len(wl)
        elif isinstance(wl, dict):
            count = len(wl.get("worklist") or wl.get("items") or [])
    return {
        "id": "ris-mwl",
        "label": "RIS / MWL",
        "zone": "integ",
        "ip": "10.77.30.20",
        "online": ok,
        "level": "ok" if ok else "offline",
        "detail": {"worklist_count": count},
        "links": [
            {"label": "Worklist", "href": PUBLIC["ris_worklist"]},
            {"label": "RIS API docs", "href": PUBLIC["ris_docs"]},
        ],
    }


def pacs_auth_headers() -> dict[str, str]:
    token = base64.b64encode(f"{PACS_USER}:{PACS_PASS}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


async def probe_pacs(client: httpx.AsyncClient) -> dict[str, Any]:
    headers = pacs_auth_headers()
    ok_s, system = await get_json(client, f"{PACS_URL}/system", headers=headers)
    ok_st, studies = await get_json(client, f"{PACS_URL}/studies", headers=headers)
    ok = ok_s or ok_st
    study_count = len(studies) if ok_st and isinstance(studies, list) else 0
    return {
        "id": "pacs",
        "label": "PACS (Orthanc)",
        "zone": "imaging",
        "ip": "10.77.40.10",
        "online": ok,
        "level": "ok" if ok else "offline",
        "detail": {
            "name": (system or {}).get("Name") if isinstance(system, dict) else None,
            "study_count": study_count,
            "version": (system or {}).get("Version") if isinstance(system, dict) else None,
        },
        "links": [{"label": "Orthanc Web", "href": PUBLIC["orthanc"]}],
    }


async def probe_fhir(client: httpx.AsyncClient) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {FHIR_TOKEN}"}
    ok_m, meta = await get_json(client, f"{FHIR_URL}/metadata", headers=headers)
    ok_p, bundle = await get_json(
        client, f"{FHIR_URL}/Patient?_summary=count", headers=headers
    )
    ok = ok_m or ok_p
    patient_count = None
    if ok_p and isinstance(bundle, dict):
        patient_count = bundle.get("total")
    return {
        "id": "ehr-fhir",
        "label": "EHR FHIR",
        "zone": "clinical",
        "ip": "10.77.20.20",
        "online": ok,
        "level": "ok" if ok else "offline",
        "detail": {
            "fhir_version": (meta or {}).get("fhirVersion") if isinstance(meta, dict) else None,
            "patient_count": patient_count,
        },
        "links": [{"label": "FHIR endpoint", "href": PUBLIC["fhir"]}],
    }


async def probe_reset(client: httpx.AsyncClient) -> dict[str, Any]:
    ok_h, health = await get_json(client, f"{RESET_URL}/health")
    ok_s, seed = await get_json(client, f"{RESET_URL}/seed-version")
    ok = ok_h or ok_s
    version = None
    if ok_s and isinstance(seed, dict):
        version = seed.get("seed_version")
    elif ok_h and isinstance(health, dict):
        version = health.get("seed_version")
    return {
        "id": "reset-controller",
        "label": "Reset 控制器",
        "zone": "mgmt",
        "ip": "10.77.99.10",
        "online": ok,
        "level": "ok" if ok else "offline",
        "detail": {"seed_version": version},
        "links": [
            {"label": "Reset /health", "href": PUBLIC["reset_health"]},
            {"label": "Reset API docs", "href": PUBLIC["reset_docs"]},
        ],
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "lab-scene"}


@app.get("/api/snapshot")
async def snapshot() -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        facilities = await asyncio.gather(
            probe_ssh("vendor-entry", "廠商入口", "dmz", VENDOR_HOST, "10.77.10.20"),
            probe_ssh("biomed-ws", "醫療工程站", "clinical", BIOMED_HOST, "10.77.20.10"),
            probe_fhir(client),
            probe_hl7(client),
            probe_ris(client),
            probe_pacs(client),
            probe_mri(client),
            probe_bms(client),
            probe_chiller(client),
            probe_protocol_runner(client),
            probe_reset(client),
        )

    by_id = {f["id"]: f for f in facilities}
    cooling = (by_id.get("chiller-sim") or {}).get("detail", {}).get("status")
    mri_status = (by_id.get("mri-sim") or {}).get("detail", {}).get("status")
    online_n = sum(1 for f in facilities if f.get("online"))

    return {
        "ok": True,
        "summary": {
            "online": online_n,
            "total": len(facilities),
            "cooling": cooling,
            "mri_status": mri_status,
        },
        "facilities": facilities,
        "flows": {
            "clinical": ["hl7-engine", "ris-mwl", "mri-sim", "pacs", "ehr-fhir"],
            "cooling": ["chiller-sim", "bms", "mri-sim"],
        },
        "links": PUBLIC,
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


def main() -> None:
    uvicorn.run(app, host="0.0.0.0", port=8100, log_level="info")


if __name__ == "__main__":
    main()

"""Seed / reset helpers for mini hospital lab."""
from __future__ import annotations

import json
import logging
import os
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("seed_lib")

SEED_VERSION = os.getenv("SEED_VERSION", "2026.07.25-mvp")
SEED_DIR = Path(os.getenv("SEED_DIR", "/seed"))
FHIR_URL = os.getenv("FHIR_URL", "http://10.77.20.20:8080/fhir")
FHIR_TOKEN = os.getenv("FHIR_TOKEN", "lab-fhir-token-overprivileged")
HL7_HOST = os.getenv("HL7_HOST", "10.77.30.10")
HL7_PORT = int(os.getenv("HL7_PORT", "2575"))
HL7_API = os.getenv("HL7_API", "http://10.77.30.10:8075")
RIS_URL = os.getenv("RIS_URL", "http://10.77.30.20:8080")
PACS_URL = os.getenv("PACS_URL", "http://10.77.40.10:8042")
PACS_USER = os.getenv("PACS_USER", "overprivileged")
PACS_PASS = os.getenv("PACS_PASS", "lab-dicomweb-token-overprivileged")
MRI_URL = os.getenv("MRI_URL", "http://10.77.40.20:8090")
BMS_URL = os.getenv("BMS_URL", "http://10.77.50.10:8091")
CHILLER_URL = os.getenv("CHILLER_URL", "http://10.77.50.20:8092")

SB, EB, CR = b"\x0b", b"\x1c", b"\x0d"


def _pacs_auth() -> httpx.BasicAuth:
    return httpx.BasicAuth(PACS_USER, PACS_PASS)


def _wait(url: str, timeout: float = 120.0, auth: httpx.Auth | None = None) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with httpx.Client(timeout=3.0, auth=auth) as client:
                r = client.get(url)
                if r.status_code < 500:
                    return
        except Exception:
            pass
        time.sleep(2)
    raise TimeoutError(f"service not ready: {url}")


def mllp_send(message: str) -> str:
    body = message.replace("\n", "\r").encode("utf-8")
    if not body.endswith(CR):
        body += CR
    payload = SB + body + EB + CR
    with socket.create_connection((HL7_HOST, HL7_PORT), timeout=10) as sock:
        sock.sendall(payload)
        buf = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
            if EB in buf:
                break
    return buf.decode("utf-8", errors="replace")


def clear_services() -> None:
    with httpx.Client(timeout=30.0) as client:
        for url in [
            f"{HL7_API}/reset",
            f"{RIS_URL}/reset",
            f"{MRI_URL}/reset",
            f"{CHILLER_URL}/reset",
        ]:
            try:
                client.post(url)
                logger.info("reset ok %s", url)
            except Exception as exc:
                logger.warning("reset failed %s: %s", url, exc)

        try:
            with httpx.Client(timeout=30.0, auth=_pacs_auth()) as pacs:
                studies = pacs.get(f"{PACS_URL}/studies").json()
                for sid in studies:
                    pacs.delete(f"{PACS_URL}/studies/{sid}")
                logger.info("cleared %s pacs studies", len(studies))
        except Exception as exc:
            logger.warning("pacs clear failed: %s", exc)

        headers = {"Authorization": f"Bearer {FHIR_TOKEN}"}
        try:
            for resource in ("ImagingStudy", "Patient"):
                r = client.get(f"{FHIR_URL}/{resource}", headers=headers, params={"_count": 50})
                if r.status_code != 200:
                    continue
                bundle = r.json()
                for entry in bundle.get("entry", []):
                    res = entry.get("resource", {})
                    rid = res.get("id")
                    if rid:
                        client.delete(f"{FHIR_URL}/{resource}/{rid}", headers=headers)
        except Exception as exc:
            logger.warning("fhir clear failed: %s", exc)


def load_hl7_seed() -> None:
    patients_dir = SEED_DIR / "patients"
    for path in sorted(patients_dir.glob("*.hl7")):
        msg = path.read_text(encoding="utf-8")
        ack = mllp_send(msg)
        logger.info("seeded HL7 %s ack_len=%s", path.name, len(ack))


def load_fhir_seed() -> None:
    fhir_dir = SEED_DIR / "fhir"
    headers = {
        "Authorization": f"Bearer {FHIR_TOKEN}",
        "Content-Type": "application/fhir+json",
    }
    with httpx.Client(timeout=30.0) as client:
        for path in sorted(fhir_dir.glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("resourceType") == "Bundle":
                r = client.post(FHIR_URL, headers=headers, json=data)
            else:
                rtype = data.get("resourceType", "Patient")
                rid = data.get("id")
                if rid:
                    r = client.put(f"{FHIR_URL}/{rtype}/{rid}", headers=headers, json=data)
                else:
                    r = client.post(f"{FHIR_URL}/{rtype}", headers=headers, json=data)
            logger.info("seeded FHIR %s status=%s", path.name, r.status_code)


def baseline_mri_scan() -> dict[str, Any]:
    with httpx.Client(timeout=60.0) as client:
        for _ in range(30):
            st = client.get(f"{MRI_URL}/status").json()
            if st.get("status") == "READY":
                break
            time.sleep(1)
        r = client.post(
            f"{MRI_URL}/scan/baseline",
            json={"patient_id": "patient-001", "accession": "ACC-001"},
        )
        return r.json()


def run_reset() -> dict[str, Any]:
    steps: list[str] = []
    try:
        _wait(f"{RIS_URL}/health")
        _wait(f"{HL7_API}/health")
        _wait(f"{PACS_URL}/system", auth=_pacs_auth())
        deadline = time.time() + 120
        while time.time() < deadline:
            try:
                with httpx.Client(timeout=3.0) as client:
                    r = client.get(
                        f"{FHIR_URL}/metadata",
                        headers={"Authorization": f"Bearer {FHIR_TOKEN}"},
                    )
                    if r.status_code < 500:
                        break
            except Exception:
                pass
            time.sleep(2)
        else:
            raise TimeoutError("fhir gateway not ready")
        _wait(f"{MRI_URL}/health")
        _wait(f"{CHILLER_URL}/health")
        steps.append("wait-ready")

        clear_services()
        steps.append("clear")

        load_hl7_seed()
        steps.append("hl7-seed")

        load_fhir_seed()
        steps.append("fhir-seed")

        with httpx.Client(timeout=10.0) as client:
            client.post(f"{CHILLER_URL}/reset")
            time.sleep(2)
            client.post(f"{MRI_URL}/reset")
        steps.append("cooling-normal")

        scan = baseline_mri_scan()
        steps.append("baseline-scan")

        return {
            "ok": True,
            "seed_version": SEED_VERSION,
            "steps": steps,
            "baseline_scan": scan,
            "at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.exception("reset failed")
        return {"ok": False, "seed_version": SEED_VERSION, "steps": steps, "error": str(exc)}

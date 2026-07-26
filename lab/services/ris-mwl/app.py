"""RIS / DICOM Modality Worklist SCP + HTTP API."""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

import uvicorn
from fastapi import FastAPI
from pydicom.dataset import Dataset
from pynetdicom import AE, evt
from pynetdicom.sop_class import ModalityWorklistInformationFind

logger = logging.getLogger("ris-mwl")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

AE_TITLE = os.getenv("AE_TITLE", "HOSP_RIS")
DICOM_PORT = int(os.getenv("DICOM_PORT", "11114"))

_DB: dict[str, Any] = {
    "patients": {},
    "worklist": [],
}

app = FastAPI(title="hosp-ris-mwl", version="1.0.0")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "ris-mwl", "worklist_count": len(_DB["worklist"])}


@app.get("/worklist")
def list_worklist() -> dict[str, Any]:
    return {"items": list(_DB["worklist"])}


@app.post("/worklist")
def add_worklist(item: dict[str, Any]) -> dict[str, Any]:
    # V-05 effect path: duplicates allowed (no unique MSH-10 / accession reject)
    entry = {
        "accession": item.get("accession") or f"ACC-{len(_DB['worklist'])+1}",
        "patient_id": item.get("patient_id") or "UNKNOWN",
        "patient_name": item.get("patient_name") or "UNKNOWN",
        "modality": item.get("modality") or "MR",
        "procedure": item.get("procedure") or "MRI BRAIN",
        "scheduled_dt": item.get("scheduled_dt") or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
        "msh10": item.get("msh10"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _DB["worklist"].append(entry)
    pid = entry["patient_id"]
    _DB["patients"][pid] = {
        "patient_id": pid,
        "patient_name": entry["patient_name"],
    }
    logger.info("Worklist added accession=%s pid=%s", entry["accession"], pid)
    return {"ok": True, "item": entry}


@app.post("/patients")
def upsert_patient(item: dict[str, Any]) -> dict[str, Any]:
    pid = item.get("patient_id") or "UNKNOWN"
    _DB["patients"][pid] = {
        "patient_id": pid,
        "patient_name": item.get("patient_name") or "UNKNOWN",
    }
    return {"ok": True, "patient": _DB["patients"][pid]}


@app.get("/patients")
def list_patients() -> dict[str, Any]:
    return {"items": list(_DB["patients"].values())}


@app.post("/reset")
def reset() -> dict[str, Any]:
    _DB["patients"].clear()
    _DB["worklist"].clear()
    return {"ok": True}


def _match(req: Dataset | None, value: str | None) -> bool:
    if req is None:
        return True
    key = str(req).strip()
    if not key or key == "*":
        return True
    if value is None:
        return False
    if key.endswith("*"):
        return str(value).startswith(key[:-1])
    return str(value) == key


def handle_find(event: Any) -> Any:
    ds = event.identifier
    logger.info("MWL C-FIND received")
    for item in list(_DB["worklist"]):
        if not _match(getattr(ds, "PatientID", None), item["patient_id"]):
            continue
        if hasattr(ds, "Modality") and ds.Modality and not _match(ds.Modality, item["modality"]):
            # ScheduledProcedureStepSequence modality check is more correct; keep simple
            pass

        ident = Dataset()
        ident.PatientName = item["patient_name"]
        ident.PatientID = item["patient_id"]
        ident.AccessionNumber = item["accession"]
        ident.RequestedProcedureDescription = item["procedure"]
        ident.RequestedProcedureID = item["accession"]
        ident.StudyInstanceUID = f"1.2.826.0.1.3680043.10.77.{item['accession'].replace('-', '')}"

        sps = Dataset()
        sps.Modality = item["modality"]
        sps.ScheduledStationAETitle = "HOSP_MRI"
        sps.ScheduledProcedureStepStartDate = item["scheduled_dt"][:8]
        sps.ScheduledProcedureStepStartTime = item["scheduled_dt"][8:] if len(item["scheduled_dt"]) > 8 else "090000"
        sps.ScheduledPerformingPhysicianName = "Dr^Synthetic"
        sps.ScheduledProcedureStepDescription = item["procedure"]
        sps.ScheduledProcedureStepID = item["accession"]
        ident.ScheduledProcedureStepSequence = [sps]

        yield 0xFF00, ident

    yield 0x0000, None


def start_mwl() -> None:
    ae = AE(ae_title=AE_TITLE)
    ae.add_supported_context(ModalityWorklistInformationFind)
    handlers = [(evt.EVT_C_FIND, handle_find)]
    logger.info("MWL SCP starting AE=%s port=%s", AE_TITLE, DICOM_PORT)
    ae.start_server(("0.0.0.0", DICOM_PORT), block=True, evt_handlers=handlers)


def main() -> None:
    t = threading.Thread(target=start_mwl, daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="info")


if __name__ == "__main__":
    main()

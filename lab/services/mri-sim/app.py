"""MRI simulator: polls BMS cooling status; C-FIND MWL + C-STORE to PACS."""
from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import (
    ExplicitVRLittleEndian,
    SecondaryCaptureImageStorage,
    generate_uid,
)
from pynetdicom import AE, debug_logger
from pynetdicom.sop_class import (
    CTImageStorage,
    MRImageStorage,
    ModalityWorklistInformationFind,
    SecondaryCaptureImageStorage as SC_SOP,
    Verification,
)

logger = logging.getLogger("mri-sim")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

BMS_URL = os.getenv("BMS_URL", "http://10.77.50.10:8091")
RIS_HOST = os.getenv("RIS_MWL_HOST", "10.77.30.20")
RIS_PORT = int(os.getenv("RIS_MWL_PORT", "11114"))
RIS_AE = os.getenv("RIS_AE", "HOSP_RIS")
PACS_HOST = os.getenv("PACS_HOST", "10.77.40.10")
PACS_PORT = int(os.getenv("PACS_PORT", "11112"))
PACS_AE = os.getenv("PACS_AE", "HOSP_PACS")
MRI_AE = os.getenv("MRI_AE", "HOSP_MRI")
FHIR_URL = os.getenv("FHIR_URL", "http://10.77.20.20:8080/fhir")
FHIR_TOKEN = os.getenv("FHIR_TOKEN", "lab-fhir-token-overprivileged")
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "3"))

_STATE: dict[str, Any] = {
    "status": "READY",
    "cooling": "NORMAL",
    "last_scan": None,
    "studies": [],
}

app = FastAPI(title="hosp-mri-sim", version="1.0.0")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "mri-sim", **{k: _STATE[k] for k in ("status", "cooling")}}


@app.get("/status")
def status() -> dict[str, Any]:
    return dict(_STATE)


@app.post("/scan/baseline")
def scan_baseline(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    if _STATE["status"] == "PROTECTIVE_STOP":
        return {"ok": False, "error": "MRI in PROTECTIVE_STOP", "status": _STATE["status"]}
    patient_id = payload.get("patient_id", "patient-001")
    accession = payload.get("accession")
    result = run_scan(patient_id=patient_id, accession=accession, study_prefix="")
    return result


@app.post("/reset")
def reset() -> dict[str, Any]:
    _STATE["status"] = "READY" if _STATE.get("cooling") == "NORMAL" else "PROTECTIVE_STOP"
    _STATE["last_scan"] = None
    _STATE["studies"].clear()
    return {"ok": True, "status": _STATE["status"]}


def update_from_bms() -> None:
    while True:
        try:
            with httpx.Client(timeout=5.0) as client:
                r = client.get(f"{BMS_URL}/cooling")
                if r.status_code == 200:
                    cooling = r.json().get("status", "NORMAL")
                    _STATE["cooling"] = cooling
                    if cooling == "ALARM":
                        if _STATE["status"] != "PROTECTIVE_STOP":
                            logger.warning("Cooling ALARM -> MRI PROTECTIVE_STOP")
                        _STATE["status"] = "PROTECTIVE_STOP"
                    else:
                        if _STATE["status"] == "PROTECTIVE_STOP":
                            logger.info("Cooling NORMAL -> MRI READY")
                        _STATE["status"] = "READY"
        except Exception as exc:
            logger.debug("BMS poll failed: %s", exc)
        time.sleep(POLL_INTERVAL)


def find_worklist(patient_id: str | None = None) -> list[dict[str, Any]]:
    ae = AE(ae_title=MRI_AE)
    ae.add_requested_context(ModalityWorklistInformationFind)
    assoc = ae.associate(RIS_HOST, RIS_PORT, ae_title=RIS_AE)
    items: list[dict[str, Any]] = []
    if not assoc.is_established:
        logger.error("MWL association failed")
        return items
    ds = Dataset()
    ds.PatientName = "*"
    ds.PatientID = patient_id or ""
    ds.AccessionNumber = ""
    ds.RequestedProcedureID = ""
    ds.RequestedProcedureDescription = ""
    ds.StudyInstanceUID = ""
    sps = Dataset()
    sps.Modality = "MR"
    sps.ScheduledStationAETitle = ""
    sps.ScheduledProcedureStepStartDate = ""
    sps.ScheduledProcedureStepStartTime = ""
    sps.ScheduledPerformingPhysicianName = ""
    sps.ScheduledProcedureStepDescription = ""
    sps.ScheduledProcedureStepID = ""
    ds.ScheduledProcedureStepSequence = [sps]
    for status_code, ident in assoc.send_c_find(ds, ModalityWorklistInformationFind):
        if status_code.Status in (0xFF00, 0xFF01) and ident is not None:
            items.append(
                {
                    "patient_id": str(getattr(ident, "PatientID", "")),
                    "patient_name": str(getattr(ident, "PatientName", "")),
                    "accession": str(getattr(ident, "AccessionNumber", "")),
                    "study_uid": str(getattr(ident, "StudyInstanceUID", "")),
                    "procedure": str(getattr(ident, "RequestedProcedureDescription", "")),
                }
            )
    assoc.release()
    return items


def make_secondary_capture(
    patient_id: str,
    patient_name: str,
    accession: str,
    study_uid: str | None = None,
    study_prefix: str = "",
) -> Dataset:
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = generate_uid()

    ds = Dataset()
    ds.file_meta = file_meta
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    ds.SOPClassUID = SecondaryCaptureImageStorage
    ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = study_uid or generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.PatientID = patient_id
    ds.PatientName = patient_name
    ds.AccessionNumber = f"{study_prefix}{accession}" if study_prefix else accession
    ds.Modality = "MR"
    ds.StudyDescription = f"{study_prefix}Synthetic MRI Brain" if study_prefix else "Synthetic MRI Brain"
    ds.SeriesDescription = "LOCALIZER"
    ds.StudyDate = datetime.now(timezone.utc).strftime("%Y%m%d")
    ds.StudyTime = datetime.now(timezone.utc).strftime("%H%M%S")
    ds.InstanceNumber = "1"
    ds.Rows = 16
    ds.Columns = 16
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.PixelData = bytes([i % 256 for i in range(16 * 16)])
    return ds


def store_to_pacs(ds: Dataset) -> bool:
    ae = AE(ae_title=MRI_AE)
    ae.add_requested_context(Verification)
    ae.add_requested_context(MRImageStorage)
    ae.add_requested_context(CTImageStorage)
    ae.add_requested_context(SC_SOP)
    assoc = ae.associate(PACS_HOST, PACS_PORT, ae_title=PACS_AE)
    if not assoc.is_established:
        logger.error("PACS association failed")
        return False
    status = assoc.send_c_store(ds)
    ok = status is not None and status.Status == 0x0000
    logger.info("C-STORE status=%s accession=%s", getattr(status, "Status", None), ds.AccessionNumber)
    assoc.release()
    return ok


def publish_imaging_study(patient_id: str, study_uid: str, accession: str) -> None:
    bundle = {
        "resourceType": "ImagingStudy",
        "status": "available",
        "subject": {"reference": f"Patient/{patient_id}"},
        "identifier": [{"system": "urn:dicom:uid", "value": f"urn:oid:{study_uid}"}],
        "started": datetime.now(timezone.utc).isoformat(),
        "numberOfSeries": 1,
        "numberOfInstances": 1,
        "description": f"Synthetic MRI {accession}",
        "modality": [{"system": "http://dicom.nema.org/resources/ontology/DCM", "code": "MR"}],
    }
    headers = {"Authorization": f"Bearer {FHIR_TOKEN}", "Content-Type": "application/fhir+json"}
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(f"{FHIR_URL}/ImagingStudy", json=bundle, headers=headers)
            logger.info("FHIR ImagingStudy status=%s", r.status_code)
    except Exception as exc:
        logger.warning("FHIR ImagingStudy failed: %s", exc)


def run_scan(patient_id: str = "patient-001", accession: str | None = None, study_prefix: str = "") -> dict[str, Any]:
    if _STATE["status"] == "PROTECTIVE_STOP":
        return {"ok": False, "error": "PROTECTIVE_STOP"}

    worklist = find_worklist(patient_id)
    chosen = None
    if accession:
        chosen = next((w for w in worklist if w["accession"] == accession), None)
    if chosen is None and worklist:
        chosen = next((w for w in worklist if w["patient_id"] == patient_id), worklist[0])
    if chosen is None:
        chosen = {
            "patient_id": patient_id,
            "patient_name": "SYNTHETIC^PATIENT^001",
            "accession": accession or f"ACC-{uuid.uuid4().hex[:8]}",
            "study_uid": generate_uid(),
            "procedure": "MRI BRAIN",
        }

    ds = make_secondary_capture(
        patient_id=chosen["patient_id"],
        patient_name=chosen["patient_name"],
        accession=chosen["accession"],
        study_uid=chosen.get("study_uid") or None,
        study_prefix=study_prefix,
    )
    ok = store_to_pacs(ds)
    if ok:
        _STATE["last_scan"] = {
            "accession": str(ds.AccessionNumber),
            "study_uid": str(ds.StudyInstanceUID),
            "patient_id": patient_id,
            "at": datetime.now(timezone.utc).isoformat(),
        }
        _STATE["studies"].append(_STATE["last_scan"])
        publish_imaging_study(patient_id, str(ds.StudyInstanceUID), str(ds.AccessionNumber))
    return {"ok": ok, "study": _STATE.get("last_scan"), "status": _STATE["status"]}


def main() -> None:
    threading.Thread(target=update_from_bms, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8090, log_level="info")


if __name__ == "__main__":
    main()

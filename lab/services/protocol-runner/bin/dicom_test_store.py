#!/usr/bin/env python3
"""C-ECHO / test C-STORE to Orthanc with TEST- accession prefix."""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage, generate_uid
from pynetdicom import AE
from pynetdicom.sop_class import SecondaryCaptureImageStorage as SC_SOP
from pynetdicom.sop_class import Verification


def make_test_ds(patient_id: str, accession: str) -> Dataset:
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
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.PatientID = patient_id
    ds.PatientName = "TEST^SYNTHETIC"
    ds.AccessionNumber = accession if accession.startswith("TEST-") else f"TEST-{accession}"
    ds.Modality = "MR"
    ds.StudyDescription = "TEST synthetic write"
    ds.StudyDate = datetime.now(timezone.utc).strftime("%Y%m%d")
    ds.StudyTime = datetime.now(timezone.utc).strftime("%H%M%S")
    ds.Rows = 8
    ds.Columns = 8
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.PixelData = bytes(range(64))
    return ds


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="10.77.40.10")
    p.add_argument("--port", type=int, default=11112)
    p.add_argument("--called-ae", default="HOSP_PACS")
    p.add_argument("--calling-ae", default="PROTOCOL")
    p.add_argument("--patient-id", default="patient-999")
    p.add_argument("--accession", default="TEST-ATTACK-001")
    p.add_argument("--echo-only", action="store_true")
    args = p.parse_args()

    ae = AE(ae_title=args.calling_ae)
    ae.add_requested_context(Verification)
    ae.add_requested_context(SC_SOP)
    assoc = ae.associate(args.host, args.port, ae_title=args.called_ae)
    if not assoc.is_established:
        print("association failed", file=sys.stderr)
        return 1

    status = assoc.send_c_echo()
    print(f"C-ECHO status={getattr(status, 'Status', None)}")
    if args.echo_only:
        assoc.release()
        return 0 if status and status.Status == 0x0000 else 1

    ds = make_test_ds(args.patient_id, args.accession)
    st = assoc.send_c_store(ds)
    print(f"C-STORE status={getattr(st, 'Status', None)} accession={ds.AccessionNumber}")
    assoc.release()
    return 0 if st and st.Status == 0x0000 else 1


if __name__ == "__main__":
    sys.exit(main())

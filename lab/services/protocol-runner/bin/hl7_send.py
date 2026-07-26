#!/usr/bin/env python3
"""Send HL7 v2 message over MLLP."""
from __future__ import annotations

import argparse
import socket
import sys
from datetime import datetime, timezone

SB, EB, CR = b"\x0b", b"\x1c", b"\x0d"


def wrap(msg: str) -> bytes:
    body = msg.replace("\n", "\r").encode("utf-8")
    if not body.endswith(CR):
        body += CR
    return SB + body + EB + CR


def send_mllp(host: str, port: int, message: str) -> str:
    data = wrap(message)
    with socket.create_connection((host, port), timeout=10) as sock:
        sock.sendall(data)
        buf = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
            if EB in buf:
                break
    return buf.decode("utf-8", errors="replace")


def sample_orm(patient_id: str, accession: str, msh10: str, name: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return "\r".join(
        [
            f"MSH|^~\\&|HIS|HOSP|RIS|HOSP|{now}||ORM^O01|{msh10}|P|2.5",
            f"PID|||{patient_id}||{name}",
            f"ORC|NW|{accession}||||||{now}",
            f"OBR|1|{accession}|{accession}|MRI^MRI BRAIN|||{now}||||||||||||||||MR",
        ]
    )


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="10.77.30.10")
    p.add_argument("--port", type=int, default=2575)
    p.add_argument("--file", help="HL7 file to send")
    p.add_argument("--patient-id", default="patient-001")
    p.add_argument("--accession", default="ACC-DEMO")
    p.add_argument("--msh10", default="MSG-DEMO-001")
    p.add_argument("--name", default="SYNTHETIC^PATIENT^001")
    args = p.parse_args()

    if args.file:
        message = open(args.file, encoding="utf-8").read()
    else:
        message = sample_orm(args.patient_id, args.accession, args.msh10, args.name)

    ack = send_mllp(args.host, args.port, message)
    print(ack)
    return 0


if __name__ == "__main__":
    sys.exit(main())

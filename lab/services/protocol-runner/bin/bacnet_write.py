#!/usr/bin/env python3
"""BACnet WriteProperty helper — real bacpypes3 (default) + BMS HTTP dual-path."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import urllib.request


def write_http(bms_url: str, value: str) -> dict:
    req = urllib.request.Request(
        f"{bms_url.rstrip('/')}/bacnet/write",
        data=json.dumps({"value": value}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def write_bacnet(
    *,
    target: str,
    device_instance: int,
    bv_instance: int,
    value: str,
    local_address: str,
    local_instance: int,
) -> dict:
    from bacpypes3.argparse import SimpleArgumentParser
    from bacpypes3.app import Application
    from bacpypes3.primitivedata import ObjectIdentifier

    # inactive=NORMAL, active=ALARM
    pv = "active" if value == "ALARM" else "inactive"

    parser = SimpleArgumentParser()
    args = parser.parse_args(
        [
            "--name",
            "HOSP-PROTOCOL-WRITER",
            "--instance",
            str(local_instance),
            "--address",
            local_address,
        ]
    )
    app = Application.from_args(args)
    try:
        objid = ObjectIdentifier(f"binary-value,{bv_instance}")
        await app.write_property(target, objid, "present-value", pv)
        # optional read-back
        read_back = await app.read_property(target, objid, "present-value")
        return {
            "ok": True,
            "via": "bacnet",
            "target": target,
            "device_instance": device_instance,
            "object": f"binary-value,{bv_instance}",
            "written": pv,
            "value": value,
            "read_back": str(read_back),
        }
    finally:
        app.close()


def main() -> int:
    p = argparse.ArgumentParser(description="Write MRI chiller cooling status")
    p.add_argument("--value", default="ALARM", choices=["NORMAL", "ALARM"])
    p.add_argument(
        "--via",
        choices=["bacnet", "bms"],
        default="bacnet",
        help="bacnet=real WriteProperty (default); bms=HTTP dual-path",
    )
    p.add_argument("--bms-url", default="http://10.77.50.10:8091")
    p.add_argument("--chiller-host", default="10.77.50.20")
    p.add_argument("--chiller-port", type=int, default=47808)
    p.add_argument("--device-id", type=int, default=42001)
    p.add_argument("--bv-instance", type=int, default=1)
    p.add_argument(
        "--local-address",
        default="10.77.50.40/24",
        help="BACnet/IP bind address for this client (protocol-runner IP)",
    )
    p.add_argument("--local-instance", type=int, default=59999)
    args = p.parse_args()

    if args.via == "bms":
        result = write_http(args.bms_url, args.value)
    else:
        target = args.chiller_host
        if args.chiller_port and args.chiller_port != 47808:
            target = f"{args.chiller_host}:{args.chiller_port}"
        try:
            result = asyncio.run(
                write_bacnet(
                    target=target,
                    device_instance=args.device_id,
                    bv_instance=args.bv_instance,
                    value=args.value,
                    local_address=args.local_address,
                    local_instance=args.local_instance,
                )
            )
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
            return 1

    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())

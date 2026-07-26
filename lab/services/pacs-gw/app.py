"""PACS/DICOMweb auth gateway: HTTP Basic + patient-scoped QIDO (V-07).

Orthanc Lua cannot see query strings, so patient scope is enforced here.
Upstream Orthanc still requires matching Basic auth.
"""
from __future__ import annotations

import base64
import logging
import os
import re
from typing import Any
from urllib.parse import parse_qs

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, Response as PlainResponse

logger = logging.getLogger("pacs-gw")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

UPSTREAM = os.getenv("UPSTREAM_PACS", "http://10.77.40.10:8042").rstrip("/")
OVERPRIV_USER = os.getenv("PACS_OVERPRIV_USER", "overprivileged")
OVERPRIV_PASS = os.getenv("DICOMWEB_TEST_TOKEN", "lab-dicomweb-token-overprivileged")
SCOPED_USER = os.getenv("PACS_SCOPED_USER", "scoped")
SCOPED_PASS = os.getenv("DICOMWEB_SCOPED_TOKEN", "lab-dicomweb-token-patient001")
SCOPED_PATIENT = os.getenv("PACS_SCOPED_PATIENT", "patient-001")
HTTP_PORT = int(os.getenv("HTTP_PORT", "8042"))

USERS: dict[str, tuple[str, str]] = {
    OVERPRIV_USER: ("overprivileged", OVERPRIV_PASS),
    SCOPED_USER: ("scoped", SCOPED_PASS),
}

app = FastAPI(title="hosp-pacs-gw", version="1.0.0")


def parse_basic(request: Request) -> tuple[str, str] | None:
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("basic "):
        return None
    try:
        raw = base64.b64decode(auth.split(" ", 1)[1]).decode("utf-8")
        user, passwd = raw.split(":", 1)
        return user, passwd
    except Exception:
        return None


def role_for(user: str, passwd: str) -> str | None:
    expected = USERS.get(user)
    if not expected:
        return None
    role, expected_pass = expected
    if passwd != expected_pass:
        return None
    return role


def has_scoped_patient(query: str) -> bool:
    q = parse_qs(query, keep_blank_values=True)
    for key, vals in q.items():
        kl = key.lower().replace("-", "")
        if kl in {"patientid", "00100020", "patientid"}:
            if any(SCOPED_PATIENT in str(v) for v in vals):
                return True
        if any(SCOPED_PATIENT in str(v) for v in vals):
            # also match values that embed patient-001
            if SCOPED_PATIENT in "".join(str(v) for v in vals):
                return True
    return SCOPED_PATIENT in (query or "")


def is_collection(path: str) -> bool:
    p = path.rstrip("/") or "/"
    return p in {
        "/studies",
        "/patients",
        "/dicom-web/studies",
        "/dicom-web/series",
        "/dicom-web/instances",
    }


def scoped_allowed(method: str, path: str, query: str) -> bool:
    p = path.lower()
    m = method.upper()

    if p == "/system" or p.startswith("/plugins"):
        return True

    if m not in {"GET", "HEAD"}:
        return False

    # Broad collections need patient-001 in query
    if is_collection(p) or re.match(r"^/dicom-web/studies/?$", p):
        return has_scoped_patient(query)

    # /studies?… without extra path segment
    if p == "/studies" or p.startswith("/studies?"):
        return has_scoped_patient(query)

    return True


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "pacs-gw", "upstream": UPSTREAM}


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def proxy(request: Request, path: str = "") -> Response:
    creds = parse_basic(request)
    if not creds:
        return PlainResponse(
            content="Unauthorized",
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="hosp-pacs"'},
        )
    user, passwd = creds
    role = role_for(user, passwd)
    if role is None:
        return PlainResponse(
            content="Unauthorized",
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="hosp-pacs"'},
        )

    full_path = "/" + path if path else "/"
    query = request.url.query or ""

    if role == "scoped" and not scoped_allowed(request.method, full_path, query):
        logger.info("scoped deny %s %s?%s", request.method, full_path, query)
        return PlainResponse(status_code=403, content="")

    target = f"{UPSTREAM}{full_path}"
    if query:
        target = f"{target}?{query}"

    body = await request.body()
    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in {"host", "content-length", "connection"}
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            upstream = await client.request(
                request.method, target, content=body, headers=headers
            )
    except httpx.RequestError as exc:
        logger.error("upstream error: %s", exc)
        return JSONResponse({"error": str(exc)}, status_code=502)

    resp_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower()
        not in {"content-encoding", "transfer-encoding", "content-length", "connection"}
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=resp_headers,
        media_type=upstream.headers.get("content-type"),
    )


def main() -> None:
    logger.info("pacs-gw listening :%s -> %s", HTTP_PORT, UPSTREAM)
    uvicorn.run(app, host="0.0.0.0", port=HTTP_PORT, log_level="info")


if __name__ == "__main__":
    main()

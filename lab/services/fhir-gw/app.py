"""FHIR auth gateway: real Bearer tokens with overprivileged vs patient-scoped access (V-08)."""
from __future__ import annotations

import logging
import os
import re
from typing import Any
from urllib.parse import urlparse

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

logger = logging.getLogger("fhir-gw")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

UPSTREAM = os.getenv("UPSTREAM_FHIR", "http://10.77.20.20:8080/fhir").rstrip("/")
OVERPRIV_TOKEN = os.getenv("FHIR_TEST_TOKEN", "lab-fhir-token-overprivileged")
SCOPED_TOKEN = os.getenv("FHIR_SCOPED_TOKEN", "lab-fhir-token-patient001")
SCOPED_PATIENT = os.getenv("FHIR_SCOPED_PATIENT", "patient-001")
HTTP_PORT = int(os.getenv("HTTP_PORT", "8080"))

app = FastAPI(title="hosp-fhir-gw", version="1.0.0")


def extract_bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth:
        return None
    parts = auth.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None


def token_role(token: str | None) -> str | None:
    if not token:
        return None
    if token == OVERPRIV_TOKEN:
        return "overprivileged"
    if token == SCOPED_TOKEN:
        return "scoped"
    return None


def scoped_allowed(method: str, path: str, query: str) -> bool:
    """Narrow token: only Patient/patient-001 and related ImagingStudy reads."""
    full = path + ("?" + query if query else "")
    # metadata / capability always ok (discovery)
    if path.rstrip("/").endswith("/metadata") or path.endswith("/metadata"):
        return True
    if method.upper() in {"GET", "HEAD"}:
        if re.search(rf"/Patient/{re.escape(SCOPED_PATIENT)}(/|$|\?)", full):
            return True
        if "/Patient" in path and f"Patient/{SCOPED_PATIENT}" not in path:
            # search must constrain to scoped patient
            if f"_id={SCOPED_PATIENT}" in query or f"identifier={SCOPED_PATIENT}" in query:
                return True
            return False
        if "/ImagingStudy" in path:
            if SCOPED_PATIENT in full or f"Patient/{SCOPED_PATIENT}" in full:
                return True
            # allow read by id only if we cannot know — deny broad search
            if path.rstrip("/").endswith("/ImagingStudy") or path.endswith("/ImagingStudy"):
                return False
            return True
        return False
    # writes denied for scoped token
    return False


def filter_bundle_for_scoped(data: Any) -> Any:
    if not isinstance(data, dict) or data.get("resourceType") != "Bundle":
        return data
    entries = []
    for entry in data.get("entry", []):
        res = entry.get("resource") or {}
        rtype = res.get("resourceType")
        rid = res.get("id")
        if rtype == "Patient" and rid == SCOPED_PATIENT:
            entries.append(entry)
        elif rtype == "ImagingStudy":
            subj = (res.get("subject") or {}).get("reference", "")
            if SCOPED_PATIENT in subj:
                entries.append(entry)
        else:
            # drop other resources for scoped responses
            pass
    data = dict(data)
    data["entry"] = entries
    data["total"] = len(entries)
    return data


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "fhir-gw", "upstream": UPSTREAM}


@app.api_route("/fhir", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"])
@app.api_route("/fhir/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"])
async def proxy(request: Request, path: str = "") -> Response:
    role = token_role(extract_bearer(request))
    if role is None:
        return JSONResponse(
            {"resourceType": "OperationOutcome", "issue": [{"severity": "error", "diagnostics": "Bearer token required"}]},
            status_code=401,
            headers={"WWW-Authenticate": 'Bearer realm="hosp-fhir"'},
        )

    upstream_path = path
    target = f"{UPSTREAM}/{upstream_path}" if upstream_path else UPSTREAM
    if request.url.query:
        target = f"{target}?{request.url.query}"

    # Normalize path for ACL (strip /fhir prefix handling)
    acl_path = "/fhir/" + upstream_path if upstream_path else "/fhir"
    if role == "scoped" and not scoped_allowed(request.method, acl_path, request.url.query or ""):
        logger.info("scoped deny %s %s", request.method, acl_path)
        return JSONResponse(
            {
                "resourceType": "OperationOutcome",
                "issue": [
                    {
                        "severity": "error",
                        "code": "forbidden",
                        "diagnostics": f"scoped token limited to Patient/{SCOPED_PATIENT}",
                    }
                ],
            },
            status_code=403,
        )

    body = await request.body()
    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in {"host", "content-length", "authorization", "connection"}
    }
    # Upstream HAPI has no auth; gateway is the enforcement point
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            upstream = await client.request(request.method, target, content=body, headers=headers)
    except httpx.RequestError as exc:
        logger.error("upstream error: %s", exc)
        return JSONResponse(
            {"resourceType": "OperationOutcome", "issue": [{"severity": "error", "diagnostics": str(exc)}]},
            status_code=502,
        )

    resp_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in {"content-encoding", "transfer-encoding", "content-length", "connection"}
    }
    content = upstream.content
    ctype = upstream.headers.get("content-type", "")
    if role == "scoped" and "json" in ctype and upstream.status_code < 400:
        try:
            data = upstream.json()
            data = filter_bundle_for_scoped(data)
            return JSONResponse(data, status_code=upstream.status_code, headers=resp_headers)
        except Exception:
            pass
    return Response(content=content, status_code=upstream.status_code, headers=resp_headers, media_type=ctype or None)


def main() -> None:
    # warm log
    parsed = urlparse(UPSTREAM)
    logger.info("fhir-gw listening :%s -> %s (host=%s)", HTTP_PORT, UPSTREAM, parsed.hostname)
    uvicorn.run(app, host="0.0.0.0", port=HTTP_PORT, log_level="info")


if __name__ == "__main__":
    main()

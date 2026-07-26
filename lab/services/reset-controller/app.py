"""Reset controller: restore seed state across hospital services."""
from __future__ import annotations

import logging
import os
import sys
from typing import Any

import uvicorn
from fastapi import FastAPI

from seed_lib import run_reset

logger = logging.getLogger("reset-controller")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

SEED_VERSION = os.getenv("SEED_VERSION", "2026.07.25-mvp")

app = FastAPI(title="hosp-reset-controller", version="1.0.0")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "reset-controller", "seed_version": SEED_VERSION}


@app.post("/reset")
def reset() -> dict[str, Any]:
    result = run_reset()
    return result


@app.get("/seed-version")
def seed_version() -> dict[str, str]:
    return {"seed_version": SEED_VERSION}


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "reset":
        result = run_reset()
        print(result)
        sys.exit(0 if result.get("ok") else 1)
    uvicorn.run(app, host="0.0.0.0", port=8099, log_level="info")


if __name__ == "__main__":
    main()

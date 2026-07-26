#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
LAB_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

if [ ! -f "${LAB_DIR}/.env" ]; then
  cp "${LAB_DIR}/.env.example" "${LAB_DIR}/.env"
  echo "[init] Created lab/.env from .env.example"
fi

echo "[init] Lab environment is ready. Docker creates the runtime SSH key volume."

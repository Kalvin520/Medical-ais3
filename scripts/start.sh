#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

offline=false
if [ "${1:-}" = "--offline" ]; then
  offline=true
elif [ "$#" -gt 0 ]; then
  echo "Usage: $0 [--offline]" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or is not in PATH." >&2
  exit 1
fi

if ! compose_version=$(docker compose version --short 2>/dev/null); then
  echo "Docker Compose v2.20 or newer is required." >&2
  exit 1
fi

compose_version=${compose_version#v}
compose_major=${compose_version%%.*}
compose_rest=${compose_version#*.}
compose_minor=${compose_rest%%.*}
if [ "$compose_major" -lt 2 ] || { [ "$compose_major" -eq 2 ] && [ "$compose_minor" -lt 20 ]; }; then
  echo "Docker Compose v2.20 or newer is required (found v$compose_version)." >&2
  exit 1
fi

daemon_os=$(docker info --format '{{.OSType}}' 2>/dev/null || true)
if [ "$daemon_os" != "linux" ]; then
  echo "Docker is not running with the Linux container engine." >&2
  echo "Start Docker Desktop/Engine; on Windows, switch to Linux containers." >&2
  exit 1
fi

if [ "$offline" = true ]; then
  echo "Starting with locally loaded images (offline mode)..."
else
  echo "Pulling prebuilt images for this machine..."
  docker compose pull
fi

docker compose up -d --no-build --pull never
docker compose ps

echo
echo "Medical AIS3 is starting at http://127.0.0.1:8100"

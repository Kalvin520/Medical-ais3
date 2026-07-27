#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

archive=${1:-}
if [ -z "$archive" ]; then
  echo "Usage: $0 PATH_TO_IMAGE_TAR" >&2
  exit 2
fi
if [ ! -f "$archive" ]; then
  echo "Image archive not found: $archive" >&2
  exit 1
fi

checksum_file="$archive.sha256"
if [ -f "$checksum_file" ]; then
  expected=$(awk 'NR == 1 { print $1 }' "$checksum_file")
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$archive" | awk '{ print $1 }')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$archive" | awk '{ print $1 }')
  else
    echo "No SHA-256 tool is available; cannot verify $checksum_file." >&2
    exit 1
  fi
  if [ "$actual" != "$expected" ]; then
    echo "SHA-256 verification failed for $archive." >&2
    exit 1
  fi
  echo "SHA-256 verification passed."
fi

docker load --input "$archive"
"$project_dir/scripts/start.sh" --offline

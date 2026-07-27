#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

machine_arch=$(uname -m)
case "$machine_arch" in
  x86_64|amd64)
    arch=amd64
    ;;
  arm64|aarch64)
    arch=arm64
    ;;
  *)
    echo "Unsupported architecture: $machine_arch" >&2
    exit 1
    ;;
esac

platform=${PLATFORM:-linux/$arch}
images=$(docker compose config --images | sort -u)
if [ -z "$images" ]; then
  echo "No runtime images were found in docker-compose.yml." >&2
  exit 1
fi

if [ "${SKIP_PULL:-false}" = "true" ]; then
  local_arch=
  for image in $images; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      echo "Required local image is missing: $image" >&2
      exit 1
    fi
    image_arch=$(docker image inspect --format '{{.Architecture}}' "$image")
    if [ -z "$local_arch" ]; then
      local_arch=$image_arch
    elif [ "$local_arch" != "$image_arch" ]; then
      echo "Local images contain mixed architectures: $local_arch and $image_arch." >&2
      exit 1
    fi
  done
  arch=$local_arch
  platform=linux/$arch
  echo "Using locally available images for $platform..."
else
  echo "Pulling runtime images for $platform..."
  for image in $images; do
    docker pull --platform "$platform" "$image"
  done
fi

output=${1:-"$project_dir/dist/medical-ais3-images-$arch.tar"}
output_dir=$(dirname -- "$output")
mkdir -p "$output_dir"

echo "Writing $output..."
# Image references do not contain whitespace; intentional word splitting passes
# each compose image as a separate argument to docker save.
# shellcheck disable=SC2086
docker save --output "$output" $images

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$output_dir" && sha256sum "$(basename -- "$output")") > "$output.sha256"
elif command -v shasum >/dev/null 2>&1; then
  (cd "$output_dir" && shasum -a 256 "$(basename -- "$output")") > "$output.sha256"
fi

echo "Offline image bundle created: $output"

#!/bin/sh
set -eu
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH='' cd -- "$source_dir/../../../../.." && pwd)
context=$(mktemp -d)
trap 'rm -rf -- "$context"' EXIT
"$repo/node_modules/.bin/esbuild" "$source_dir/../document-scanner-node.ts" \
  --bundle --platform=node --target=node24 --format=cjs --outfile="$context/scanner.cjs"
cp "$source_dir/Dockerfile" "$source_dir/clamd.conf" "$source_dir/freshclam.conf" "$context/"
install -m 0755 "$source_dir/entrypoint.sh" "$context/entrypoint.sh"
docker build --tag "${SCANNER_IMAGE:-flowboard-document-scanner:local}" "$context"

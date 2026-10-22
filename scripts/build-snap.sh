#!/usr/bin/env bash
# Builds the snap: web client -> electron-builder `dir` output -> snapcraft pack.
# Requires: snapcraft (classic) and LXD (`sudo snap install lxd && sudo lxd init --auto`).
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build
npx electron-builder build --linux dir --publish never

case "$(uname -m)" in
  aarch64|arm64) UNPACKED=dist/linux-arm64-unpacked ;;
  *) UNPACKED=dist/linux-unpacked ;;
esac

rm -rf dist/snap-app
cp -a "$UNPACKED" dist/snap-app
cp build/icon.png dist/snap-app/plumterm-icon.png
node -p "require('./package.json').version" > dist/snap-app/version.txt

if [ "${1:-}" = "--prepare-only" ]; then
  echo "Prepared dist/snap-app (skipping snapcraft pack)"
  exit 0
fi

snapcraft pack --output dist/
ls -la dist/*.snap

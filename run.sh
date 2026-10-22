#!/bin/bash

# Run PlumTerm locally for testing — no packaging, no install to /Applications.
#
#   ./run.sh          Build the client once, then launch the Electron app.
#   ./run.sh --dev     Hot-reload mode: Vite dev server + Electron (Ctrl+C to stop).
#   ./run.sh --clean   Wipe node_modules / build output and reinstall first.

set -e

cd "$(dirname "$0")"

DEV=false
CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --dev)   DEV=true ;;
    --clean) CLEAN=true ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [ "$CLEAN" = true ]; then
  echo "🧹 Cleaning node_modules and build output..."
  rm -rf node_modules client/dist
fi

if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# macOS ships the stock Electron binary unsigned. Gatekeeper has revoked trust
# for that generic identity (malware reuses it), so it silently kills — or even
# trashes — Electron.app on launch. Re-extract if it's gone and ad-hoc re-sign
# it with a local identity so it runs.
ELECTRON_APP="node_modules/electron/dist/Electron.app"
if [ "$(uname)" = "Darwin" ]; then
  if [ ! -d "$ELECTRON_APP" ]; then
    echo "📥 Restoring Electron binary..."
    node node_modules/electron/install.js
  fi
  if ! codesign --verify --deep "$ELECTRON_APP" >/dev/null 2>&1; then
    echo "🔏 Ad-hoc signing Electron..."
    xattr -cr "$ELECTRON_APP"
    codesign --force --deep --sign - "$ELECTRON_APP"
  fi
fi

if [ "$DEV" = true ]; then
  echo "🚀 Starting dev mode (Vite + Electron, hot reload)..."
  exec npm run dev
fi

echo "🛠️  Building client..."
npm run build

echo "🚀 Launching PlumTerm..."
exec ./node_modules/.bin/electron .

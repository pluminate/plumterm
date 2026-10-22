#!/usr/bin/env bash
# Runs the app directly in dev mode (Vite + Electron), without packaging/installing it.
# Works on macOS, Linux, and Windows (run from Git Bash / MSYS / Cygwin / WSL).
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

case "$(uname -s)" in
    Darwin)               OS=mac ;;
    Linux)                OS=linux ;;
    MINGW*|MSYS*|CYGWIN*) OS=windows ;;
    *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
echo "Detected OS: $OS"

ELECTRON_DIR="node_modules/electron/dist"
case "$OS" in
    mac)     ELECTRON_BIN="$ELECTRON_DIR/Electron.app/Contents/MacOS/Electron" ;;
    linux)   ELECTRON_BIN="$ELECTRON_DIR/electron" ;;
    windows) ELECTRON_BIN="$ELECTRON_DIR/electron.exe" ;;
esac

# Kill any dev instance of this project already running, so a stale
# Electron window or a Vite server holding port 5173 doesn't collide with
# the one we're about to start. Scoped to this project's path so it never
# touches unrelated Electron apps on the machine.
echo "Checking for existing dev instances..."

VITE_PIDS=""
ELECTRON_PIDS=""
case "$OS" in
    mac|linux)
        if command -v lsof >/dev/null 2>&1; then
            VITE_PIDS=$(lsof -ti:5173 2>/dev/null || true)
        fi
        if command -v pgrep >/dev/null 2>&1; then
            ELECTRON_PIDS=$(pgrep -f "$PROJECT_ROOT/$ELECTRON_DIR/" 2>/dev/null || true)
        fi
        if [ -n "$VITE_PIDS" ]; then
            echo "Stopping existing Vite dev server on port 5173 (pid: $VITE_PIDS)"
            kill $VITE_PIDS 2>/dev/null || true
        fi
        if [ -n "$ELECTRON_PIDS" ]; then
            echo "Stopping existing Electron instance(s) (pid: $ELECTRON_PIDS)"
            kill $ELECTRON_PIDS 2>/dev/null || true
        fi
        ;;
    windows)
        # Free port 5173 if something is listening on it.
        VITE_PIDS=$(netstat -ano 2>/dev/null | tr -d '\r' | awk '$2 ~ /:5173$/ && $4 == "LISTENING" {print $5}' | sort -u || true)
        for pid in $VITE_PIDS; do
            echo "Stopping existing Vite dev server on port 5173 (pid: $pid)"
            taskkill //PID "$pid" //F >/dev/null 2>&1 || true
        done
        ;;
esac
if [ -n "$VITE_PIDS$ELECTRON_PIDS" ]; then
    sleep 1
fi

# --- Self-healing setup -------------------------------------------------
# Every step below only does work when something is actually broken.

# Remove corrupt Electron downloads from the cache (a truncated zip makes
# both `npm install` and electron-builder fail with "not a valid zip file").
purge_bad_electron_zips() {
    command -v unzip >/dev/null 2>&1 || return 0
    local cache="${ELECTRON_CACHE:-}"
    if [ -z "$cache" ]; then
        case "$OS" in
            mac)     cache="$HOME/Library/Caches/electron" ;;
            windows) cache="${LOCALAPPDATA:-$HOME/AppData/Local}/electron/Cache" ;;
            *)       cache="${XDG_CACHE_HOME:-$HOME/.cache}/electron" ;;
        esac
    fi
    [ -d "$cache" ] || return 0
    local zip
    while IFS= read -r zip; do
        if ! unzip -tqq "$zip" >/dev/null 2>&1; then
            echo "Removing corrupt cached download: $zip"
            rm -f "$zip"
        fi
    done < <(find "$cache" -name 'electron-v*.zip' 2>/dev/null)
}

# Install dependencies on first run (also rebuilds node-pty via postinstall)
if [ ! -d node_modules ] || [ ! -d node_modules/electron ]; then
    echo "Installing dependencies..."
    purge_bad_electron_zips
    npm install
fi

if [ ! -d client/node_modules ] && [ -f client/package.json ]; then
    echo "Installing client dependencies..."
    (cd client && npm install)
fi

# Ensure electron binary exists; retry once with a clean cache if the download fails
if [ ! -f "$ELECTRON_BIN" ]; then
    echo "Installing Electron binary..."
    purge_bad_electron_zips
    if ! node node_modules/electron/install.js; then
        echo "Electron download failed; clearing cache and retrying..."
        rm -rf "${ELECTRON_CACHE:-$HOME/.cache/electron}"/electron-v*.zip
        node node_modules/electron/install.js
    fi
fi

# macOS: Gatekeeper/XProtect can kill ("Killed: 9") and even delete a freshly
# downloaded Electron.app, so make sure it exists and is ad-hoc signed *before*
# anything executes it (including the node-pty probe below).
ensure_electron_mac() {
    if [ ! -f "$ELECTRON_BIN" ]; then
        echo "Electron.app is missing (removed by macOS?); reinstalling..."
        purge_bad_electron_zips
        rm -rf "$ELECTRON_DIR"
        node node_modules/electron/install.js
    fi
    # macOS blocks freshly-downloaded Electron builds ("contains malware") since
    # their notarization can be revoked after the fact. Ad-hoc re-sign it locally
    # (one-time, only re-runs if the signature is missing/invalid) so Gatekeeper
    # trusts the binary without needing network notarization checks.
    if ! codesign --verify "$ELECTRON_DIR/Electron.app" 2>/dev/null; then
        echo "Re-signing Electron binary (one-time setup)..."
        xattr -rd com.apple.quarantine "$ELECTRON_DIR/Electron.app" 2>/dev/null || true
        codesign --deep --force --sign - "$ELECTRON_DIR/Electron.app"
    fi
}

if [ "$OS" = mac ]; then ensure_electron_mac; fi

# Ensure node-pty's native module matches Electron's ABI (rebuild if it won't load)
if ! ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" -e "require('node-pty')" >/dev/null 2>&1; then
    echo "node-pty doesn't load under Electron; rebuilding..."
    npx electron-rebuild -f -w node-pty
    if [ "$OS" = mac ]; then ensure_electron_mac; fi
fi

case "$OS" in
    linux)
        # Electron needs a root-owned setuid chrome-sandbox; without it the app
        # aborts at launch. Fall back to running unsandboxed for local dev.
        SANDBOX="$ELECTRON_DIR/chrome-sandbox"
        if [ ! -u "$SANDBOX" ] || [ "$(stat -c %u "$SANDBOX" 2>/dev/null)" != "0" ]; then
            echo "chrome-sandbox is not set up (needs root + mode 4755); running with sandbox disabled."
            export ELECTRON_DISABLE_SANDBOX=1
        fi
        ;;
esac

echo "Starting Terminal (Development Mode)..."
echo ""

if [ "$OS" = windows ]; then
    # `npm run dev:electron` uses POSIX `VAR=value cmd` syntax, which cmd.exe can't run.
    export VITE_DEV=true
    exec npx concurrently "npm run dev:client" "npm run dev:server" "electron ."
else
    exec npm run dev
fi

#!/usr/bin/env bash
# Builds PlumTerm and installs it locally for the current OS:
#   macOS  -> /Applications/PlumTerm.app
#   Linux  -> /opt/PlumTerm + app-menu entry (.desktop) + `plumterm` command
set -euo pipefail

APP_NAME="PlumTerm"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

case "$(uname -s)" in
    Darwin) OS=mac ;;
    Linux)  OS=linux ;;
    *) echo "❌ Unsupported OS: $(uname -s). On Windows use 'npm run dist' style packaging." >&2; exit 1 ;;
esac
echo "🖥️  Detected OS: $OS"

ARCH_RAW=$(uname -m)
case "$ARCH_RAW" in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64|amd64)  ARCH=x64 ;;
    *) echo "❌ Unsupported architecture: $ARCH_RAW" >&2; exit 1 ;;
esac

# 1. Dependencies
if [ "$OS" = mac ]; then
    # Self-healing: start from a clean slate on macOS.
    echo "🧹 Cleaning previous build artifacts and node_modules..."
    rm -rf node_modules client/dist dist
else
    rm -rf client/dist dist
fi

echo "📦 Installing dependencies..."
npm install

# 2. Build the client
echo "🚀 Building PlumTerm..."
npm run build

# Disable code signing to avoid local keychain issues
export CSC_IDENTITY_AUTO_DISCOVERY=false

# ---------------------------------------------------------------- macOS
install_mac() {
    local dest_dir=/Applications app="$APP_NAME.app" dist_dir
    if [ "$ARCH" = arm64 ]; then dist_dir=dist/mac-arm64; else dist_dir=dist/mac; fi

    echo "🏗️  Running electron-builder for $ARCH..."
    ./node_modules/.bin/electron-builder build --mac "--$ARCH"

    echo "📦 Moving to $dest_dir... (you may be asked for your Mac password)"
    if [ -d "$dest_dir/$app" ]; then
        echo "⚠️  Existing version found. Replacing..."
        sudo rm -rf "${dest_dir:?}/$app"
    fi
    if [ ! -d "$PROJECT_ROOT/$dist_dir/$app" ]; then
        echo "❌ Error: Could not find $app in $dist_dir"
        exit 1
    fi
    sudo cp -R "$PROJECT_ROOT/$dist_dir/$app" "$dest_dir/"

    echo "🛡️  Setting as trusted application..."
    sudo chmod -R 755 "$dest_dir/$app"

    # Re-sign with a unique ad-hoc identity. Electron ships an unsigned template
    # binary; without this, the packaged app keeps that generic identity/hash,
    # which Apple has revoked trust for (shared with malware that reuses the
    # stock Electron binary), so Gatekeeper reports it as malware.
    echo "🛡️  Clearing extended attributes..."
    sudo xattr -cr "$dest_dir/$app"

    echo "🔏 Re-signing with a unique local identity..."
    local bundle_id
    bundle_id=$(node -p "require('$PROJECT_ROOT/package.json').build?.appId || require('$PROJECT_ROOT/package.json').name || ''")
    sudo codesign --force --deep --sign - --identifier "${bundle_id:-com.terminal.app}" "$dest_dir/$app"

    echo "🚀 Opening $APP_NAME to register services..."
    open "$dest_dir/$app"

    echo ""
    echo "✅ $APP_NAME installed successfully in $dest_dir!"
    echo "✨ You can now right-click folders in Finder to 'Open in $APP_NAME'."
}

# ---------------------------------------------------------------- Linux
install_linux() {
    local install_dir="/opt/$APP_NAME"
    local bin_link=/usr/local/bin/plumterm
    local desktop_file=/usr/share/applications/plumterm.desktop
    local icon_dir=/usr/share/icons/hicolor/512x512/apps
    local dist_dir
    if [ "$ARCH" = arm64 ]; then dist_dir=dist/linux-arm64-unpacked; else dist_dir=dist/linux-unpacked; fi

    echo "🏗️  Running electron-builder for $ARCH..."
    ./node_modules/.bin/electron-builder build --linux dir "--$ARCH"

    if [ ! -x "$PROJECT_ROOT/$dist_dir/plumterm" ]; then
        echo "❌ Error: Could not find the built app in $dist_dir"
        exit 1
    fi

    local SUDO=""
    if [ "$(id -u)" -ne 0 ]; then
        command -v sudo >/dev/null 2>&1 || { echo "❌ sudo is required to install into $install_dir" >&2; exit 1; }
        SUDO=sudo
        echo "📦 Installing to $install_dir... (you may be asked for your password)"
    fi

    $SUDO rm -rf "$install_dir"
    $SUDO mkdir -p "$install_dir"
    $SUDO cp -a "$PROJECT_ROOT/$dist_dir/." "$install_dir/"

    # Chromium's SUID sandbox helper must be root-owned with mode 4755.
    if [ -f "$install_dir/chrome-sandbox" ]; then
        $SUDO chown root:root "$install_dir/chrome-sandbox"
        $SUDO chmod 4755 "$install_dir/chrome-sandbox"
    fi

    $SUDO ln -sf "$install_dir/plumterm" "$bin_link"

    $SUDO mkdir -p "$icon_dir"
    $SUDO install -m 644 "$PROJECT_ROOT/build/icon.png" "$icon_dir/plumterm.png"

    # Application-menu entry, plus a "Open in PlumTerm" action for file managers
    # that honour desktop actions.
    $SUDO tee "$desktop_file" >/dev/null <<DESKTOP
[Desktop Entry]
Type=Application
Name=$APP_NAME
GenericName=Terminal Emulator
Comment=A modern terminal with split panes and AI helpers
Exec=$install_dir/plumterm %U
Icon=plumterm
Terminal=false
Categories=Development;System;TerminalEmulator;
StartupWMClass=terminal
Keywords=terminal;shell;console;command;
DESKTOP
    $SUDO chmod 644 "$desktop_file"

    command -v update-desktop-database >/dev/null 2>&1 && $SUDO update-desktop-database /usr/share/applications || true
    command -v gtk-update-icon-cache >/dev/null 2>&1 && $SUDO gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true

    echo ""
    echo "✅ $APP_NAME installed to $install_dir!"
    echo "✨ Find it in your application menu, or run: plumterm"

    echo "🚀 Launching $APP_NAME..."
    nohup "$bin_link" >/dev/null 2>&1 &
    disown || true
}

case "$OS" in
    mac)   install_mac ;;
    linux) install_linux ;;
esac

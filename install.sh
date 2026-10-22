#!/bin/bash

# Exit on error
set -e

APP_NAME="PlumTerm.app"
DEST_DIR="/Applications"
SOURCE_DIR="$(dirname "$0")"

echo "🚀 Installing $APP_NAME..."

# 1. Check if the app exists in the same folder as the script
if [ ! -d "$SOURCE_DIR/$APP_NAME" ]; then
    echo "❌ Error: Could not find $APP_NAME in $SOURCE_DIR"
    echo "Please make sure the script is in the same folder as the app."
    exit 1
fi

# 2. Move the app to /Applications (ask for password if needed)
echo "📦 Moving to $DEST_DIR... (you may be asked for your Mac password)"
if [ -d "$DEST_DIR/$APP_NAME" ]; then
    echo "⚠️  Existing version found. Replacing..."
    sudo rm -rf "$DEST_DIR/$APP_NAME"
fi
sudo cp -R "$SOURCE_DIR/$APP_NAME" "$DEST_DIR/"

# 3. Fix the "Damaged" app error (remove quarantine)
echo "🛡️  Setting as trusted application..."
sudo xattr -cr "$DEST_DIR/$APP_NAME"

# 4. Success!
echo ""
echo "✅ $APP_NAME installed successfully!"
echo "🚀 You can now find it in your Applications folder or Launchpad."
echo "Opening PlumTerm..."
open "$DEST_DIR/$APP_NAME"

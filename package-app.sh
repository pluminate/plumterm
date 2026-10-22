#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting packaging process for PlumTerm..."

# Navigate to project root (assuming script is run from there)
# If script is in a bin folder, adjust accordingly
PROJECT_ROOT=$(pwd)

echo "📦 Installing/Updating dependencies..."
pnpm install

echo "🛠️ Building client..."
npm run build

echo "🏗️ Building macOS apps (Intel + Apple Silicon)..."
# Disable code signing to avoid local keychain issues
export CSC_IDENTITY_AUTO_DISCOVERY=false
./node_modules/.bin/electron-builder build --mac --arm64 --x64

echo ""
echo "✅ Packaging Complete!"
echo "--------------------------------------------------"
echo "Your shareable files are in the 'dist' directory:"
echo ""
echo "📱 For Apple Silicon (M1/M2/M3):"
echo "   - dist/PlumTerm-1.0.0-arm64.dmg"
echo ""
echo "💻 For Intel Macs:"
echo "   - dist/PlumTerm-1.0.0.dmg"
echo ""
echo "📂 App Bundle (Universal/Ready to use):"
echo "   - dist/mac-arm64/PlumTerm.app"
echo "--------------------------------------------------"
echo "Note: If sharing with others, they may need to right-click -> Open"
echo "to bypass the 'unidentified developer' warning."

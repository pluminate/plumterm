#!/bin/bash

# Exit on error
set -e

# Check if argument is provided
if [ -z "$1" ]; then
  echo "Usage: ./release.sh <patch|minor|major|version> [\"release notes\"]"
  echo "Example: ./release.sh patch \"Fixed tab switching and added rerun shortcut\""
  exit 1
fi

TYPE_OR_VERSION=$1
NOTES=${2:-"Minor improvements and bug fixes"}

# 1. Update version in package.json and capture the result
# npm version handles both keywords (patch, minor, major) and specific versions
echo "🔢 Incrementing version ($TYPE_OR_VERSION)..."
NEW_VERSION_V=$(npm version $TYPE_OR_VERSION --no-git-tag-version)
# Strip the 'v' prefix for the variables
VERSION=${NEW_VERSION_V#v}
TAG="v$VERSION"
DATE=$(date +%Y-%m-%d)

echo "🚀 Preparing release $TAG..."

# 2. Update Changelog
echo "📝 Updating CHANGELOG.md..."
# Create a temporary file to build the new changelog
echo "## [$VERSION] - $DATE" > CHANGELOG.tmp
echo "$NOTES" >> CHANGELOG.tmp
echo "" >> CHANGELOG.tmp
# Append the old changelog (skipping the header lines if they exist)
if [ -f CHANGELOG.md ]; then
  sed -n '/---/,$p' CHANGELOG.md >> CHANGELOG.tmp
fi

# Replace old changelog with new one (keeping the top header)
cat <<EOF > CHANGELOG.md
# Changelog

All notable changes to this project will be documented in this file.

---

$(cat CHANGELOG.tmp)
EOF
rm CHANGELOG.tmp

# 3. Commit the changes
echo "💾 Committing version bump and changelog..."
git add package.json CHANGELOG.md
git commit -m "chore: release $TAG"

# 4. Create the git tag
git tag -a $TAG -m "Release $TAG"

# 5. Push to GitHub
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "📤 Pushing to $BRANCH and triggering GitHub Action..."
git push origin $BRANCH
git push origin $TAG

echo ""
echo "✅ Done! GitHub Actions will now build and upload your DMG and ZIP."
echo "Check progress at: https://github.com/$(git remote get-url origin | sed -E 's/.*github.com[:\/](.*)\.git/\1/')/actions"

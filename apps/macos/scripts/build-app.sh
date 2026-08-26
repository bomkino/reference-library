#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Reference Library macOS packaging requires Apple Silicon macOS." >&2
  exit 2
fi

npm run build -w @pitchdog/reference-workspace
cargo build --release --locked --target aarch64-apple-darwin -p reference-core
swift build --package-path apps/macos -c release --arch arm64
swift_bin="$(swift build --package-path apps/macos -c release --arch arm64 --show-bin-path)"

release_root="$repo_root/release/macos"
app="$release_root/Reference Library.app"
if [[ -d "$release_root" ]]; then
  archived="$release_root.previous.$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$release_root" "$archived"
fi
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/bin" "$app/Contents/Resources/Workspace"

install -m 755 "$swift_bin/ReferenceLibraryMac" "$app/Contents/MacOS/ReferenceLibraryMac"
install -m 755 "$repo_root/target/aarch64-apple-darwin/release/reference-core" \
  "$app/Contents/Resources/bin/reference-core"
install -m 644 "$repo_root/apps/macos/Info.plist" "$app/Contents/Info.plist"
cp -R "$repo_root/packages/workspace/dist/." "$app/Contents/Resources/Workspace/"

codesign --force --options runtime --timestamp=none --sign - \
  "$app/Contents/Resources/bin/reference-core"
codesign --force --deep --options runtime --timestamp=none --sign - "$app"
codesign --verify --deep --strict --verbose=2 "$app"

zip_path="$release_root/reference-library-0.1.0-macos-arm64.app.zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip_path"
shasum -a 256 "$zip_path" > "$zip_path.sha256"
echo "$zip_path"

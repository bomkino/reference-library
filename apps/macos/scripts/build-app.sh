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
version="$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync("release-metadata.json","utf8")).version)')"
app="$release_root/Reference Library.app"
if [[ -d "$release_root" ]]; then
  archived="$release_root.previous.$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$release_root" "$archived"
fi
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/bin" \
  "$app/Contents/Resources/Workspace" "$app/Contents/Resources/Legal"

install -m 755 "$swift_bin/ReferenceLibraryMac" "$app/Contents/MacOS/ReferenceLibraryMac"
install -m 755 "$repo_root/target/aarch64-apple-darwin/release/reference-core" \
  "$app/Contents/Resources/bin/reference-core"
install -m 644 "$repo_root/apps/macos/Info.plist" "$app/Contents/Info.plist"
cp -R "$repo_root/packages/workspace/dist/." "$app/Contents/Resources/Workspace/"
for legal_file in DEPENDENCY-LICENSES.json THIRD_PARTY-NOTICES.txt LICENSE NOTICE; do
  install -m 644 "$repo_root/$legal_file" "$app/Contents/Resources/Legal/$legal_file"
done

icon_source="$repo_root/assets/branding/reference-library-icon-1024.png"
iconset="$release_root/ReferenceLibrary.iconset"
mkdir -p "$iconset"
while read -r points pixels filename; do
  sips -z "$pixels" "$pixels" "$icon_source" --out "$iconset/$filename" >/dev/null
done <<'ICON_SIZES'
16 16 icon_16x16.png
16 32 icon_16x16@2x.png
32 32 icon_32x32.png
32 64 icon_32x32@2x.png
128 128 icon_128x128.png
128 256 icon_128x128@2x.png
256 256 icon_256x256.png
256 512 icon_256x256@2x.png
512 512 icon_512x512.png
512 1024 icon_512x512@2x.png
ICON_SIZES
iconutil -c icns "$iconset" -o "$app/Contents/Resources/ReferenceLibrary.icns"
rm -r "$iconset"

codesign --force --options runtime --timestamp=none --sign - \
  --entitlements "$repo_root/apps/macos/ReferenceCore.entitlements" \
  "$app/Contents/Resources/bin/reference-core"
codesign --force --options runtime --timestamp=none --sign - \
  --entitlements "$repo_root/apps/macos/ReferenceLibrary.entitlements" "$app"
codesign --verify --deep --strict --verbose=2 "$app"

zip_path="$release_root/reference-library-$version-macos-arm64.app.zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip_path"
shasum -a 256 "$zip_path" > "$zip_path.sha256"
echo "$zip_path"

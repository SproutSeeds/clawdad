#!/usr/bin/env zsh
set -euo pipefail

script_dir=${0:A:h}
repo_root=${script_dir:h:h}
app_name="ClawDad"
bundle_id="earth.frg.ClawDad"
app_version="${CLAWDAD_APP_VERSION:-0.7.0}"
app_build="${CLAWDAD_APP_BUILD:-26}"
sparkle_feed_url="${CLAWDAD_SPARKLE_FEED_URL:-https://clawdad-cloud.frg.earth/mac/appcast.xml}"
sparkle_public_key="${CLAWDAD_SPARKLE_PUBLIC_KEY:-OjSne9VtiBjR3Ls2aaLTgEUeKtYzi9oAtexOiA5K+dI=}"
dist_dir="$script_dir/dist"
app_dir="$dist_dir/$app_name.app"
icon_source="$repo_root/assets/clawdad-claw-hyperreal-icon.png"
prebuilt_icon_source="${CLAWDAD_PREBUILT_ICON_PATH:-}"
webrtc_framework_source="$repo_root/vendor/WebRTCPackage/WebRTC.xcframework/macos-x86_64_arm64/WebRTC.framework"
swift_scratch_path="${CLAWDAD_SWIFT_SCRATCH_PATH:-}"
swift_disable_sandbox="${CLAWDAD_SWIFT_DISABLE_SANDBOX:-0}"
if [[ -n "$swift_scratch_path" ]]; then
  sparkle_framework_source="$swift_scratch_path/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
  swift_build_args=(
    --package-path "$script_dir"
    --scratch-path "$swift_scratch_path"
    -c release
  )
else
  sparkle_framework_source="$script_dir/.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
  swift_build_args=(--package-path "$script_dir" -c release)
fi
if [[ "$swift_disable_sandbox" == "1" ]]; then
  swift_build_args+=(--disable-sandbox)
fi
runtime_dir="$app_dir/Contents/Resources/runtime"

"$repo_root/bin/fetch-webrtc-dependency"
swift build "${swift_build_args[@]}"
bin_dir=$(swift build "${swift_build_args[@]}" --show-bin-path)

rm -rf "$app_dir"
mkdir -p \
  "$app_dir/Contents/MacOS" \
  "$app_dir/Contents/Resources" \
  "$app_dir/Contents/Frameworks"
cp "$bin_dir/$app_name" "$app_dir/Contents/MacOS/$app_name"
chmod +x "$app_dir/Contents/MacOS/$app_name"
ditto "$webrtc_framework_source" "$app_dir/Contents/Frameworks/WebRTC.framework"
ditto "$sparkle_framework_source" "$app_dir/Contents/Frameworks/Sparkle.framework"
install_name_tool \
  -add_rpath "@executable_path/../Frameworks" \
  "$app_dir/Contents/MacOS/$app_name"

mkdir -p "$runtime_dir/assets"
cp "$repo_root/package.json" "$runtime_dir/package.json"
ditto "$repo_root/bin" "$runtime_dir/bin"
ditto "$repo_root/lib" "$runtime_dir/lib"
ditto "$repo_root/web" "$runtime_dir/web"
ditto "$repo_root/templates" "$runtime_dir/templates"
ditto "$repo_root/node_modules" "$runtime_dir/node_modules"
mkdir -p "$runtime_dir/vendor"
ditto "$repo_root/vendor/apple-pki" "$runtime_dir/vendor/apple-pki"

runtime_assets=(
  clawdad-app-icon-192.png
  clawdad-app-icon-512.png
  clawdad-app-icon-1024.png
  clawdad-apple-touch-icon.png
  clawdad-claw-hyperreal-icon.png
  clawdad-claw.svg
  clawdad-mascot.jpg
  clawdad-mascot-app.png
  clawdad-mascot-cutout.png
  clawdad-wordmark.png
  clawdad-wordmark.svg
)
for asset_name in "${runtime_assets[@]}"; do
  cp "$repo_root/assets/$asset_name" "$runtime_dir/assets/$asset_name"
done
for header_asset in "$repo_root"/assets/clawdad-header-*.jpg; do
  cp "$header_asset" "$runtime_dir/assets/${header_asset:t}"
done
runtime_version=$(
  shasum -a 256 \
    "$runtime_dir/package.json" \
    "$runtime_dir/lib/server.mjs" \
    "$runtime_dir/web/index.html" \
    "$runtime_dir/web/app.css" \
    "$runtime_dir/web/app.js" \
    | shasum -a 256 \
    | awk '{print $1}'
)
printf '%s\n' "$runtime_version" > "$runtime_dir/.bundle-version"

if [[ -n "$prebuilt_icon_source" ]]; then
  if [[ ! -f "$prebuilt_icon_source" ]]; then
    print -u2 "CLAWDAD_PREBUILT_ICON_PATH does not name a readable icon file."
    exit 1
  fi
  cp "$prebuilt_icon_source" "$app_dir/Contents/Resources/ClawDad.icns"
elif [[ -f "$icon_source" ]]; then
  iconset_dir=$(mktemp -d "${TMPDIR:-/tmp}/clawdad-iconset.XXXXXX")
  cleanup_iconset() {
    rm -rf "$iconset_dir"
  }
  trap cleanup_iconset EXIT
  mkdir -p "$iconset_dir/ClawDad.iconset"
  sips -z 16 16 "$icon_source" --out "$iconset_dir/ClawDad.iconset/icon_16x16.png" >/dev/null
  sips -z 32 32 "$icon_source" --out "$iconset_dir/ClawDad.iconset/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$icon_source" --out "$iconset_dir/ClawDad.iconset/icon_32x32.png" >/dev/null
  sips -z 64 64 "$icon_source" --out "$iconset_dir/ClawDad.iconset/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$icon_source" --out "$iconset_dir/ClawDad.iconset/icon_128x128.png" >/dev/null
  sips -z 256 256 "$icon_source" --out "$iconset_dir/ClawDad.iconset/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$icon_source" --out "$iconset_dir/ClawDad.iconset/icon_256x256.png" >/dev/null
  sips -z 512 512 "$icon_source" --out "$iconset_dir/ClawDad.iconset/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$icon_source" --out "$iconset_dir/ClawDad.iconset/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$icon_source" --out "$iconset_dir/ClawDad.iconset/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$iconset_dir/ClawDad.iconset" -o "$app_dir/Contents/Resources/ClawDad.icns"
fi

cat > "$app_dir/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>$app_name</string>
  <key>CFBundleIdentifier</key>
  <string>$bundle_id</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleIconFile</key>
  <string>ClawDad</string>
  <key>CFBundleName</key>
  <string>$app_name</string>
  <key>CFBundleDisplayName</key>
  <string>$app_name</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$app_version</string>
  <key>CFBundleVersion</key>
  <string>$app_build</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>ClawDad uses the microphone to record voice messages and transcribe them into the composer.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>ClawDad shares the display you choose only during a Remote Assist session you start from your paired iPhone.</string>
  <key>SUFeedURL</key>
  <string>$sparkle_feed_url</string>
  <key>SUPublicEDKey</key>
  <string>$sparkle_public_key</string>
  <key>SUEnableAutomaticChecks</key>
  <true/>
  <key>SUScheduledCheckInterval</key>
  <integer>86400</integer>
</dict>
</plist>
PLIST

cat > "$app_dir/Contents/PkgInfo" <<PKGINFO
APPL????
PKGINFO

signing_identity=${CLAWDAD_CODESIGN_IDENTITY:-}
if [[ -z "$signing_identity" ]]; then
  signing_identity=$(
    security find-identity -v -p codesigning 2>/dev/null \
      | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' \
      | head -n 1
  )
fi

if [[ -n "$signing_identity" ]]; then
  codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$signing_identity" \
    "$app_dir/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc"
  codesign \
    --force \
    --options runtime \
    --timestamp \
    --preserve-metadata=entitlements \
    --sign "$signing_identity" \
    "$app_dir/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Downloader.xpc"
  codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$signing_identity" \
    "$app_dir/Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate"
  codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$signing_identity" \
    "$app_dir/Contents/Frameworks/Sparkle.framework/Versions/B/Updater.app"
  codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$signing_identity" \
    "$app_dir/Contents/Frameworks/Sparkle.framework"
  codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$signing_identity" \
    "$app_dir/Contents/Frameworks/WebRTC.framework"
  codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$signing_identity" \
    "$app_dir"
else
  codesign --force --options runtime --sign - \
    "$app_dir/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc"
  codesign --force --options runtime --preserve-metadata=entitlements --sign - \
    "$app_dir/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Downloader.xpc"
  codesign --force --options runtime --sign - \
    "$app_dir/Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate"
  codesign --force --options runtime --sign - \
    "$app_dir/Contents/Frameworks/Sparkle.framework/Versions/B/Updater.app"
  codesign --force --options runtime --sign - \
    "$app_dir/Contents/Frameworks/Sparkle.framework"
  codesign --force --sign - "$app_dir/Contents/Frameworks/WebRTC.framework"
  codesign --force --sign - "$app_dir"
fi

printf '%s\n' "$app_dir"

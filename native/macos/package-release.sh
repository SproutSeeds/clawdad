#!/usr/bin/env zsh
set -euo pipefail

script_dir=${0:A:h}
repo_root=${script_dir:h:h}
package_version="${CLAWDAD_RELEASE_VERSION:-$(node -p "require('${repo_root}/package.json').version")}"
app_version="${CLAWDAD_APP_VERSION:-0.7.0}"
app_build="${CLAWDAD_APP_BUILD:-26}"
release_tag="${CLAWDAD_RELEASE_TAG:-v${package_version}}"
release_dir="${CLAWDAD_RELEASE_DIR:-$script_dir/dist/releases/$package_version}"
app_dir="$script_dir/dist/ClawDad.app"
appcast_dir="$release_dir/appcast"
staging_dir="$release_dir/dmg-root"
zip_name="ClawDad-${package_version}-mac.zip"
dmg_name="ClawDad-${package_version}-mac.dmg"
zip_path="$appcast_dir/$zip_name"
dmg_path="$release_dir/$dmg_name"
appcast_path="$appcast_dir/appcast.xml"
release_notes_source="$repo_root/docs/releases/$package_version.md"
release_notes_path="$appcast_dir/ClawDad-${package_version}-mac.md"
download_url_prefix="${CLAWDAD_RELEASE_DOWNLOAD_URL_PREFIX:-https://github.com/SproutSeeds/clawdad/releases/download/$release_tag/}"
notary_profile="${CLAWDAD_NOTARY_PROFILE:-ClawDad}"
notary_key_path="${CLAWDAD_NOTARY_KEY_PATH:-}"
notary_key_id="${CLAWDAD_NOTARY_KEY_ID:-}"
notary_issuer_id="${CLAWDAD_NOTARY_ISSUER_ID:-}"
sparkle_account="${CLAWDAD_SPARKLE_ACCOUNT:-earth.frg.ClawDad}"
notarize="${CLAWDAD_NOTARIZE:-1}"
publish_appcast="${CLAWDAD_PUBLISH_APPCAST:-0}"
appcast_publish_url="${CLAWDAD_APPCAST_PUBLISH_URL:-https://clawdad-cloud.frg.earth/admin/mac/appcast}"
release_token_service="${CLAWDAD_RELEASE_TOKEN_KEYCHAIN_SERVICE:-clawdad-cloud-release}"
release_token_account="${CLAWDAD_RELEASE_TOKEN_KEYCHAIN_ACCOUNT:-appcast}"
swift_scratch_path="${CLAWDAD_SWIFT_SCRATCH_PATH:-}"
if [[ -n "$swift_scratch_path" ]]; then
  generate_appcast="$swift_scratch_path/artifacts/sparkle/Sparkle/bin/generate_appcast"
else
  generate_appcast="$script_dir/.build/artifacts/sparkle/Sparkle/bin/generate_appcast"
fi

signing_identity="${CLAWDAD_CODESIGN_IDENTITY:-}"
if [[ -z "$signing_identity" ]]; then
  signing_identity=$(
    security find-identity -v -p codesigning 2>/dev/null \
      | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' \
      | head -n 1
  )
fi
if [[ -z "$signing_identity" ]]; then
  print -u2 "A Developer ID Application signing identity is required."
  exit 1
fi

notary_auth_args=()
if [[ -n "$notary_key_path" || -n "$notary_key_id" || -n "$notary_issuer_id" ]]; then
  if [[ -z "$notary_key_path" || -z "$notary_key_id" || -z "$notary_issuer_id" ]]; then
    print -u2 "CLAWDAD_NOTARY_KEY_PATH, CLAWDAD_NOTARY_KEY_ID, and CLAWDAD_NOTARY_ISSUER_ID must be set together."
    exit 1
  fi
  notary_auth_args=(
    --key "$notary_key_path"
    --key-id "$notary_key_id"
    --issuer "$notary_issuer_id"
  )
else
  notary_auth_args=(--keychain-profile "$notary_profile")
fi

if [[ "$notarize" == "1" ]]; then
  xcrun notarytool history \
    "${notary_auth_args[@]}" \
    --output-format json \
    >/dev/null
fi

rm -rf "$release_dir"
mkdir -p "$appcast_dir"

CLAWDAD_APP_VERSION="$app_version" \
CLAWDAD_APP_BUILD="$app_build" \
CLAWDAD_CODESIGN_IDENTITY="$signing_identity" \
  zsh "$script_dir/build-app.sh"

codesign --verify --deep --strict --verbose=2 "$app_dir"

ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$zip_path"
if [[ "$notarize" == "1" ]]; then
  xcrun notarytool submit "$zip_path" \
    "${notary_auth_args[@]}" \
    --wait \
    --output-format json \
    >"$release_dir/notary-app.json"
  xcrun stapler staple "$app_dir"
  xcrun stapler validate "$app_dir"
  rm -f "$zip_path"
  ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$zip_path"
fi

if [[ -f "$release_notes_source" ]]; then
  cp "$release_notes_source" "$release_notes_path"
fi

"$generate_appcast" \
  --account "$sparkle_account" \
  --download-url-prefix "$download_url_prefix" \
  --embed-release-notes \
  --link "https://github.com/SproutSeeds/clawdad" \
  --maximum-deltas 0 \
  -o "$appcast_path" \
  "$appcast_dir"

mkdir -p "$staging_dir"
ditto "$app_dir" "$staging_dir/ClawDad.app"
ln -s /Applications "$staging_dir/Applications"
hdiutil create \
  -volname "ClawDad" \
  -srcfolder "$staging_dir" \
  -ov \
  -format UDZO \
  "$dmg_path"
codesign \
  --force \
  --timestamp \
  --sign "$signing_identity" \
  "$dmg_path"

if [[ "$notarize" == "1" ]]; then
  xcrun notarytool submit "$dmg_path" \
    "${notary_auth_args[@]}" \
    --wait \
    --output-format json \
    >"$release_dir/notary-dmg.json"
  xcrun stapler staple "$dmg_path"
  xcrun stapler validate "$dmg_path"
fi

if [[ "$notarize" == "1" ]]; then
  codesign --verify --deep --strict --verbose=2 "$app_dir"
  spctl --assess --type execute --verbose=4 "$app_dir"
  spctl --assess \
    --type open \
    --context context:primary-signature \
    --verbose=4 \
    "$dmg_path"
fi

(
  cd "$release_dir"
  shasum -a 256 \
    "$dmg_name" \
    "appcast/$zip_name" \
    "appcast/appcast.xml" \
    >SHA256SUMS
)

if [[ "$publish_appcast" == "1" ]]; then
  release_token="${CLAWDAD_RELEASE_TOKEN:-}"
  if [[ -z "$release_token" ]]; then
    release_token=$(
      security find-generic-password \
        -s "$release_token_service" \
        -a "$release_token_account" \
        -w \
        2>/dev/null || true
    )
  fi
  if [[ -z "$release_token" ]]; then
    print -u2 "CLAWDAD_RELEASE_TOKEN is required to publish the appcast."
    exit 1
  fi
  curl --fail --silent --show-error \
    --request PUT \
    --header "authorization: Bearer $release_token" \
    --header "content-type: application/rss+xml" \
    --data-binary "@$appcast_path" \
    "$appcast_publish_url" \
    >/dev/null
fi

rm -rf "$staging_dir"

print "$release_dir"
print "$dmg_path"
print "$zip_path"
print "$appcast_path"

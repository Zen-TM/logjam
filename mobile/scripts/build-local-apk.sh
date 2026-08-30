#!/usr/bin/env bash
#
# Build, install and wire up the on-device verification APK.
#
# This is the debuggable-release loop (mobile/CLAUDE.local.md): a release-shaped
# build with `debuggable true`, used because Metro cannot run on the dev laptop.
# Doing it by hand means remembering four separate things, and each of them
# fails SILENTLY or misleadingly:
#
#   1. `.env` is not a Gradle input. Changing EXPO_PUBLIC_API_URL does not
#      invalidate `createBundleReleaseJsAndAssets`, so `assembleRelease` prints
#      BUILD SUCCESSFUL in ~10s and reships the PREVIOUS bundle with the old URL
#      baked in. We delete the generated bundle to force it.
#   2. Cleartext is blocked in a release variant, so the app cannot reach a
#      local http API at all. LOGJAM_LOCAL_API=1 turns on the loopback-only
#      exemption (plugins/withLocalApiCleartext.js).
#   3. The Sentry sourcemap upload fails the build when no org/project is
#      configured, which is every local build.
#   4. `:app:packageRelease` is flaky above one worker on this laptop.
#
# 1, 2 and 3 all present as something OTHER than a build problem — a bare
# `TypeError: Network request failed` with no console output, which reads as a
# dead `adb reverse` or a stopped API. Use this script; do not call gradlew.
#
# Usage:  ./scripts/build-local-apk.sh [--no-install]
#
# Assumes the API + MiniStack are reachable on the HOST at 8080 / 4566 (over an
# ssh tunnel if they run on the kiosk box) and that `.env` points the app at
# http://127.0.0.1:8080 — loopback plus `adb reverse` is the one configuration
# that works on the emulator and a physical device alike, so it never needs
# editing per target. Never 10.0.2.2: that is emulator-only and routes nowhere
# on a phone.
set -euo pipefail

cd "$(dirname "$0")/.."

install_apk=1
[ "${1:-}" = "--no-install" ] && install_apk=0

export LOGJAM_LOCAL_API=1
export SENTRY_DISABLE_AUTO_UPLOAD=true

bundle_dir="android/app/build/generated/assets/createBundleReleaseJsAndAssets"
apk="android/app/build/outputs/apk/release/app-release.apk"

# The plugin writes into android/, which is prebuild-generated, so prebuild has
# to run for the manifest to carry the exemption. Plain prebuild only re-applies
# MODS (they patch existing files), which is why the hand-added `debuggable true`
# in android/app/build.gradle survives it. NEVER add --clean here: that rewrites
# the template from scratch and takes that line with it, turning every later
# build into a plain release you cannot `run-as`.
echo "==> prebuild (android)"
npx expo prebuild --platform android --no-install

echo "==> forcing a fresh JS bundle (.env is not a gradle input)"
rm -rf "$bundle_dir"

echo "==> assembleRelease"
(cd android && ./gradlew assembleRelease --max-workers=1)

# Prove the two things that fail silently, rather than trusting the build. Both
# are asserted, not printed: a warning nobody reads is how these got shipped in
# the first place.
echo "==> verifying the APK"

# Grep for the URL .env ASKS for, not for "some loopback URL" — the bundle also
# contains Metro's own http://localhost:8081, which matches a loose pattern and
# makes a stale API URL look fine.
want=$(grep -E '^EXPO_PUBLIC_API_URL=' .env | cut -d= -f2- | tr -d '"'"'"'\r')
if [ -z "$want" ]; then
  echo "    EXPO_PUBLIC_API_URL is not set in .env" >&2
  exit 1
fi
if grep -aqF "$want" "$bundle_dir/index.android.bundle"; then
  echo "    API URL:   $want (in the bundle)"
else
  echo "    API URL:   MISSING — .env says $want but the bundle does not contain it." >&2
  echo "               The JS bundle is stale; delete $bundle_dir and rebuild." >&2
  exit 1
fi
case "$want" in
  *10.0.2.2*)
    echo "    WARNING:   10.0.2.2 is emulator-only and routes nowhere on a phone." >&2
    echo "               Use http://127.0.0.1:8080 + adb reverse for both targets." >&2
    ;;
esac

if grep -q 'networkSecurityConfig' android/app/src/main/AndroidManifest.xml; then
  echo "    cleartext: loopback exemption present"
else
  echo "    cleartext: MISSING — the app cannot reach a local http API" >&2
  exit 1
fi

if [ "$install_apk" = 1 ]; then
  echo "==> installing"
  adb install -r "$apk"
  echo "==> adb reverse (API, MiniStack S3, Metro)"
  for port in 8080 4566 8081; do adb reverse "tcp:$port" "tcp:$port" >/dev/null; done
  adb reverse --list
fi

echo "done: $apk"

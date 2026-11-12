#!/usr/bin/env bash
#
# The body of the emulator smoke check (.github/workflows/mobile-emulator.yml),
# run once an emulator is booted, the API is up on :8080 and Metro on :8081:
# install the dev APK, point it at this host, drive maestro/smoke.yaml, then ask
# Postgres whether the place it added reached the server.
#
#   scripts/emulator-smoke.sh <apk> <screenshot-dir> <log-dir>
#
# Needs adb, maestro and psql on PATH, and DB_* in the environment (the API's).
# It only reads what the workflow's own throwaway stack holds.
#
# Mutation that turns the check red: a throw at the top of mobile/index.ts
# fails the flow (the app never shows "Places"). The sync half is guarded by
# the place's name: the flow adds one, and this script fails if no such row
# reaches the places table.
set -euo pipefail

APK=$(realpath "${1:?apk}")
OUT=$(realpath -m "${2:?screenshot dir}")
LOGS=$(realpath -m "${3:?log dir}")
PKG=com.logjamnsw.mobile.dev
cd "$(dirname "$0")/.."
mkdir -p "$OUT" "$LOGS"
# Whatever the outcome, so a failure arrives with the device's own account of it.
trap 'adb logcat -d > "$LOGS/logcat.txt" 2>&1 || true' EXIT

# Run id in the name, so a rerun on a reused database cannot pass on last run's row.
PLACE_NAME="Smoke Test Gully ${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"

# A clean install: nothing from an earlier run on this AVD, nor its places.
adb uninstall "$PKG" > /dev/null 2>&1 || true
adb install -t "$APK" > /dev/null
# Right after boot the package manager cannot always resolve a package yet.
for _ in $(seq 1 20); do adb shell pm path "$PKG" | grep -q package && break; sleep 3; done
adb shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION

# Typing is where the emulator has gone "device offline" under load (Maestro's
# adb call fails mid-inputText). The software GPU already has the cores busy, and
# Gboard adds suggestion, GIF and clipboard work to every field: no keyboard UI
# is a lighter one, and `input text` needs none.
for ime in $(adb shell ime list -s | tr -d '\r'); do adb shell ime disable "$ime" > /dev/null || true; done

# A 320x640 screen at 160 dpi cannot show the add-place form, and a sheet that
# scrolls under Maestro's swipes is a flake to chase. Pack more dp into the same
# pixels, which also costs the software GPU nothing.
adb shell wm density 120

# The dev client's menu opens over the first launch, and its floating button
# covers the top-right of every screen, "Add a place" among them: answer its
# three preferences before the app first runs (the build is debuggable).
adb shell "run-as $PKG sh -c 'mkdir -p shared_prefs && cat > shared_prefs/expo.modules.devmenu.sharedpreferences.xml'" <<'XML'
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <boolean name="showFab" value="false" />
    <boolean name="isOnboardingFinished" value="true" />
    <boolean name="showsAtLaunch" value="false" />
</map>
XML

# Where the map opens follows the device's location once it has one, and the
# emulator's default is a place with no NSW tiles: put it in the Blue Mountains
# (longitude first) so the screenshots show the same map every run.
adb emu geo fix 150.25 -33.5 > /dev/null || true

# 127.0.0.1 in the app means the emulator, so every port it dials is reversed.
# Before the deep link, or the dev client times out.
reverse() {
  adb reverse --remove-all
  for port in 8081 8080 4566; do adb reverse "tcp:$port" "tcp:$port" > /dev/null; done
}
reverse

# The first bundle takes minutes on a cold Metro; the dev client gives up on
# less. Ask for the exact URL the manifest names, or a different bundle is
# built and nothing is warmed.
bundle=$(curl -sf -H 'expo-platform: android' http://127.0.0.1:8081/ | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).launchAsset.url')
curl -sf -m 900 -o /dev/null "$bundle"

# One retry: Maestro's driver has died mid-flow on a healthy run (a silent exit
# after a tap, green on rerun), and that says nothing about the app. A real
# break fails both attempts, and the warning keeps the flake rate visible.
status=0
for attempt in 1 2; do
  status=0
  maestro test maestro/smoke.yaml -e "PLACE_NAME=$PLACE_NAME" --test-output-dir "$OUT/maestro-$attempt" && break || status=$?
  echo "::warning::maestro attempt $attempt failed (exit $status)"
  { adb devices -l; adb reverse --list; } > "$LOGS/adb-$attempt.txt" 2>&1 || true
  adb exec-out screencap -p > "$OUT/failed-$attempt.png" || true
  adb reconnect offline || true
  adb wait-for-device
  adb shell am force-stop "$PKG" || true
  reverse
done
adb exec-out screencap -p > "$OUT/final.png" || true
[ "$status" = 0 ] || exit "$status"

# The place is on the phone the moment the form closes; this is the push.
for _ in $(seq 1 30); do
  found=$(PGPASSWORD=$DB_PASSWORD psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atc \
    "SELECT count(*) FROM places WHERE name = '$PLACE_NAME'")
  [ "$found" -ge 1 ] && { echo "synced: '$PLACE_NAME' is in the places table"; exit 0; }
  sleep 3
done
echo "::error::'$PLACE_NAME' never reached the server's places table" >&2
exit 1

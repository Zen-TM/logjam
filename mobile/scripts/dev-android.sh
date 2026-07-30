#!/usr/bin/env bash
#
# One command to get the Logjam dev client running on a connected Android
# device (or emulator). Idempotent — safe to re-run whenever the phone is
# replugged, the app is force-stopped, or a reverse tunnel has died.
#
#   ./scripts/dev-android.sh              # set up + launch, leave Metro to you
#   ./scripts/dev-android.sh --emulator   # boot the AVD first (no phone needed)
#   ./scripts/dev-android.sh --metro      # ...and run Metro in the foreground
#   ./scripts/dev-android.sh --build      # rebuild + reinstall the dev client
#   ./scripts/dev-android.sh --logs       # tail the app's logcat instead
#
# With a phone plugged in, prefer the phone: it is the only place GPS, real
# cameras and the biometric prompt behave like they will in a canyon. --emulator
# is for when no phone is attached, or for checking a second screen size.
#
# What it does, and why each step exists:
#
#   1. Finds exactly one usable device, and explains the fix when it can't.
#      An "unauthorized" device and a phone in MTP-only mode look identical
#      from `npm start` — you just get a dev client that never connects.
#   2. Reverses every port the app dials on localhost. .env points the app at
#      127.0.0.1, which on the phone means THE PHONE, so without these the
#      API and the S3 emulator are silently unreachable — the symptom is an
#      outbox that never drains, not an error.
#   3. Installs the debug dev client if it is missing (or --build to rebuild).
#   4. Launches it and reports what is actually listening on the host.
#
# Deliberately does NOT touch prod: every port here is a local dev service.
set -euo pipefail

cd "$(dirname "$0")/.."

PACKAGE="com.logjamnsw.mobile"
APK="android/app/build/outputs/apk/debug/app-debug.apk"

# The AVD this project develops against. Create it in Android Studio if missing;
# the script lists what it found rather than guessing at another one.
AVD="logjam"
EMULATOR_BOOT_TIMEOUT_S=180

# host port -> what lives there. Metro must be first: it is the one the dev
# client itself needs to load any JS at all.
PORTS=(
  "8081:Metro bundler"
  "8080:Logjam dev API"
  "4566:MiniStack (S3 presigned URLs)"
)

RUN_METRO=false
DO_BUILD=false
TAIL_LOGS=false
START_EMULATOR=false
for arg in "$@"; do
  case "$arg" in
    --emulator) START_EMULATOR=true ;;
    --metro) RUN_METRO=true ;;
    --build) DO_BUILD=true ;;
    --logs) TAIL_LOGS=true ;;
    -h|--help) sed -n '3,25p' "$0" | sed 's|^# \?||'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m !!\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. device ---------------------------------------------------------------

command -v adb >/dev/null || die "adb not on PATH. Install platform-tools, or add \$ANDROID_HOME/platform-tools to PATH."

adb start-server >/dev/null 2>&1 || true

# --emulator: boot the AVD and block until Android is actually up. `adb
# wait-for-device` returns as soon as adbd answers, which is minutes before the
# launcher exists — installing or launching in that window fails confusingly, so
# poll sys.boot_completed instead.
if [ "$START_EMULATOR" = true ]; then
  command -v emulator >/dev/null || die "\`emulator\` not on PATH. Add \$ANDROID_HOME/emulator to PATH."

  if adb devices | awk 'NR>1 && $2=="device"' | grep -q '^emulator-'; then
    say "Emulator already running — reusing it."
  else
    avds="$(emulator -list-avds 2>/dev/null)"
    if ! printf '%s\n' "$avds" | grep -qx "$AVD"; then
      die "No AVD named '$AVD'. Found:
$(printf '%s\n' "${avds:-  (none)}" | sed 's/^/       /')
     Create one in Android Studio, or edit AVD= at the top of this script."
    fi
    say "Booting the '$AVD' emulator…"
    # -no-snapshot-save keeps the AVD's saved state clean between runs;
    # detached with its own log so this script can keep going.
    emulator -avd "$AVD" -no-snapshot-save -no-boot-anim \
      >"${TMPDIR:-/tmp}/logjam-emulator.log" 2>&1 &
    printf '    waiting for Android to finish booting'
    waited=0
    until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
      [ "$waited" -lt "$EMULATOR_BOOT_TIMEOUT_S" ] || {
        printf '\n'
        die "Emulator didn't finish booting in ${EMULATOR_BOOT_TIMEOUT_S}s.
     Log: ${TMPDIR:-/tmp}/logjam-emulator.log"
      }
      printf '.'
      sleep 3
      waited=$((waited + 3))
    done
    printf '\n'
    # The lock screen swallows the first taps after boot.
    adb shell input keyevent 82 >/dev/null 2>&1 || true
  fi
fi

# `adb devices` prints a header line and a trailing blank; keep only rows that
# carry a state we care about.
mapfile -t device_rows < <(adb devices | awk 'NR>1 && NF>=2 {print $1" "$2}')

unauthorized=()
ready=()
for row in "${device_rows[@]:-}"; do
  serial="${row%% *}"
  state="${row##* }"
  case "$state" in
    device)       ready+=("$serial") ;;
    unauthorized) unauthorized+=("$serial") ;;
    offline)      warn "device $serial is 'offline' — unplug and replug it." ;;
  esac
done

if [ ${#unauthorized[@]} -gt 0 ]; then
  die "Device ${unauthorized[0]} is connected but not authorized.
     Unlock the phone and tap 'Allow' on the 'Allow USB debugging?' prompt
     (tick 'Always allow from this computer'). Then re-run this script."
fi

if [ ${#ready[@]} -eq 0 ]; then
  # A phone plugged in with USB debugging OFF shows up on the USB bus but never
  # in `adb devices` — the single most confusing failure here, so name it.
  hint=""
  if command -v lsusb >/dev/null && lsusb | grep -qiE 'google|pixel'; then
    hint="
     A Google/Pixel device IS on the USB bus, so the cable is fine and this is
     almost certainly USB debugging being off (or the cable set to charge-only):
       Settings > About phone > tap 'Build number' 7x, then
       Settings > System > Developer options > USB debugging,
       and set the USB connection mode to 'File transfer / MTP'."
  fi
  die "No authorized Android device found.
     Plug in a phone with USB debugging enabled, or start an emulator.${hint}"
fi

if [ ${#ready[@]} -gt 1 ]; then
  die "More than one device attached (${ready[*]}). Unplug the others, or set
     ANDROID_SERIAL=<serial> and re-run. (A phone AND an emulator both being up
     is the usual cause — close one; the phone is the better target.)"
fi

SERIAL="${ready[0]}"
export ANDROID_SERIAL="$SERIAL"
MODEL="$(adb -s "$SERIAL" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"
RELEASE="$(adb -s "$SERIAL" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')"
say "Device: ${MODEL:-unknown} (Android ${RELEASE:-?}, $SERIAL)"

# --- 2. reverse tunnels ------------------------------------------------------

# Re-reversing an existing tunnel is a no-op, so this needs no teardown; but a
# port with NOTHING listening on the host is worth calling out, because the
# failure it produces in-app looks like a bug in the app.
for entry in "${PORTS[@]}"; do
  port="${entry%%:*}"
  label="${entry#*:}"
  adb -s "$SERIAL" reverse "tcp:$port" "tcp:$port" >/dev/null
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    exec 3<&- 3>&-
    say "reverse tcp:$port  ← $label (up)"
  else
    warn "reverse tcp:$port  ← $label — nothing listening on the host yet."
  fi
done

case " ${PORTS[*]} " in
  *8080*)
    if ! (exec 3<>/dev/tcp/127.0.0.1/8080) 2>/dev/null; then
      warn "The dev API is down. Start it with 'make dev' from the repo root."
    else
      exec 3<&- 3>&- 2>/dev/null || true
    fi
    ;;
esac

# --- 3. dev client ----------------------------------------------------------

installed="$(adb -s "$SERIAL" shell pm list packages "$PACKAGE" | tr -d '\r')"

if [ "$DO_BUILD" = true ]; then
  say "Rebuilding the debug dev client (this takes a few minutes)…"
  [ -d android ] || npx expo prebuild -p android
  # RTK_DISABLED=1: see the note in mobile/CLAUDE.md — the RTK hook breaks the
  # gradle wrapper's stdout handling on this host.
  (cd android && RTK_DISABLED=1 ./gradlew :app:assembleDebug)
  installed=""
fi

if [ -z "$installed" ]; then
  [ -f "$APK" ] || die "Dev client not installed and no APK at $APK.
     Build one first: ./scripts/dev-android.sh --build"
  say "Installing $APK"
  adb -s "$SERIAL" install -r "$APK"
else
  say "Dev client already installed ($PACKAGE)"
fi

# --- 4. launch --------------------------------------------------------------

# monkey is the reliable way to fire a package's launcher intent without
# knowing the activity name (which prebuild can change).
say "Launching $PACKAGE"
adb -s "$SERIAL" shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
  || warn "Couldn't launch automatically — open Logjam on the device."

if [ "$TAIL_LOGS" = true ]; then
  pid="$(adb -s "$SERIAL" shell pidof "$PACKAGE" | tr -d '\r')"
  [ -n "$pid" ] || die "App isn't running, so there is no log to tail."
  say "Tailing logcat for pid $pid (ctrl-C to stop)"
  exec adb -s "$SERIAL" logcat --pid="$pid"
fi

if [ "$RUN_METRO" = true ]; then
  say "Starting Metro (ctrl-C to stop)"
  exec npm start
fi

cat <<EOF

Ready. Next:
  npm start                       # Metro, if it isn't already running
  ./scripts/dev-android.sh        # re-run any time after a replug
  ./scripts/dev-android.sh --logs
  ./scripts/dev-android.sh --emulator   # when no phone is attached

Handy while developing against this device:
  adb exec-out screencap -p > /tmp/shot.png
  adb shell input tap <x> <y>
EOF

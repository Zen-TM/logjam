# Mobile Maestro flows

UI flows for the Android emulator, run locally (not CI — same policy as the
api integration suite). Prereqs:

1. Emulator booted (`emulator -avd logjam -no-window -no-audio -gpu swiftshader_indirect`)
   with the dev-client APK installed.
2. Local stack: `make dev`, then `cd api && npm run dev`.
3. Metro: `cd mobile && npm start`, plus `adb reverse tcp:8081 tcp:8081`.
4. `maestro test e2e/<flow>.yaml` (Maestro in `~/.maestro/bin`).

| Flow | Auth mode (`mobile/.env`) | Needs |
|---|---|---|
| `browse.yaml` | `fake` | seeded local API (alice) |
| `signin.yaml` | `cognito` | `MAESTRO_TEST_EMAIL` / `MAESTRO_TEST_PASSWORD` — a confirmed **test** Cognito user (operator-provided; never a real account, never committed) |
| `guest.yaml` | `cognito` | nothing — no credentials, no API. **Run `adb shell pm clear com.logjamnsw.mobile` first** |

`guest.yaml` needs the clear because the entry choice is persisted: once an
install has chosen guest or account, the chooser never appears again, and the
flow's first assertion is that it does. `fake` auth mode won't work for it
either — that mode boots straight to `authenticated`, past the chooser.

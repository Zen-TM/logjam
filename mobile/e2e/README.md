# Mobile Maestro flows

UI flows run by hand on an Android emulator or a real Android phone, never in
CI: GitHub-hosted runners have no reliable hardware acceleration for an
emulator, so a CI gate would fail for reasons unrelated to the app. Passing
all of them is what qualifies a Logjam GPS release
([docs/operations/mobile-release.md](../../docs/operations/mobile-release.md#release-qualification)).

Every flow opens the app through the dev client
(`exp+logjam-mobile://expo-development-client/...`), so it runs against a dev
client and Metro, not a Play or preview build. Prereqs:

1. An emulator or phone with the dev client installed, built from the commit
   under test if native code changed. An emulator can run headless:
   `emulator -avd <name> -no-window -no-audio -gpu swiftshader_indirect`.
2. Local stack: `make dev`, then `cd api && npm run dev`.
3. Metro: `cd mobile && npm start`, plus `adb reverse tcp:8081 tcp:8081`
   (`npm run dev:android` does the reverses and the launch).
4. `maestro test e2e/<flow>.yaml`.

| Flow | Auth mode (`mobile/.env`) | Needs |
|---|---|---|
| `browse.yaml` | `fake` | seeded local API (alice) |
| `map.yaml` | `fake` | seeded local API (alice) |
| `signin.yaml` | `cognito` | `MAESTRO_TEST_EMAIL` / `MAESTRO_TEST_PASSWORD` — a confirmed **test** Cognito user (operator-provided; never a real account, never committed) |
| `guest.yaml` | `cognito` | nothing — no credentials, no API. **Run `adb shell pm clear com.logjamnsw.mobile` first** |

`guest.yaml` needs the clear because the entry choice is persisted: once an
install has chosen guest or account, the chooser never appears again, and the
flow's first assertion is that it does. `fake` auth mode won't work for it
either — that mode boots straight to `authenticated`, past the chooser.
After the clear, Android leaves the app stopped and drops the flow's deep
link: launch it once first (`npm run dev:android` does).

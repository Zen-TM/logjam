# Mobile Maestro flows

UI flows run by hand on an Android emulator or a real Android phone. (The
emulator smoke check in CI is separate: `../maestro/smoke.yaml`.) Passing the
four in the table below is what qualifies a Logjam GPS release
([docs/operations/mobile-release.md](../../docs/operations/mobile-release.md#release-qualification)).
`pseudo.yaml` is not one of them: see [The pseudo-language walk](#the-pseudo-language-walk).

Each of the four opens Logjam GPS through the dev client
(`exp+logjam-mobile://expo-development-client/...`), so it runs against a dev
client and Metro, not a Play or preview build. Prereqs:

1. An emulator or phone with the dev client installed, built from the commit
   under test if native code changed. An emulator can run headless:
   `emulator -avd <name> -no-window -no-audio -gpu swiftshader_indirect`.
2. Local stack: `make dev`, then `cd api && npm run dev`.
3. Metro: `cd mobile && npm start`, plus `adb reverse tcp:8081 tcp:8081`
   (`npm run dev:android` does the reverses and the launch).
4. `maestro test e2e/<flow>.yaml`.

| Flow          | Auth mode (`mobile/.env`) | Needs                                                                                                                                         |
| ------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `browse.yaml` | `fake`                    | seeded local API (alice)                                                                                                                      |
| `map.yaml`    | `fake`                    | seeded local API (alice)                                                                                                                      |
| `signin.yaml` | `oidc`                    | `MAESTRO_TEST_EMAIL` / `MAESTRO_TEST_PASSWORD` — a confirmed **test** Cognito user (operator-provided; never a real account, never committed) |
| `guest.yaml`  | `oidc`                    | nothing — no credentials, no API. **Run `adb shell pm clear earth.logjam.gps` first**                                                         |

`guest.yaml` needs the clear because the entry choice is persisted: once an
install has chosen guest or account, the chooser never appears again, and the
flow's first assertion is that it does. `fake` auth mode won't work for it
either — that mode boots straight to `authenticated`, past the chooser.
After the clear, Android leaves Logjam GPS stopped and drops the flow's deep
link: launch it once first (`npm run dev:android` does).

## The pseudo-language walk

`pseudo.yaml` switches Logjam GPS to the pseudo-language, in which every
message that goes through the catalogue reads `⟦áççéñtéd~~~⟧`
([ADR 0050](../../docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md)),
opens each main screen and saves a screenshot of it. It asserts nothing about
the text: a person reads the screenshots for text without the brackets, which
skipped the catalogue, and for a label that is cut short or spills. It ends by
choosing English (Australia) and starting Logjam GPS once more, so the account
records English again.

It needs the same emulator or phone, local stack and Metro as the flows above,
with two differences:

- the dev variant of the dev client (`LOGJAM_APP_VARIANT=dev`, the build
  `../maestro/smoke.yaml` runs on), which the flow opens by its own id and
  link;
- `EXPO_PUBLIC_AUTH_MODE=fake` and `EXPO_PUBLIC_SIM_REGIONS=1` in
  `mobile/.env`: the pseudo-language is offered only where the simulated
  regions are on.

Run it from `mobile/`, with the screenshots written outside the tree (they
show a phone that may hold real data):

```sh
maestro test e2e/pseudo.yaml --test-output-dir /tmp/pseudo-walk
```

The screenshots (`pseudo-01-map.png` to `pseudo-12-display.png`) land in
`/tmp/pseudo-walk/takeScreenshot/`.

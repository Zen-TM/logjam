# Metro, the dev client and devices

Package `com.logjamnsw.mobile`. `npm run dev:android` sets up ports and
launches; these are what it does not catch.

| Symptom | Cause | Fix |
|---|---|---|
| Metro prints "Waiting on http://localhost:8081" but serves nothing; its log has `Could not parse Expo config: android.googleServicesFile` | `mobile/google-services.json` is missing (gitignored) | Restore it and restart Metro: it caches the failure |
| Dev launcher: "There was a problem loading the project", `SocketTimeoutException` or `Socket closed`, while Metro answers on the host | A wedged `adb reverse`: it accepts the connection and returns nothing, `--list` still shows it, and re-adding it is a no-op | `adb reverse --remove-all`, then `npm run dev:android` |
| First launch after starting Metro (or rebuilding `shared/`) times out | A cold bundle takes minutes; the dev client gives up sooner | Warm the bundle the client will ask for: the `launchAsset.url` in `curl -H 'expo-platform: android' http://127.0.0.1:8081/`. `/index.bundle?platform=android` is a different bundle |
| `Failed to download remote update` … `Must specify --private-key-path`, on a phone but not the emulator | The phone's dev client asks for a signed manifest | Start Metro from `mobile/` with `--private-key-path keys/private-key.pem` (gitignored: a worktree lacks it) |
| A deep link to the dev client does nothing after `pm clear` or a fresh install | Android leaves the app "stopped" and drops the intent | Launch it once first (`npm run dev:android` does), then send the link |
| Every screenshot of the app is black | App lock is on, which sets `FLAG_SECURE` app-wide (`applyScreenCapturePolicy`) | Turn app lock off. A launcher screenshot that works confirms it |
| A two-account test shows both devices as the same person | `EXPO_PUBLIC_FAKE_SUB` is baked into the bundle; a device that did not reload runs the other one | Check More → "Signed in as" on each device before trusting the result |
| Release APK: `TypeError: Network request failed`, nothing in logcat | The build, not the tunnel: no cleartext exemption, or an old API URL in the bundle | Rebuild with `./scripts/build-local-apk.sh`. If the phone's browser loads `http://127.0.0.1:8080/health` and the app cannot, it is the build |
| A mirror pulled with `run-as … cat files/SQLite/logjam.db` lacks recent writes | The mirror runs in WAL mode | Pull `logjam.db-wal` and `logjam.db-shm` with it |
| Scripted `adb shell input` taps stop working partway | The screen slept; taps land on the lockscreen | Keep the device awake, or do the steps by hand |
| Map is blank on an emulator | The camera is nowhere near seeded data | Places → a seeded place → ⋮ → Show on map before blaming the renderer |
| After `make reset` or `make seed`, the phone shows rows the server no longer has | The mirror predates the reset; sync does not reconcile a wiped server | Force-stop, `run-as … rm files/SQLite/logjam.db*`, relaunch |
| No push notification on an emulator | A `google_apis` image has no FCM | Test push on a phone |

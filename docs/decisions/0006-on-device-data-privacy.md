# 0006. On-device data privacy: app lock off by default, declared stores, one wipe path

- **Date:** 2026-08-04
- **Status:** Accepted
- **Supersedes:** —

## Context

Going offline puts place coords/names **on the device**. Guest mode
([0007](0007-guest-mode-is-dont-sync-yet.md)) made the device the privacy
boundary between two users of one phone.

## Decision

All local data in **app-private storage, excluded from cloud backup**
(`allowBackup=false` Android; `NSURLIsExcludedFromBackupKey` iOS data dirs).

**App lock** (biometric/PIN) gates the whole UI whenever the user has it on —
**unconditionally**, not only once downloads exist. The old data-armed condition
was wrong on its own terms: the sync mirror holds place names and coordinates
from the first sync after sign-in, so "nothing downloaded" never meant "nothing
sensitive". The asymmetry stands: turning it OFF requires the device
authenticator and fails closed, turning it on is free, and the pref is
device-scoped (`src/offline/appLockPreference.ts`).
- **It defaults to OFF, and an unreadable/absent pref reads as off** — an
  operator decision (2026-08-04) that knowingly departs from the fail-safe
  default in the privacy rules: a lock armed on a fresh install put a biometric
  prompt in front of every cold start and every return from the camera, and the
  field friction outweighed the guard. Don't "fix" this back to on without the
  operator; do keep the off-requires-auth asymmetry, which is what still makes
  the switch safe once raised.

**Every on-disk store is declared in `offline/localStores.ts`, and nowhere else
may name `documentDirectory`/`cacheDirectory`** (`localStores.test.ts` fails the
build if one does). The producers import their directory from it and the wipe
iterates `WIPED_DIRS`, so a new store cannot exist without joining the wipe —
the same medicine `sync/mirrorSchema.ts` applies to mirror tables. Scratch files
go in `SCRATCH_DIR` via `scratchFileUri()`, never loose in the cache directory.

**The wipe stops the producers before it deletes.** `cancelAllRegionDownloads()`
and `stopGeoPdfImportRun()` are awaited first: a job still running re-created the
directory the wipe had deleted and re-inserted its `map_artifact` row (the
departing user's bbox) after the wipe reported success, and their module-level
state outlived sign-out. MapLibre's ambient tile cache is cleared there too
(`OfflineManager.resetDatabase()`) — the z/x/y rows ARE the browsed area.

**FLAG_SECURE follows the app-lock preference** (`applyScreenCapturePolicy()`,
called on every toggle and at startup — it is per-process state). Not app-wide:
screenshotting a map is a legitimate field workflow, and a user who declined the
lock declined this with it.

**One wipe path for account transitions:** `offline/wipeLocalData.ts`. Sign-out
and a DIFFERENT user signing in both call it, and it clears `logjam.db`,
`logjam-offline.db`, the MBTiles regions, the overlay bundles, the imports and
the media cache. It deliberately spares `logjam-prefs.db` — theme, app lock and
crash-report choices describe the handset, not the account, and clearing them
would silently disarm a lock the owner turned on. Don't add a wipe anywhere
else, extend this one. (A guest *linking* keeps their data — they have no local
identity, so the different-user comparison never fires. An UNREADABLE identity
record is not a guest and wipes; a sign-in with no decodable `sub` is refused.
`signInNeedsWipe` in `auth/localIdentity.ts` is the decision,
`auth/localIdentity.test.ts` the guard.) The sync engine's persisted user id is
re-checked against `/users/me` every cycle the server can answer, and a mismatch
rebuilds the mirror (`syncEngine.test.ts`, "persisted user id").

## Consequences

- **Positive:** a new on-disk store cannot escape the wipe.
- **Negative:** with the lock off by default, a fresh install's mirror is not
  behind a lock — a knowing departure from the fail-safe default.
- **Neutral:** handset preferences survive an account change.

## Alternatives considered

- Arming the lock only once downloads exist: rejected, the mirror is sensitive
  from the first sync.
- Lock on by default: rejected by the operator (2026-08-04) for field friction.
- App-wide FLAG_SECURE: rejected, screenshotting a map is a legitimate field
  workflow.

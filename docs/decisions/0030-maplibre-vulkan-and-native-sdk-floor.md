# 0030. Run MapLibre on Vulkan on Android, with a native SDK floor of 13.3.0

- **Date:** 2026-08-18
- **Status:** Accepted
- **Supersedes:** —

## Context

The OpenGL backend silently renders no symbol layers (text or icons) on modern
emulators (maplibre-native #3617 — an `isEmulator()` fingerprint bug, so
EMULATOR-ONLY; it does not affect a real device).

Vulkan on Android crashed on screen lock/unlock until **13.2.0**
(maplibre-native #4303 — `AndroidVulkanRendererBackend`, Vulkan-only, "OpenGL
works fine"), and until **13.3.0** it recreated the whole renderer backend on
every surface-create (#4324, PR #4323). We shipped 12.3.1, i.e. below both, and
a field trip produced four `SIGABRT`s on resume, each preceded by a storm of
`vk::Queue::submit: ErrorDeviceLost` (Sentry `REACT-NATIVE-5`) plus the
non-fatal form: a map that renders nothing while the scale bar still tracks the
camera, because `onRegionIsChanging` keeps firing on a dead device.

## Decision

- **MapLibre runs the Vulkan backend on Android** (app.json MLRN plugin
  `nativeVariant: "vulkan"`). Don't revert without retesting labels on emulator
  + physical device.
- **The native SDK pin is a safety floor, not a default** (`nativeVersion`,
  13.5.0 at the time of writing; MLRN 11.3.6's own default is 13.2.0).
  **Never lower this pin below 13.3.0, and treat any new `ErrorDeviceLost` in
  Sentry as this bug returning.**

## Consequences

- **Positive:** symbol layers render on emulators; the lock/unlock and
  surface-create crashes are below the floor.
- **Negative:** Not recorded.
- **Neutral:** the pin must be re-read on every MLRN upgrade, since MLRN's own
  default sits below the floor.

## Alternatives considered

- The OpenGL backend: rejected because it renders no symbol layers on
  emulators (#3617).
- MLRN's default native version (13.2.0): below the 13.3.0 floor (#4324).

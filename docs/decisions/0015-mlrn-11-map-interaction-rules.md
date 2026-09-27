# 0015. MLRN 11 (Fabric): the map interaction rules that follow from it

- **Date:** 2026-08-18
- **Status:** Accepted
- **Supersedes:** —

## Context

**MLRN 11 is a Fabric library; MLRN 10 was not.** 10.4.2 shipped no
`codegenConfig` and nine legacy `ViewManager`s, so with `newArchEnabled: true`
the entire map ran through RN's legacy interop layer (visible in logcat as
`Could not find generated setter for class …MLRNPointAnnotationManager`).
11.3.6 has real Fabric components. The API is GL-JS-shaped now —
`Map`/`GeoJSONSource`/`<Layer type="…">`, `center`/`zoom`/`bearing`/`duration`
on camera stops, and every event arrives as `event.nativeEvent` — so anything
written against an MLRN 10 example needs translating.

The upgrade changed several behaviours silently. Each rule below is one of them,
and each shipped broken at least once.

## Decision

**Layer styles go in through the deprecated `style` prop, on purpose.** MLRN 11
wants the spec's `paint`/`layout` split, but our generated Protomaps defs
(`scripts/basemap/generate-style.mjs`) and `buildTopoVectorLayerDefs` both emit
one merged camelCase object for web parity, and MLRN splits it for us. That prop
goes in MLRN v12; the generator and the two `Layer` call sites
(`ProtomapsLayers.tsx`, `TopoVectorOverlay.tsx`) have to move together when it
does.

**Every `<Layer>` needs a `key`, and it must equal its `id`.** MLRN 11 freezes a
layer's id on first render (`useFrozenId`) and throws "`id` cannot be changed"
if a fiber is later rendered with a different one — which takes the whole app to
the root error boundary. The trap is that `cloneReactChildrenWithProps` FILTERS
FALSY CHILDREN OUT before `Children.map`, so a conditional layer does not hold
its slot: keyless siblings of the same type reconcile by index, and React reuses
one layer's fiber for the next one along. Shipped this way once — the
user-location beam is conditional on there being a heading, so pressing locate
and then leaving the map crashed the app. Guarded by `src/map/layerKeys.test.ts`,
which scans every `.tsx` for a `<Layer>` without a key.

**Never call an imperative map command before the map exists.** MLRN 11's native
side is written with non-null assertions — `MLRNMapView.kt` alone has 32
`mapLibreMap!!`, including `getBounds()`. Calling one before the map is created
throws a Kotlin NPE, which React Native promotes to a HOST exception and tears
down the whole React instance: the screen goes blank and the app has to be
killed, and because it is not a JS error the root error boundary never sees it.
`RegionDownloadScreen` asked for `getBounds()` on mount and so raced the map —
"save maps offline" worked or blanked the app depending on who won. Gate any
such call on `onDidFinishLoadingMap`, and prefer the bounds carried on
`onRegionDidChange` over asking at all.

**A source's press bubbles to the MAP in MLRN 11.** MLRN 10 let a source's
`onPress` consume the tap; MLRN 11 emits it on the source AND on the `Map`
(documented on `MapProps.onPress`). Tapping a place, route, track or import
therefore also ran the map's handler and opened the "This point" sheet on top of
the one the user asked for — and with a point tool armed it placed a point at
the same tap. Every pressable source handler calls `stopSourcePress(event)`
(`src/map/sourcePress.ts`) FIRST, before any early return: a handler that bails
without calling it still leaks the tap. Not enforced by a test — the handlers
are passed by reference, so a source scan cannot see them — so it is a
convention to check when adding a pressable source.

**A tap on an anchor is `ViewAnnotation`'s `onPress`, plus a map-press hit test
for the ring outside the handle.** (Corrected 2026-08-24 — the earlier version
of this rule had it the other way round and was wrong.) On Android a
`ViewAnnotation` is a `Symbol`, and `SymbolManager`'s click listener returns
`true` (`MLRNMapView.kt` `createSymbolManager`), so a tap inside the rasterised
34 dp handle is CONSUMED and `MLRNMapView.onMapClick` never runs. Three things
follow, and all three were broken until that batch:
- Wire **`onPress`**, never `onSelect`. `MLRNPointAnnotation.onSelect` fires
  only on the annotation's false→true transition and nothing here ever deselects
  it, so a second tap on the same anchor delivered no event at all. `onPress`
  fires on every tap (`MLRNPointAnnotation.kt`).
- `anchorIndexAtPress` (`src/map/anchorHit.ts`, tested) only ever sees the ring
  BETWEEN the 17 dp handle and `ANCHOR_GRAB_DP` (22 dp, a 44 dp target). It is
  not dead weight — it is the margin — but it is not the main path, and when the
  tolerance was smaller than the handle it could not fire at all.
- **Tolerances are DP and come from `degreesPerDp` (`src/map/scaleBar.ts`,
  tested).** MapLibre Native is handed the view size divided by the display
  density, so its screen space is density-independent and its zoom is 512-based.
  The anchor reach inlined a 256-based world AND divided by `PixelRatio.get()`;
  the two errors did not cancel, and a stated 20 dp measured under 15 dp.
  Nothing may write its own power of two for this.

**A drag under the touch slop is a TAP.** `ViewAnnotation` is `draggable`, so a
finger that moves two pixels while tapping arrives as a drag, and committing it
moved the anchor a metre and selected nothing — the operator's report that
deleting a point was "virtually impossible". `RouteDraftLayer` gates the drag on
`dragIsTap` (`anchorHit.ts`, `ANCHOR_TAP_SLOP_DP` = Android's own 8 dp): below
the slop nothing previews, nothing commits, and the gesture is forwarded as a
press. Past the slop it stays a drag for the rest of the gesture, so a finger
that wanders out and back still commits. The drop's own press is suppressed by a
WINDOW (`ANCHOR_DROP_SELECT_MS`), not by a flag — the flag it replaces was
cleared only by the next press, so a drop that produced none stayed armed and
swallowed the user's next real tap.

**A press-and-hold on an anchor reaches the MAP as well as the annotation.**
MLRN 10's `PointAnnotation` consumed the touch that starts a drag; MLRN 11's
`ViewAnnotation` does not, so the map's `onLongPress` also fires and the route
tool inserted a point where the finger went down — dragging an anchor left a
spare one behind. `insertAnchorNear` now bails on a press that lands on an
existing anchor (`src/map/anchorHit.ts`, tested).

**An omitted `easing` is a JUMP in MLRN 11.** MLRN 10's `animationMode`
defaulted to EASE; the native prop now declares
`WithDefault<NativeEasingMode, "none">`, so a stop naming only a duration
teleports. Every camera write goes through `setCameraStop`, which applies
`withDefaultEasing` (`src/map/cameraStop.ts`, tested) to restore the old
behaviour — but only when there is a duration to ease over, because a
`duration: 0` stop (every pinch frame, the post-settle reset) is a deliberate
jump. A camera call that bypasses that helper must pass `easing` itself.

## Consequences

- **Positive:** the map runs on real Fabric components instead of the legacy
  interop layer.
- **Negative:** the `style` prop is deprecated and goes in MLRN v12, taking the
  generator and both `Layer` call sites with it; `stopSourcePress` is a
  convention with no executable check.
- **Neutral:** MLRN 10 examples need translating to the GL-JS-shaped API.

## Alternatives considered

- Splitting styles into `paint`/`layout` now: not taken, because the generated
  Protomaps defs and `buildTopoVectorLayerDefs` emit one merged object for web
  parity.
- Suppressing the drop's press with a flag: replaced by a window, because the
  flag stayed armed when a drop produced no press.
- An "is a drag running" flag for the long-press: rejected for a hit test,
  because the native long-press and the drag-start callback race, and position
  cannot arrive too late.

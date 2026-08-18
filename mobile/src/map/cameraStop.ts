import type { CameraStop } from "@maplibre/maplibre-react-native";

// AN OMITTED `easing` IS A JUMP IN MLRN 11.
//
// MLRN 10's `animationMode` defaulted to EASE, so a stop that named only a
// duration animated. The native prop now declares
// `WithDefault<NativeEasingMode, "none">` (CameraNativeComponent.ts), so the
// same stop teleports — observed on device as an instant snap when switching
// between follow and course-up, and it applied equally to the place-search
// recentre, the fix recentre and the north-up reset.
//
// Pure, and its own module, so the rule has a test: MapScreen's `setCameraStop`
// is a callback inside a 4000-line component that cannot be imported without a
// native map.
export function withDefaultEasing(stop: CameraStop): CameraStop {
  // A `duration: 0` stop is a deliberate jump — every frame of a pinch (the
  // fingers ARE the animation) and the post-settle stop reset. Easing those
  // would be meaningless at best and a fight with the gesture at worst.
  if (stop.easing !== undefined || (stop.duration ?? 0) <= 0) return stop;
  return { ...stop, easing: "ease" };
}

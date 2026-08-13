// The map's JS-driven two-finger gesture, and the one-finger drag that ends a
// follow mode. Lifted out of MapScreen.tsx unchanged (MCH-004): it owns its own
// refs, it is the whole of the touch-responder contract, and the maths at the
// top is now testable on its own.
//
// PRIVACY: coordinates pass through here (the fix the camera is pinned to) and
// are never logged.
import { useCallback, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { GestureResponderEvent } from "react-native";
import type { CameraStop } from "@maplibre/maplibre-react-native";

import { normalizeBearing } from "./heading";

/** Follow modes the locate button cycles through; the gesture ends them. */
export type FollowMode = "off" | "follow" | "course-up";

/**
 * Zoom range the JS-driven pinch may reach. Not MapLibre's own 0-22: below ~2
 * the whole world is on screen twice and above ~20 every source is overzoomed,
 * and unlike a native gesture this one has no built-in stops of its own.
 */
export const MIN_PINCH_ZOOM = 2;
export const MAX_PINCH_ZOOM = 20;

/**
 * How far one finger must travel before it counts as a pan rather than a tap —
 * the drag that means "stop following".
 *
 * Android's own `ViewConfiguration` touch slop is 8dp, and matching it is the
 * point: while following, MapLibre's pan is disabled and this screen decides
 * when a drag has begun, so anything larger would feel like the map resisting
 * and anything smaller would drop follow on the wobble in a tap.
 */
export const PAN_SLOP_DP = 8;

type Touch = { pageX: number; pageY: number };

export function touchSeparation(touches: Touch[]): number {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/** Angle of the line between the two fingers, degrees, clockwise-positive. */
export function touchAngleDeg(touches: Touch[]): number {
  const [a, b] = touches;
  return (Math.atan2(b.pageY - a.pageY, b.pageX - a.pageX) * 180) / Math.PI;
}

/**
 * Doubling the separation is one zoom level, which is what the gesture means
 * everywhere else on the phone. Clamped to the range above.
 */
export function pinchZoomLevel(
  startZoom: number,
  startDistance: number,
  distance: number,
): number {
  return Math.min(
    MAX_PINCH_ZOOM,
    Math.max(MIN_PINCH_ZOOM, startZoom + Math.log2(distance / startDistance)),
  );
}

/**
 * Screen y grows downward, so the finger angle increases CLOCKWISE and the
 * camera bearing (which way the top of the screen faces) has to move the other
 * way for the map to turn with the fingers.
 */
export function pinchHeading(
  startHeading: number,
  startAngleDeg: number,
  angleDeg: number,
): number {
  return normalizeBearing(startHeading - (angleDeg - startAngleDeg));
}

type PinchStart = {
  distance: number;
  angleDeg: number;
  zoom: number;
  heading: number;
};

/**
 * Pinch-to-zoom while following, driven from JS instead of by MapLibre.
 *
 * MapLibre zooms about the midpoint between the fingers, and there is no way
 * to tell it otherwise from React Native: the focal point it uses is
 * `constantFocalPoint` if the host app set one and the gesture's own focus
 * otherwise, and MLRN exposes no way to set the former. So a pinch always
 * translates the map, and "keep following" could only ever mean letting it
 * drift and then yanking it back when the fingers lifted — which is what the
 * first version did, and it read as the map fighting you: the view slid, then
 * snapped, and the zoom it settled on was not always the one you had let go
 * at, because the corrective stop and the gesture's own inertia both wrote
 * the camera.
 *
 * Instead the root view CLAIMS the responder the moment a second finger lands
 * while following. MapLibre gets an ACTION_CANCEL, never starts a scale
 * gesture, and this drives the camera directly: centre pinned to the latest
 * fix, zoom from the ratio of finger separation to where it started. Nothing
 * translates, nothing snaps back, and the zoom on release is exactly the last
 * one written.
 *
 * Only while following, and only for two fingers — everywhere else MapLibre
 * keeps its gestures untouched.
 */
export function useMapPinchGesture(params: {
  /** Live follow mode. The ref, not the state: the next touch event arrives
   * long before a commit. */
  followModeRef: MutableRefObject<FollowMode>;
  setFollowMode: (mode: FollowMode) => void;
  latestFix: RefObject<[number, number] | null>;
  /** Live camera, kept by MapScreen's `setCameraStop`. */
  zoomRef: MutableRefObject<number>;
  headingRef: MutableRefObject<number>;
  /** A locked map scales and nothing else. */
  northUpLockedRef: RefObject<boolean>;
  /** Set once the user has moved the camera themselves. */
  userMovedCamera: MutableRefObject<boolean>;
  setCameraStop: (stop: CameraStop) => void;
}): {
  /**
   * True for as long as a driven two-finger gesture is running. State rather
   * than a ref because it drives MapView props — one commit at the start of
   * the gesture and one at the end, not one per frame.
   */
  twoFingerLock: boolean;
  /**
   * The two-finger gesture this screen is currently driving, or null.
   *
   * Non-null IS the answer to "is the user scaling/rotating rather than
   * panning", and it is the only thing the follow-mode guard consults. It is
   * set the instant a second finger lands and cleared on release, so it cannot
   * be confused by MapLibre's own event stream — which is what the old
   * max-fingers counter was, and why follow kept dropping mid-pinch: the
   * counter was reset by `onRegionDidChange`, and MapScreen's own camera
   * writes fire that on every move.
   */
  pinchStart: MutableRefObject<PinchStart | null>;
  observeTouches: (event: GestureResponderEvent, isTouchStart: boolean) => boolean;
  handlePinchMove: (event: GestureResponderEvent) => void;
  endPinch: () => void;
} {
  const {
    followModeRef,
    setFollowMode,
    latestFix,
    zoomRef,
    headingRef,
    northUpLockedRef,
    userMovedCamera,
    setCameraStop,
  } = params;

  /**
   * Where the single finger now down first landed, or null when none is.
   *
   * While following, MapLibre has no pan gesture to detect a drag with, so the
   * drag that means "stop following" is measured from here instead.
   */
  const panOrigin = useRef<{ x: number; y: number } | null>(null);
  /**
   * Whether the gesture in progress has had two fingers on it at any point.
   *
   * Lifting one finger of a pinch hands the responder back to the capture
   * handlers with the OTHER finger still down, which arrives looking exactly
   * like a one-finger drag — from an origin set where the first finger of the
   * pinch landed, so a slop breach is guaranteed and follow mode was dropped at
   * the end of nearly every pinch. A pinch is ONE gesture until the last finger
   * lifts; its tail is not a pan.
   */
  const gestureHadTwoFingers = useRef(false);
  const pinchStart = useRef<PinchStart | null>(null);
  const [twoFingerLock, setTwoFingerLock] = useState(false);

  const shouldDrivePinch = useCallback(
    (touchCount: number): boolean => {
      return (
        followModeRef.current !== "off" && touchCount >= 2 && latestFix.current != null
      );
    },
    [followModeRef, latestFix],
  );

  const observeTouches = useCallback(
    (event: GestureResponderEvent, isTouchStart: boolean): boolean => {
      const { touches } = event.nativeEvent;
      // ONE FINGER: watch it for a drag, because while following MapLibre is not
      // watching for one. Its pan is off (see `scrollEnabled`), so the drag that
      // means "stop following" has to be recognised here and answered by
      // handing pan back, rather than by MapLibre panning and this screen
      // noticing afterwards.
      //
      // Anchored on a ONE-FINGER touch START, the only event that says "a new
      // gesture begins". There is no matching end — these two capture props
      // fire on start and move only, which is what left the old `firstTouchAt`
      // holding a timestamp from a gesture several seconds back — so every
      // reset here has to hang off a start.
      if (touches.length > 1) gestureHadTwoFingers.current = true;
      if (touches.length === 1) {
        const [only] = touches;
        // A touch start with exactly one finger down is the only thing that
        // begins a gesture; everything else is a continuation of one.
        if (isTouchStart) {
          panOrigin.current = { x: only.pageX, y: only.pageY };
          gestureHadTwoFingers.current = false;
        } else if (
          !gestureHadTwoFingers.current &&
          panOrigin.current !== null &&
          followModeRef.current !== "off" &&
          Math.hypot(
            only.pageX - panOrigin.current.x,
            only.pageY - panOrigin.current.y,
          ) > PAN_SLOP_DP
        ) {
          // The ref as well as the state: `scrollEnabled` needs the render, but
          // everything else in MapScreen reads the ref, and the next touch
          // event arrives long before the commit.
          followModeRef.current = "off";
          setFollowMode("off");
          userMovedCamera.current = true;
        }
      }
      if (!shouldDrivePinch(touches.length)) return false;
      // Hands pitch back as well — the one two-finger gesture MapLibre still has
      // while following. Scale, rotate and pan are already off it.
      setTwoFingerLock(true);
      // Separation of zero (both fingers on the same pixel) would make every
      // later ratio infinite; let MapLibre have that gesture instead.
      const distance = touchSeparation(touches);
      if (distance < 1) return false;
      pinchStart.current = {
        distance,
        angleDeg: touchAngleDeg(touches),
        zoom: zoomRef.current,
        heading: headingRef.current,
      };
      return true;
    },
    [
      followModeRef,
      headingRef,
      setFollowMode,
      shouldDrivePinch,
      userMovedCamera,
      zoomRef,
    ],
  );

  const handlePinchMove = useCallback(
    (event: GestureResponderEvent) => {
      const start = pinchStart.current;
      const { touches } = event.nativeEvent;
      if (!start || touches.length < 2 || !latestFix.current) return;
      const distance = touchSeparation(touches);
      if (distance < 1) return;
      const zoom = pinchZoomLevel(start.zoom, start.distance, distance);
      zoomRef.current = zoom;
      // ROTATION IS PART OF THE SAME GESTURE. No real pinch is a pure scale —
      // fingers always turn a few degrees — and while MapLibre owned that
      // rotation it was a second camera driver on the same two fingers, which
      // is what made follow mode let go "sometimes": the pinch stayed locked,
      // the incidental twist did not. Both axes are driven here now, from one
      // start reference, so a twist is either applied or ignored on purpose.
      //
      // Course-up is the deliberate exception: its heading belongs to the
      // compass, so two fingers there scale and nothing else. Turning the map
      // by hand while it is meant to be facing where you are looking is two
      // answers to one question.
      // A locked map scales and nothing else — the same shape as course-up's
      // exception, for the opposite reason. Read through a ref: this callback is
      // memoised for the life of the gesture handlers.
      const rotating = followModeRef.current === "follow" && !northUpLockedRef.current;
      const heading = rotating
        ? pinchHeading(start.heading, start.angleDeg, touchAngleDeg(touches))
        : null;
      if (heading != null) headingRef.current = heading;
      setCameraStop({
        // The fix, unmoved — the whole point of following, and now the only
        // thing that ever writes this screen's centre during a pinch. Nothing
        // else can have moved the map to recover from: MapLibre's pan is off
        // for the whole of follow mode.
        centerCoordinate: latestFix.current,
        zoomLevel: zoom,
        ...(heading != null ? { heading } : {}),
        // No animation: the fingers ARE the animation. Anything else lags the
        // gesture and reads as the map resisting.
        animationDuration: 0,
      });
    },
    [followModeRef, headingRef, latestFix, northUpLockedRef, setCameraStop, zoomRef],
  );

  const endPinch = useCallback(() => {
    pinchStart.current = null;
    setTwoFingerLock(false);
  }, []);

  return { twoFingerLock, pinchStart, observeTouches, handlePinchMove, endPinch };
}

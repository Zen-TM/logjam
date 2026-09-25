// The map's record control: start a recording, and — once one is running — say
// so and open its stats.
//
// It is the same size as the search pill, in the opposite top corner, because
// what it mostly does is REPORT. The recording HUD used to hold that job from a
// card in the top notice stack, which cost a third of the map for the whole
// trip to say one bit ("still going"). A pulsing dot says the same bit for the
// price of one button, and the numbers move behind a tap.
//
// Three states, and the state is readable without reading a word: a hollow ring
// is idle, a filled ring pulsing is recording, a filled ring holding still is
// paused.
//
// The long press is not a shortcut, it is the ONLY one-gesture way to stop —
// finishing must not need the panel found first. Wet hands, cold hands, and
// nothing in this app is worse than a recording that will not stop.
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";

import { SEARCH_SIZE } from "../map/mapChrome";
import { radius, theme } from "../theme";

/** One breath. Slow on purpose: at the map's scale this reads as alive rather
 *  than as an alarm, and it is a redraw every two seconds, not every frame of
 *  a fast blink. */
const PULSE_MS = 2000;

const RING = 26;
const CORE = 12;

export function RecordButton({
  state,
  animate,
  onPress,
  onLongPress,
}: {
  /** null = nothing is recording. */
  state: "recording" | "paused" | null;
  /**
   * Whether the pulse may run — the map's own `mapFocused && appActive`. A
   * looping animation behind a dark screen or another tab is frames nobody
   * sees, on the one screen that stays open for a whole trip (mobile/CLAUDE.md,
   * Battery).
   */
  animate: boolean;
  onPress: () => void;
  /** Absent while nothing is recording — there is nothing to finish. */
  onLongPress?: () => void;
}) {
  const recording = state === "recording";
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!recording || !animate) {
      // Reset rather than freeze: a halo stopped mid-breath at half opacity
      // reads as a third state that means nothing.
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      // Outward only: one breath to full spread, then the loop snaps the halo
      // back to its start and breathes out again — no "in" leg, so the ring
      // reads as a beat rather than a breathing circle.
      Animated.timing(pulse, {
        toValue: 1,
        duration: PULSE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [recording, animate, pulse]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        state === null
          ? "Record track"
          : state === "recording"
            ? "Recording — tap for stats, hold to finish."
            : "Recording paused — tap for stats, hold to finish."
      }
      style={styles.button}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {/* Behind the ring, and driven by scale + opacity only, so the whole
          breath runs on the native driver. */}
      {state === "recording" ? (
        <Animated.View
          style={[
            styles.halo,
            {
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.6, 0],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.7],
                  }),
                },
              ],
            },
          ]}
          pointerEvents="none"
        />
      ) : null}
      {/* Drawn rather than a Feather glyph: the icon font gives no control over
          ring thickness or a nested fill. */}
      <View style={[styles.ring, state !== null && styles.ringLive]}>
        {state !== null ? <View style={styles.core} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Mirrors MapSearchBar's pill: the two corners of the map's top edge have to
  // read as one family, not as a button and a lookalike.
  //
  // ONE background in every state. The active state used to swap it for the
  // warning colour at 22% alpha, which is translucent — the map showed straight
  // through the button over a busy raster, and the control stopped reading as a
  // control at exactly the moment it matters most. The ring, the core and the
  // pulse already carry the state.
  button: {
    width: SEARCH_SIZE,
    height: SEARCH_SIZE,
    borderRadius: SEARCH_SIZE / 2,
    backgroundColor: theme.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: RING,
    height: RING,
    borderRadius: radius.pill,
    backgroundColor: theme.warning,
  },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    borderColor: theme.textPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  ringLive: { borderColor: theme.warning },
  core: {
    width: CORE,
    height: CORE,
    borderRadius: CORE / 2,
    backgroundColor: theme.warning,
  },
});

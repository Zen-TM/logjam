import { Pressable, View } from "react-native";

import { opacity, radius, slopTo, makeStyles } from "../theme";

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 24;
const THUMB = 16;
const GAP = (TRACK_HEIGHT - THUMB) / 2;

// Themed on/off switch — the standard visibility/enable control across the
// layer sheet (overlays, imports, tracks, GeoPDFs) and settings. Drawn by hand
// rather than as RN's native Switch, because that cannot be given a track and
// thumb that both clear 3:1 in every scheme: when off the track is `lineStrong`
// and the thumb the card, when on the track is the accent and the thumb
// `onFill`, the same roles as Logjam Web's `Toggle`. Same prop names as it; a
// switch with a title of its own is a `SwitchRow`, which makes the whole row
// the target.
export function Toggle({
  checked,
  onChange,
  disabled = false,
  accessibilityLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled }}
      onPress={() => onChange(!checked)}
      disabled={disabled}
      hitSlop={{
        top: slopTo(TRACK_HEIGHT),
        bottom: slopTo(TRACK_HEIGHT),
        left: slopTo(TRACK_WIDTH),
        right: slopTo(TRACK_WIDTH),
      }}
      style={({ pressed }) => [
        styles.track,
        checked ? styles.trackOn : styles.trackOff,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View
        style={[styles.thumb, checked ? styles.thumbOn : styles.thumbOff]}
      />
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    justifyContent: "center",
    paddingHorizontal: GAP,
  },
  trackOff: { backgroundColor: theme.lineStrong },
  trackOn: { backgroundColor: theme.accent },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.pill },
  thumbOff: { backgroundColor: theme.card, alignSelf: "flex-start" },
  thumbOn: { backgroundColor: theme.onFill, alignSelf: "flex-end" },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
}));

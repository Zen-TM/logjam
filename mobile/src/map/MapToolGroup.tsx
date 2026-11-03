// The action column's tool group: one `+` button that opens the map tools as a
// short list of LABELLED pills beside the column, one per row, from the + row
// down. The tools themselves are declared once (`MAP_TOOLS`, @logjam/shared),
// so both clients' trays hold the same ones in the same order with the same
// words; Logjam GPS draws the ones it has. Guard: `mapTools.test.ts`.
//
// Beside the column, not above it: the column is bottom-anchored against a
// CHROME_BOTTOM that is deliberately a constant (mapChrome.ts), so growing
// upward walks into the search pill and growing the column is the "every pinned
// element is a piece of map the user can't see" tax shared/DESIGN.md §11 warns
// about. Beside it, the tray sits on the rows of the layers and locate buttons
// and costs only map the pills themselves cover, and a pill grows with the
// system text size instead of clipping.
//
// The group closes as soon as a tool arms: the HUD in the top notice stack is
// then the thing telling the user what mode they are in, and leaving an open
// tray behind it would be two answers to the same question.
import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  Text,
  View,
} from "react-native";

import { FAB_ICON, FAB_SIZE, CHROME_GAP } from "./mapChrome";
import { mapTools, type MapToolIdOn } from "@logjam/shared";

import { makeStyles, spacing, useTheme } from "../theme";
import { Icon } from "../ui";

export type MapTool = MapToolIdOn<"gps">;

export const TOOLS = mapTools("gps");

/** Time for the tray to slide out from under the + button. */
const SLIDE_MS = 160;

export function MapToolGroup({
  open,
  activeTool,
  side = "right",
  onToggleOpen,
  onPickTool,
}: {
  open: boolean;
  /** The armed tool, if any — its pill stays lit while it runs. */
  activeTool: MapTool | null;
  /**
   * Which edge the action column is on (Settings → Map). The tray opens AWAY
   * from it: the other side is the only free map.
   */
  side?: "right" | "left";
  onToggleOpen: () => void;
  onPickTool: (tool: MapTool) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => alive && setReduceMotion(on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  // One value drives the whole tray: it slides out from behind the + and
  // fades in on the native driver, or just appears under reduced motion.
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: reduceMotion ? 0 : SLIDE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [open, progress, reduceMotion]);
  const dir = side === "right" ? 1 : -1;
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [dir * (FAB_SIZE + CHROME_GAP), 0],
  });

  return (
    <View style={styles.row}>
      {TOOLS.map((tool, k) => {
        const armed = activeTool === tool.id;
        return (
          <Animated.View
            key={tool.id}
            pointerEvents={open ? "auto" : "none"}
            style={[
              styles.toolSlot,
              // Level with the + (k = 0) or the buttons below it, and clear of
              // the column by one gap.
              { top: k * (FAB_SIZE + spacing(1)) },
              side === "left"
                ? { left: FAB_SIZE + spacing(1) }
                : { right: FAB_SIZE + spacing(1) },
              { opacity: progress, transform: [{ translateX }] },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              style={[styles.pill, armed && styles.controlActive]}
              onPress={() => onPickTool(tool.id)}
            >
              <Icon
                idea={tool.icon}
                size={FAB_ICON}
                color={armed ? theme.onFill : theme.text}
              />
              <Text
                style={[styles.pillLabel, armed && { color: theme.onFill }]}
                numberOfLines={1}
              >
                {tool.label}
              </Text>
            </Pressable>
          </Animated.View>
        );
      })}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide map tools" : "Map tools"}
        accessibilityState={{ expanded: open }}
        style={[
          styles.controlButton,
          (open || activeTool) && styles.controlActive,
        ]}
        onPress={onToggleOpen}
      >
        <Icon
          idea={open ? "close" : "add"}
          size={FAB_ICON}
          color={open || activeTool ? theme.onFill : theme.text}
        />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  // The group occupies exactly one button's width in the column. The pills are
  // ABSOLUTE children hanging off its side, so opening the tray can't widen the
  // row and make the rest of the action column jump.
  row: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  toolSlot: { position: "absolute", height: FAB_SIZE },
  // Mirrors MapScreen's controlButton/controlActive exactly — the + has to
  // read as the same column.
  controlButton: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: theme.card,
    alignItems: "center",
    justifyContent: "center",
  },
  controlActive: { backgroundColor: theme.accent },
  pill: {
    minHeight: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: theme.card,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingHorizontal: spacing(2),
  },
  pillLabel: { ...textRole.body, color: theme.text },
}));

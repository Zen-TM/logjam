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
  useWindowDimensions,
} from "react-native";

import { FAB_ICON, FAB_SIZE, CHROME_GAP } from "./mapChrome";
import { mapTools, type MapToolIdOn } from "@logjam/shared";

import { makeStyles, spacing, useTheme } from "../theme";
import { Icon } from "../ui";

export type MapTool = MapToolIdOn<"gps">;

export const TOOLS = mapTools("gps");

/** Time for the tray to slide out from under the + button. */
const SLIDE_MS = 160;

/** The `+` button, at the top of the action column. */
export function MapToolGroup({
  open,
  activeTool,
  onToggleOpen,
}: {
  open: boolean;
  /** The armed tool, if any — the button stays lit while it runs. */
  activeTool: MapTool | null;
  onToggleOpen: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  return (
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
  );
}

/**
 * The tools themselves, drawn beside the action column from its top row down,
 * as a SIBLING of the column rather than inside it: Android hands a touch only
 * to a view inside its parent's bounds, and a pill hanging out of the column
 * fell through to the map beneath, which took the press as a point.
 * `top` is the column's own top edge; `side` is the column's edge, and the tray
 * opens away from it.
 */
export function MapToolTray({
  open,
  activeTool,
  side,
  top,
  onPickTool,
}: {
  open: boolean;
  activeTool: MapTool | null;
  side: "right" | "left";
  top: number;
  onPickTool: (tool: MapTool) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  // The room beside the column: each pill keeps its own width and sits against
  // the column, so a label never squeezes to an ellipsis.
  const { width: windowWidth } = useWindowDimensions();
  const room = windowWidth - FAB_SIZE - CHROME_GAP * 2 - spacing(1);

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

  // One value drives the whole tray: it slides out from the column and fades
  // in on the native driver, or just appears under reduced motion.
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
    <Animated.View
      pointerEvents={open ? "box-none" : "none"}
      style={[
        styles.tray,
        { top, width: room, [side]: CHROME_GAP + FAB_SIZE + spacing(1) },
        {
          height: TOOLS.length * FAB_SIZE + (TOOLS.length - 1) * spacing(1),
          opacity: progress,
          transform: [{ translateX }],
        },
      ]}
    >
      {TOOLS.map((tool) => {
        const armed = activeTool === tool.id;
        return (
          <Pressable
            key={tool.id}
            accessibilityRole="button"
            accessibilityLabel={tool.label}
            style={[
              styles.pill,
              { alignSelf: side === "left" ? "flex-start" : "flex-end" },
              armed && styles.controlActive,
            ]}
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
        );
      })}
    </Animated.View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
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
  tray: { position: "absolute", gap: spacing(1) },
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

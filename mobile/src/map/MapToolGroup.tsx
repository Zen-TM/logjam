// The action column's tool group: one `+` button that opens the map tools as a
// short list of LABELLED pills (a label and a line saying what it does) beside
// the column, one per row, from the + row down. The tools themselves are declared once (`MAP_TOOLS`, @logjam/shared),
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
import { Icon, useReduceMotion } from "../ui";

export type MapTool = MapToolIdOn<"gps">;

export const TOOLS = mapTools("gps");

/** One pill's slide or fold. The first pill slides out from under the +, each
 *  next one falls out from under the one above, a STAGGER_MS apart: the last of
 *  four lands by 200 ms (shared/DESIGN.md §15). Closing is one
 *  quick fade, together. Logjam Web's tray runs the same numbers in CSS. */
const PILL_MS = 110;
const STAGGER_MS = 30;
const CLOSE_MS = 100;

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
  onTouchStart,
}: {
  open: boolean;
  activeTool: MapTool | null;
  side: "right" | "left";
  top: number;
  onPickTool: (tool: MapTool) => void;
  /** A touch starting on any pill: the screen tells it from one outside. */
  onTouchStart: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  // The room beside the column: each pill keeps its own width and sits against
  // the column, so a label never squeezes to an ellipsis.
  const { width: windowWidth } = useWindowDimensions();
  const room = windowWidth - FAB_SIZE - CHROME_GAP * 2 - spacing(1);

  const reduceMotion = useReduceMotion();

  // One value per pill, all on the native driver; none under reduced motion.
  const [progress] = useState(() => TOOLS.map(() => new Animated.Value(0)));
  useEffect(() => {
    const run = Animated.parallel(
      progress.map((value, i) =>
        Animated.timing(value, {
          toValue: open ? 1 : 0,
          duration: reduceMotion ? 0 : open ? PILL_MS : CLOSE_MS,
          delay: reduceMotion || !open ? 0 : i * STAGGER_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    );
    run.start();
    return () => run.stop();
  }, [open, progress, reduceMotion]);
  const dir = side === "right" ? 1 : -1;

  return (
    <View
      onTouchStart={onTouchStart}
      pointerEvents={open ? "box-none" : "none"}
      style={[
        styles.tray,
        { top, width: room, [side]: CHROME_GAP + FAB_SIZE + spacing(1) },
      ]}
    >
      {TOOLS.map((tool, i) => {
        const armed = activeTool === tool.id;
        const value = progress[i]!;
        const slide = value.interpolate({
          inputRange: [0, 1],
          outputRange: [dir * (FAB_SIZE + CHROME_GAP), 0],
        });
        const fold = value.interpolate({
          inputRange: [0, 1],
          outputRange: [-(FAB_SIZE + spacing(1)), 0],
        });
        return (
          <Animated.View
            key={tool.id}
            style={{
              alignSelf: side === "left" ? "flex-start" : "flex-end",
              // Earlier pills over later ones, so a pill falls out from
              // UNDER the one above it.
              zIndex: TOOLS.length - i,
              opacity: value,
              transform: [
                i === 0 ? { translateX: slide } : { translateY: fold },
              ],
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              accessibilityHint={tool.description}
              style={[styles.pill, armed && styles.controlActive]}
              onPress={() => onPickTool(tool.id)}
            >
              <Icon
                idea={tool.icon}
                size={FAB_ICON}
                color={armed ? theme.onFill : theme.text}
              />
              <View style={styles.pillText}>
                <Text
                  style={[styles.pillLabel, armed && { color: theme.onFill }]}
                  numberOfLines={1}
                >
                  {tool.label}
                </Text>
                <Text
                  style={[
                    styles.pillDescription,
                    armed && { color: theme.onFill },
                  ]}
                >
                  {tool.description}
                </Text>
              </View>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
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
    paddingVertical: spacing(0.5),
  },
  pillText: { flexShrink: 1 },
  pillLabel: { ...textRole.body, color: theme.text },
  pillDescription: { ...textRole.meta, color: theme.textMuted },
}));

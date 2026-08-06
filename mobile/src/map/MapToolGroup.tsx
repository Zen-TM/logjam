// The action column's tool group: one `+` button that expands SIDEWAYS into the
// map tools.
//
// Sideways, not upward, because the column is bottom-anchored against a
// CHROME_BOTTOM that is deliberately a constant (mapChrome.ts) — growing
// upward walks the tools into the search pill, and growing the column itself
// is exactly the "every pinned element is a piece of map the user can't see"
// tax DESIGN.md §8 warns about. One button costs one button's worth of map no
// matter how many tools live behind it.
//
// The group closes as soon as a tool arms: the HUD in the top notice stack is
// then the thing telling the user what mode they are in, and leaving an open
// tray behind it would be two answers to the same question.
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";

import { FAB_ICON, FAB_SIZE, CHROME_GAP } from "./mapChrome";
import { theme } from "../theme";

export type MapTool = "measure" | "route";

/**
 * Icon family per tool. Feather has no ruler in its 286 glyphs, and the nearest
 * stand-ins (maximize-2, git-commit) read as "resize" and "commit" rather than
 * "measure" — so measure borrows MaterialCommunityIcons, which ships inside
 * @expo/vector-icons already (no new dependency). See DESIGN.md §3.
 */
const TOOLS: {
  id: MapTool;
  label: string;
  family: "feather" | "material";
  icon: string;
}[] = [
  { id: "measure", label: "Measure distance", family: "material", icon: "ruler" },
  { id: "route", label: "Draw a route", family: "feather", icon: "pen-tool" },
];

export function MapToolGroup({
  open,
  activeTool,
  onToggleOpen,
  onPickTool,
}: {
  open: boolean;
  /** The armed tool, if any — its button stays lit while it runs. */
  activeTool: MapTool | null;
  onToggleOpen: () => void;
  onPickTool: (tool: MapTool) => void;
}) {
  // Width, not opacity: the collapsed tray must not eat taps meant for the map.
  const reveal = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(reveal, {
      toValue: open ? 1 : 0,
      duration: 160,
      // Width can't run on the native driver.
      useNativeDriver: false,
    }).start();
  }, [open, reveal]);

  const trayWidth = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TOOLS.length * (FAB_SIZE + CHROME_GAP)],
  });

  return (
    <View style={styles.row}>
      <Animated.View
        style={[styles.tray, { width: trayWidth, opacity: reveal }]}
        pointerEvents={open ? "auto" : "none"}
      >
        {TOOLS.map((tool) => (
          <Pressable
            key={tool.id}
            accessibilityRole="button"
            accessibilityLabel={tool.label}
            style={[
              styles.controlButton,
              activeTool === tool.id && styles.controlActive,
            ]}
            onPress={() => onPickTool(tool.id)}
          >
            {tool.family === "material" ? (
              <MaterialCommunityIcons
                name={tool.icon as never}
                size={FAB_ICON}
                color={theme.textPrimary}
              />
            ) : (
              <Feather
                name={tool.icon as never}
                size={FAB_ICON}
                color={theme.textPrimary}
              />
            )}
          </Pressable>
        ))}
      </Animated.View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide map tools" : "Map tools"}
        accessibilityState={{ expanded: open }}
        style={[styles.controlButton, (open || activeTool) && styles.controlActive]}
        onPress={onToggleOpen}
      >
        <Feather
          name={open ? "x" : "plus"}
          size={FAB_ICON}
          color={theme.textPrimary}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // The group occupies exactly one button's width in the column. The tray is
  // ABSOLUTE so opening it can't widen the row: laid out in flow, its growth
  // pushed the whole action column leftward and every other button visibly
  // jumped when the tools opened.
  row: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  tray: {
    position: "absolute",
    right: FAB_SIZE + CHROME_GAP,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: CHROME_GAP,
    overflow: "hidden",
  },
  // Mirrors MapScreen's controlButton/controlActive exactly — the tray has to
  // read as the same column, not a lookalike.
  controlButton: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: theme.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  controlActive: { backgroundColor: theme.accent },
});

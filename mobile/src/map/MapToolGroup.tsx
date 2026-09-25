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
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
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

/** Time to slide one tool across one button + gap. */
const SLOT_MS = 100;

export function MapToolGroup({
  open,
  activeTool,
  side = "right",
  onToggleOpen,
  onPickTool,
}: {
  open: boolean;
  /** The armed tool, if any — its button stays lit while it runs. */
  activeTool: MapTool | null;
  /**
   * Which edge the action column is on (Settings → Map). The tray opens AWAY
   * from it — sideways is only free space in one direction, and a tray that
   * opened off the screen edge would be a column with invisible tools.
   */
  side?: "right" | "left";
  onToggleOpen: () => void;
  onPickTool: (tool: MapTool) => void;
}) {
  // Each tool slides out from directly UNDER the + button, one after the
  // next, and translateX runs on the native driver — no width animation, no
  // fade.
  //
  // k is MOVE ORDER, not final position: TOOLS[0] (measure) is always the
  // one that starts moving first when OPENING — first to slide out. Because
  // it leads, it also travels the farthest: it doesn't stop when it draws
  // level with where a single tool would rest, it carries on outward while
  // the next tool sets off k slots' worth of time behind it, and the two
  // land in their final slots together. A tool's final rest slot is
  // therefore the REVERSE of k (restSlot, below) — the one that led the
  // whole way out ends up farthest from the +, not nearest — and its travel
  // distance/duration follows the slot it's actually going to, not its move
  // order.
  //
  // CLOSING does not mirror this stagger: every tool sets off at once, at
  // the same speed (duration still scales with the distance a tool has to
  // cover, so px/ms is constant across tools) — each one just stops the
  // moment it reaches behind the +, independently, rather than all landing
  // together on a delay.
  const values = useRef(TOOLS.map(() => new Animated.Value(0))).current;
  const dir = side === "right" ? 1 : -1;
  useEffect(() => {
    const anims = TOOLS.map((_, k) =>
      Animated.timing(values[k], {
        toValue: open ? 1 : 0,
        duration: (TOOLS.length - k) * SLOT_MS,
        delay: open ? k * SLOT_MS : 0,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    Animated.parallel(anims).start();
  }, [open, values]);

  // restSlot is where a tool actually RESTS when open (0 = nearest the +) —
  // the reverse of k, per the move-order comment above. It drives both how
  // far this value has to travel to hide fully behind the + (outputRange)
  // and its resting inset (below — each tool is its own absolutely
  // positioned sibling of the +, not flex-packed inside a shared tray).
  const rendered = TOOLS.map((tool, k) => {
    const restSlot = TOOLS.length - 1 - k;
    return {
      ...tool,
      k,
      restSlot,
      translateX: values[k].interpolate({
        inputRange: [0, 1],
        outputRange: [dir * (restSlot + 1) * (FAB_SIZE + CHROME_GAP), 0],
      }),
    };
  });

  return (
    <View style={styles.row}>
      {rendered.map((tool) => (
        <Animated.View
          key={tool.id}
          pointerEvents={open ? "auto" : "none"}
          style={[
            styles.toolSlot,
            side === "left"
              ? { left: (tool.restSlot + 1) * (FAB_SIZE + CHROME_GAP) }
              : { right: (tool.restSlot + 1) * (FAB_SIZE + CHROME_GAP) },
            // While retracted, the ARMED tool ends up sitting exactly where
            // the + is (translateX carries every tool there, open or not) —
            // it needs to paint ABOVE the + so the user sees which tool is
            // running instead of a bare +, not the other way round. An
            // unarmed tool needs no such promotion: it only ever overlaps
            // the + while closed, when it's fully hidden either way.
            activeTool === tool.id && styles.armedToolSlot,
            { transform: [{ translateX: tool.translateX }] },
          ]}
        >
          <Pressable
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
        </Animated.View>
      ))}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide map tools" : "Map tools"}
        accessibilityState={{ expanded: open }}
        style={[styles.controlButton, (open || activeTool) && styles.controlActive, styles.plusButton]}
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
  // The group occupies exactly one button's width in the column. Every
  // child (each tool, the +) is its own ABSOLUTE sibling so opening the
  // group can't widen the row: laid out in flow, growth pushed the whole
  // action column leftward and every other button visibly jumped when the
  // tools opened. No overflow:hidden either — a closed tool's translateX
  // target lands it exactly on the + button's own box, and it's zIndex
  // (below), not a clip, that decides which one of the three shows.
  row: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  // Each tool's RESTING inset (left/right, set at the call site from
  // restSlot) replaces what used to be flex-packing inside a shared tray —
  // needed once the + had to become a plain sibling (see plusButton) rather
  // than a parent tray's stacking context swallowing the tool's own zIndex.
  toolSlot: {
    position: "absolute",
    top: 0,
    width: FAB_SIZE,
    height: FAB_SIZE,
    zIndex: 0,
    elevation: 0,
  },
  // Mirrors MapScreen's controlButton/controlActive exactly — the tools have
  // to read as the same column, not a lookalike.
  controlButton: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: theme.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  controlActive: { backgroundColor: theme.accent },
  // The + sits between the two: above an unarmed tool retreating past it
  // (so the bare + shows, not a stray dark circle), below the ARMED one
  // (armedToolSlot) so the running tool's icon is what's left showing once
  // it settles, not the +. All three need the SAME positioning scheme
  // (absolute, explicit zIndex/elevation) for Android to honour the order —
  // one of them left as a plain flow sibling still painted on top
  // regardless of zIndex.
  plusButton: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    elevation: 1,
  },
  armedToolSlot: { zIndex: 2, elevation: 2 },
});

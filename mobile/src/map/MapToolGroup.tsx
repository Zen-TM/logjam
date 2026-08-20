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
  // one that starts moving first, in both directions — first to slide out,
  // first to retreat. Because it leads, it also travels the farthest: it
  // doesn't stop when it draws level with where a single tool would rest, it
  // carries on outward while the next tool sets off k slots' worth of time
  // behind it, and the two land in their final slots together. A tool's
  // final rest slot is therefore the REVERSE of k (restSlot, below) — the
  // one that led the whole way out ends up farthest from the +, not
  // nearest — and its travel distance/duration follows the slot it's
  // actually going to, not its move order.
  const values = useRef(TOOLS.map(() => new Animated.Value(0))).current;
  const dir = side === "right" ? 1 : -1;
  useEffect(() => {
    const anims = TOOLS.map((_, k) =>
      Animated.timing(values[k], {
        toValue: open ? 1 : 0,
        duration: (TOOLS.length - k) * SLOT_MS,
        // Same delay either direction — see the comment above: TOOLS[0]
        // leads the motion whether the group is opening or closing.
        delay: k * SLOT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    Animated.parallel(anims).start();
  }, [open, values]);

  // restSlot is where a tool actually RESTS when open (0 = nearest the +) —
  // the reverse of k, per the move-order comment above. Both the tray's DOM
  // order (below: a flex-packed row rests each child at its natural flex
  // position, since translateX resolves to 0 there) and how far this value
  // has to travel to hide fully behind the + (outputRange) come from it.
  const rendered = TOOLS.map((tool, k) => {
    const restSlot = TOOLS.length - 1 - k;
    return {
      ...tool,
      k,
      translateX: values[k].interpolate({
        inputRange: [0, 1],
        outputRange: [dir * (restSlot + 1) * (FAB_SIZE + CHROME_GAP), 0],
      }),
    };
  });
  // DOM order is what actually places a tool in its resting slot — flex-end
  // (side="right") packs the LAST array item nearest the +, flex-start
  // (side="left") packs the FIRST item nearest the + — so whichever side
  // packs toward the +, leave TOOLS order as-is (measure, the farthest-
  // resting tool, first/outermost); the other side reverses it.
  const ordered = side === "right" ? rendered : [...rendered].reverse();

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.tray,
          side === "left"
            ? { left: FAB_SIZE + CHROME_GAP, justifyContent: "flex-start" }
            : { right: FAB_SIZE + CHROME_GAP, justifyContent: "flex-end" },
        ]}
        pointerEvents={open ? "auto" : "none"}
      >
        {ordered.map((tool) => (
          <Animated.View
            key={tool.id}
            style={{ transform: [{ translateX: tool.translateX }] }}
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
      </View>

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
  // The edge it hangs off and the direction it fills come from `side` at the
  // call site; everything else about it is fixed.
  tray: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: CHROME_GAP,
    width: TOOLS.length * FAB_SIZE + (TOOLS.length - 1) * CHROME_GAP,
    // No overflow:hidden: a closed tool's translateX target lands it exactly
    // on the + button's own box (outside the tray, which stops one gap
    // short of it), and it's the + — rendered after this tray, so painted on
    // top — that hides it, not a clip. Clipping at the tray's edge used to
    // cut a tool off a full gap short of the +, which is what made the slide
    // look like it started from empty space instead of from under the +.
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

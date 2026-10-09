import type { ComponentProps } from "react";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { ICONS, type IconIdea } from "@logjam/shared";
import type { StyleProp, TextStyle } from "react-native";

import { theme } from "../theme";

type FeatherName = ComponentProps<typeof Feather>["name"];
type MciName = ComponentProps<typeof MaterialCommunityIcons>["name"];
type Gps = (typeof ICONS)[IconIdea]["gps"];

// The registry's `gps` values are plain strings in `@logjam/shared`, which has
// no icon fonts to check them against. These two lines make the compiler do it
// here: a Feather value Feather lacks, or an `mci:` value MCI lacks, is a type
// error on this file. `icons.test.ts` checks the same at runtime.
type NotFeather = Exclude<Exclude<Gps, `mci:${string}`>, FeatherName>;
type NotMci = Exclude<Gps extends `mci:${infer N}` ? N : never, MciName>;
const GLYPHS_RESOLVE: [NotFeather, NotMci] extends [never, never]
  ? true
  : never = true;
void GLYPHS_RESOLVE;

/**
 * A glyph a kit control can draw: a UI idea from the shared registry, or a
 * USER-PICKED one (a place type's or trip type's Feather key — its own
 * vocabulary, resolved by `placeTypeFeatherIcon`). The wrapper object keeps a
 * picked key from being read as an idea whose name happens to match.
 */
export type Glyph = IconIdea | { picked: FeatherName };

/**
 * The one way a screen draws an icon (DESIGN.md: "One idea, one icon").
 * Decorative by default — hidden from assistive tech, as the row or button that
 * holds it already says what it is. Pass `label` only when the glyph is the
 * whole message (a status mark with no text beside it).
 */
export function Icon({
  idea,
  size = 20,
  color = theme.text,
  label,
  style,
}: {
  idea: Glyph;
  size?: number;
  color?: string;
  label?: string;
  style?: StyleProp<TextStyle>;
}) {
  const a11y = label
    ? {
        accessible: true,
        accessibilityRole: "image" as const,
        accessibilityLabel: label,
      }
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: "no-hide-descendants" as const,
      };
  if (typeof idea !== "string") {
    return (
      <Feather
        name={idea.picked}
        size={size}
        color={color}
        style={style}
        {...a11y}
      />
    );
  }
  const gps: string = ICONS[idea].gps;
  return gps.startsWith("mci:") ? (
    <MaterialCommunityIcons
      name={gps.slice(4) as MciName}
      size={size}
      color={color}
      style={style}
      {...a11y}
    />
  ) : (
    <Feather
      name={gps as FeatherName}
      size={size}
      color={color}
      style={style}
      {...a11y}
    />
  );
}

import type { Feather } from "@expo/vector-icons";
import FEATHER_GLYPHS from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

/**
 * A place type's `iconKey` as a Feather glyph name.
 *
 * The curated keys ARE Feather names (`placeTypeIcons.test.ts` pins that), so
 * this is a pass-through in every normal case. It exists for the abnormal one:
 * the type vocabulary is server-owned and §10.3 is additive, so a NEWER server
 * can name an icon this build has never heard of — and `<Feather>` renders a
 * name it does not know as nothing at all, silently. A row with no glyph reads
 * as a broken row, so an unknown key draws the fallback pin instead. Web does
 * the same thing in `placeTypeIcon.tsx`.
 */
export function placeTypeFeatherIcon(iconKey: string): FeatherName {
  return iconKey in (FEATHER_GLYPHS as Record<string, number>)
    ? (iconKey as FeatherName)
    : "map-pin";
}

import * as lucide from "lucide-react";
import type { LucideProps } from "lucide-react";

/**
 * A place type's icon, resolved from its `iconKey`.
 *
 * The key is PLATFORM-NEUTRAL and comes from a curated list
 * (`PLACE_TYPE_ICON_KEYS`), because the phone draws it from Feather and the
 * browser from lucide — a free-text key would resolve on one and render
 * nothing on the other, invisibly to whoever chose it. `placeTypeIcons.test.ts`
 * pins every curated key against lucide's exports; its twin does the same for
 * Feather.
 *
 * lucide exports PascalCase components, so `map-pin` is `MapPin` — the same
 * transformation the guard applies, spelled once here.
 */
function componentName(key: string): string {
  return key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function PlaceTypeIcon({
  iconKey,
  color,
  size = 14,
}: {
  iconKey: string;
  color?: string;
  size?: number;
}) {
  const icons = lucide as unknown as Record<
    string,
    React.ComponentType<LucideProps> | undefined
  >;
  // A key this build does not know draws the fallback pin rather than nothing:
  // a row with no glyph reads as a broken row, and a NEWER server may name an
  // icon an older web build has never heard of (protocol §10.3 is additive).
  const Icon = icons[componentName(iconKey)] ?? lucide.MapPin;
  return (
    <Icon
      size={size}
      color={color}
      aria-hidden
      style={{ verticalAlign: "-2px" }}
    />
  );
}

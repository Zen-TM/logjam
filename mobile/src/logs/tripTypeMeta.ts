import { tripTypeIdentity } from "@logjam/shared";

import { theme } from "../theme";
import { type Glyph } from "../ui";

export { primaryTripType, tripTypeLabel } from "@logjam/shared";

/**
 * TRIP TYPE IDENTITY — glyph + hue per activity, resolved against this app's
 * theme and icon set. The decision (seeded identities, the label hash, the
 * untyped glyph) is `tripTypeIdentity` in `@logjam/shared`, so Logjam Web draws
 * the same trip the same colour.
 */
type TripTypeMeta = {
  icon: Glyph;
  hue: string;
};

export function tripTypeMeta(type: string | null | undefined): TripTypeMeta {
  const { icon, hue } = tripTypeIdentity(type);
  return {
    icon: { picked: icon },
    hue:
      hue === "accent" ? theme.accent : hue === "untyped" ? theme.bonus1 : hue,
  };
}

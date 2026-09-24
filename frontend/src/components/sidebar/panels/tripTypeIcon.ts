import { Anchor, BookOpen, Droplet, Navigation, Tag, TrendingUp, type LucideIcon } from "lucide-react";
import { tripTypeIdentity, type TripTypeIconKey } from "@logjam/shared";

// Every key in the shared list, so a glyph added there fails the build here
// until it is drawn.
const TRIP_TYPE_ICONS: Record<TripTypeIconKey, LucideIcon> = {
  droplet: Droplet,
  "trending-up": TrendingUp,
  navigation: Navigation,
  anchor: Anchor,
  tag: Tag,
  "book-open": BookOpen,
};

/** A trip type's glyph and hue on Logjam Web: `tripTypeIdentity` in
 *  `@logjam/shared` decides them, and this resolves the scheme roles. */
export function tripTypeLook(type: string | null | undefined): { icon: LucideIcon; hue: string } {
  const { icon, hue } = tripTypeIdentity(type);
  return {
    icon: TRIP_TYPE_ICONS[icon],
    hue: hue === "accent" ? "var(--theme-accent)" : hue === "untyped" ? "var(--theme-bonus-1)" : hue,
  };
}

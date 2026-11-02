import {
  Anchor,
  Bookmark,
  Droplet,
  Hash,
  Package,
  Sun,
  type LucideIcon,
} from "lucide-react";
import {
  tripTypeIdentity,
  tripTypeLabel,
  type TripTypeIconKey,
} from "@logjam/shared";

// Every key in the shared list, so a glyph added there fails the build here
// until it is drawn.
const TRIP_TYPE_ICONS: Record<TripTypeIconKey, LucideIcon> = {
  droplet: Droplet,
  sun: Sun,
  package: Package,
  anchor: Anchor,
  hash: Hash,
  bookmark: Bookmark,
};

/** A trip type's glyph and hue on Logjam Web: `tripTypeIdentity` in
 *  `@logjam/shared` decides them, and this resolves the scheme roles. */
export function tripTypeLook(type: string | null | undefined): {
  icon: LucideIcon;
  hue: string;
} {
  const { icon, hue } = tripTypeIdentity(type);
  return {
    icon: TRIP_TYPE_ICONS[icon],
    hue:
      hue === "accent"
        ? "var(--color-accent)"
        : hue === "untyped"
          ? "var(--color-neutral)"
          : hue,
  };
}

/**
 * The chips a trip-type picker offers: the vocabulary in its order, deduped
 * ignoring case with the first casing kept, each shown in the casing the
 * SELECTION uses (so a picked "Canyoning" lights the seeded "canyoning" chip
 * rather than adding a second, which the API would refuse as the same type
 * twice), then any pick the vocabulary lacks.
 */
export function tripTypeOptions(
  vocabulary: readonly string[],
  selected: readonly string[],
): { value: string; label: string; icon: LucideIcon; hue: string }[] {
  const byKey = new Map<string, string>();
  for (const type of vocabulary)
    if (!byKey.has(type.toLowerCase())) byKey.set(type.toLowerCase(), type);
  const values = [...byKey.values()].map(
    (type) =>
      selected.find((picked) => picked.toLowerCase() === type.toLowerCase()) ??
      type,
  );
  for (const picked of selected)
    if (!values.some((value) => value.toLowerCase() === picked.toLowerCase()))
      values.push(picked);
  return values.map((value) => ({
    value,
    label: tripTypeLabel(value),
    ...tripTypeLook(value),
  }));
}

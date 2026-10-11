import { createElement } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import type { IconIdea } from "@logjam/shared";
import { WEB_ICONS } from "./webIcons";

/**
 * A glyph a kit control can draw: an idea from the registry, or a LucideIcon
 * from a USER-PICKED vocabulary (a place type's or trip type's icon, resolved
 * by `placeTypeIcon.tsx` / `tripTypeIcon.ts`) — the only components a screen
 * can hold, since it cannot import Lucide itself.
 */
export type Glyph = IconIdea | LucideIcon;

/**
 * The one way a screen draws an icon (frontend/DESIGN.md). Decorative unless
 * given a `label`: hidden from assistive tech, as the control around it carries
 * the name. Pass `label` only when the glyph is the whole message.
 */
export function Icon({
  idea,
  label,
  ...props
}: Omit<LucideProps, "ref"> & { idea: Glyph; label?: string }) {
  const glyph = typeof idea === "string" ? WEB_ICONS[idea] : idea;
  return createElement(
    glyph,
    label
      ? { role: "img", "aria-label": label, ...props }
      : { "aria-hidden": true, ...props },
  );
}

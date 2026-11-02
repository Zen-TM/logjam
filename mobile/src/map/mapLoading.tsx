// Whether the map's last frame was only partly drawn. Frames arrive at display
// rate, so the flag lives here and only the layers glyph subscribes: putting it
// in MapScreen's state would re-render every MLRN layer on each tile batch
// (docs/decisions/0010-map-sensors-only-while-focused.md).
import { useEffect, useSyncExternalStore } from "react";

import { Icon } from "../ui";
import { useTheme } from "../theme";

import { FAB_ICON } from "./mapChrome";

let drawing = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (drawing === next) return;
  drawing = next;
  listeners.forEach((listener) => listener());
}

export const markMapDrawing = () => set(true);
export const markMapDrawn = () => set(false);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The layers button's glyph. A loader while the map online is still drawing:
 * the one cue that a blank map is loading and not broken. Offline, the notice
 * explains it instead.
 */
export function LayersGlyph({ online }: { online: boolean }) {
  const theme = useTheme();
  const isDrawing = useSyncExternalStore(subscribe, () => drawing);
  // A screen that goes away mid-frame never sees the "drawn" event.
  useEffect(() => () => set(false), []);
  return (
    <Icon
      idea={isDrawing && online ? "loading" : "layers"}
      size={FAB_ICON}
      color={theme.text}
    />
  );
}

// The layers button's glyph; the flag it reads is mapDrawing.ts.
import { useEffect, useSyncExternalStore } from "react";

import { Icon } from "../ui";
import { useTheme } from "../theme";

import { FAB_ICON } from "./mapChrome";
import { isMapDrawing, markMapDrawn, subscribeMapDrawing } from "./mapDrawing";

/**
 * The layers button's glyph. A loader once the map online has stayed unfinished
 * for a real wait: the one cue that a blank map is loading and not broken.
 * Offline, the notice explains it instead.
 */
export function LayersGlyph({ online }: { online: boolean }) {
  const theme = useTheme();
  const isDrawing = useSyncExternalStore(subscribeMapDrawing, isMapDrawing);
  // A screen that goes away mid-frame never sees the "drawn" event.
  useEffect(() => markMapDrawn, []);
  return (
    <Icon
      idea={isDrawing && online ? "loading" : "layers"}
      size={FAB_ICON}
      color={theme.text}
    />
  );
}

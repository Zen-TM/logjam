import { mapTools, type MapToolIdOn } from "@logjam/shared";
import type { MenuEntry } from "../../ui";
import type { MapTool } from "./MapChrome";

type Action = { onSelect: () => void } | { menu: readonly MenuEntry[] };

/**
 * The tray's tools: `MAP_TOOLS` gives the ids, order, icons and words, the
 * caller says what each one does. A `Record` over the ids, so `tsc` refuses a
 * missing or an extra tool.
 */
export type MapToolActions = Record<MapToolIdOn<"web">, Action>;

export function webMapTools(actions: MapToolActions): MapTool[] {
  return mapTools("web").map((tool) => ({ ...tool, ...actions[tool.id] }));
}

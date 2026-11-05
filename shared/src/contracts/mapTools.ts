// THE MAP'S TOOL TRAY: the verbs that START something on the map, behind the
// "+" button on both clients. A client draws the tools it has, in this order,
// with these words; one it lacks says why in `reason` or `gap`.
import type { IconIdea } from "../icons.js";
import { MAP_MEASURE, MAP_MEASURE_ICON } from "./mapMeasure.js";
import type { ContractPlatform } from "./types.js";

type MapToolDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
} & (
  | { on?: undefined; reason?: undefined; gap?: undefined }
  | { on: ContractPlatform; reason: string; gap?: undefined }
  | { on: ContractPlatform; gap: string; reason?: undefined }
);

/** In tray order. */
export const MAP_TOOLS = [
  {
    id: "measure",
    icon: MAP_MEASURE_ICON,
    label: MAP_MEASURE.title,
  },
  {
    id: "route",
    icon: "draw",
    label: "Draw a route",
  },
  {
    id: "place",
    icon: "addPlace",
    label: "Add a place",
  },
  {
    id: "makeMap",
    icon: "pickArea",
    label: "Make a map",
    on: "web",
    reason:
      "A LiDAR map is framed at a desk and takes minutes to make, and a GeoPDF is printed there; Logjam GPS shows what Logjam Web made, offline.",
  },
] as const satisfies readonly MapToolDeclaration[];

/** The ids a client draws: a tool the other client alone has is left out. */
export type MapToolIdOn<P extends ContractPlatform> = Exclude<
  (typeof MAP_TOOLS)[number],
  { on: Exclude<ContractPlatform, P> }
>["id"];

export type MapToolSpec<P extends ContractPlatform> = {
  id: MapToolIdOn<P>;
  icon: IconIdea;
  label: string;
};

/** The tools one client has, in the order it draws them. */
export function mapTools<P extends ContractPlatform>(
  platform: P,
): MapToolSpec<P>[] {
  return (MAP_TOOLS as readonly MapToolDeclaration[])
    .filter((tool) => tool.on == null || tool.on === platform)
    .map((tool) => ({
      id: tool.id as MapToolIdOn<P>,
      icon: tool.icon,
      label: tool.label,
    }));
}

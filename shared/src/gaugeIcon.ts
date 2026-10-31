// The water drop a river gauge wears on the map. Both clients draw it, so both
// read it from here; the layer's style stays with each client (the same split
// as `routeArrow.ts`).
export { GAUGE_ICON_SDF_URI } from "./gaugeDropSdf.js";

/** Style-image name. Registered once per map, by whatever owns the style. */
export const GAUGE_ICON_IMAGE = "gauge-drop";

/** Scales the 64x64 source image, whose drop is 45 px tall, to about 25 px. */
export const GAUGE_ICON_SIZE = 0.55;

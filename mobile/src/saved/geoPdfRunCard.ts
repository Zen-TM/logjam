import type { SavedCategory } from "./savedKeys";

/**
 * Whether the running-GeoPDF-import card belongs on this filter. Only the
 * GeoPDF tab: "All" and the other tabs list what is on the device, and the
 * import is not there yet (the Regions download cards follow the same rule).
 */
export function showsGeoPdfRunCard(filter: SavedCategory | "all"): boolean {
  return filter === "geoPdf";
}

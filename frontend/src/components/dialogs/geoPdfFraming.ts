// What the map draws while a GeoPDF's area is framed (shared/DESIGN.md §11).
// Pure, so its test needs neither the map nor the dialog.

/**
 * The layer the map draws. While the user frames a GeoPDF it is the base layer
 * the dialog has chosen, so the frame sits on the map it will be printed from;
 * otherwise, and whenever no choice has been handed over, it is the user's own.
 *
 * A pure choice and not a write: the user's stored layer is never touched, so
 * framing ending (confirmed or cancelled) is the map going back, with nothing
 * to restore.
 */
export function mapLayerFor(
  userLayerId: string,
  framing: { active: boolean; layerId: string | null },
): string {
  return framing.active && framing.layerId ? framing.layerId : userLayerId;
}

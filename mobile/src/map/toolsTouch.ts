/**
 * Whether a touch that has just started is OUTSIDE the open tools tray: the
 * tray is open and the touch did not start on the + or a pill. Such a touch
 * closes the tray, and the tap or long-press it may become is ignored, so a
 * press that closes the tray does not also drop a point or open a sheet. A
 * pan, pinch or drag is not a press and goes on as usual.
 *
 * Guard: toolsTouch.test.ts.
 */
export function isOutsideToolsTouch(
  trayOpen: boolean,
  startedOnTools: boolean,
): boolean {
  return trayOpen && !startedOnTools;
}

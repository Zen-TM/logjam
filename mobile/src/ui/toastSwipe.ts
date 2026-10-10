/** Pull this far sideways, or flick this fast, and the toast goes. */
const DISTANCE = 64;
const VELOCITY = 0.5;

export function swipeDismisses(dx: number, vx: number): boolean {
  return Math.abs(dx) >= DISTANCE || Math.abs(vx) >= VELOCITY;
}

/** A sideways drag claims the touch; a tap or a vertical drag stays the screen's. */
export function claimsHorizontalDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5;
}

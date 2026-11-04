// Whether the map is still drawing, for the layers button's loader. Frames
// arrive at display rate and a camera glide leaves several partly drawn, so the
// flag turns on only after the map has stayed unfinished for `SHOW_AFTER_MS`:
// a loader that blinks on every pan is worse than none. It lives outside screen
// state so a tile batch does not re-render the MLRN layers
// (docs/decisions/0010-map-sensors-only-while-focused.md). Guard: mapDrawing.test.ts.
let visible = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** How long the map must stay unfinished before the loader shows. */
export const SHOW_AFTER_MS = 300;

function set(next: boolean) {
  if (visible === next) return;
  visible = next;
  listeners.forEach((listener) => listener());
}

export function markMapDrawing() {
  if (visible || timer) return;
  timer = setTimeout(() => {
    timer = null;
    set(true);
  }, SHOW_AFTER_MS);
}

export function markMapDrawn() {
  if (timer) clearTimeout(timer);
  timer = null;
  set(false);
}

export function subscribeMapDrawing(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const isMapDrawing = () => visible;

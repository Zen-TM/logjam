// Arrow-key movement inside a composite widget (a chip rail's radio group, a
// menu). One tab stop for the whole widget; arrows move within it and skip
// what is disabled, wrapping at the ends, as the WAI-ARIA patterns specify.

const NEXT = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS = new Set(["ArrowLeft", "ArrowUp"]);

/** The index a key moves to, or null when the key is not a movement key or
 *  nothing is enabled. `from` may be -1 (nothing focused yet). */
export function nextEnabledIndex(disabled: readonly boolean[], from: number, key: string): number | null {
  const count = disabled.length;
  const enabled = (index: number) => !disabled[index];
  if (!disabled.some((isDisabled) => !isDisabled)) return null;
  if (key === "Home") return disabled.findIndex((_, index) => enabled(index));
  if (key === "End") return count - 1 - [...disabled].reverse().findIndex((isDisabled) => !isDisabled);
  const step = NEXT.has(key) ? 1 : PREVIOUS.has(key) ? -1 : 0;
  if (step === 0) return null;
  let index = from;
  for (let tries = 0; tries < count; tries++) {
    index = (index + step + count) % count;
    if (enabled(index)) return index;
  }
  return null;
}

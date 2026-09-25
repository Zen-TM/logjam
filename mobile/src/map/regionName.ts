// The default name a saved area gets before the user renames it.
//
// PRIVACY: it has to say nothing about WHERE the area is. Reverse geocoding
// needs the network and would put a place name (and the round trip that
// derives it) against a region of interest; a coordinate in the label breaks
// DESIGN.md §11 outright. So the name is a plain counter — the user renames it
// in the prompt that opens as the download starts, and their own name is the
// one that means anything anyway.
//
// A counter rather than a date stamp because two areas saved on one trip are
// the case that needs telling apart, and "Region 2" does that where
// "16 Aug 2026" does not.

/**
 * First "Region N" not already in use, counting from 1.
 *
 * Takes every label in play — the registry's rows AND the runs still
 * downloading — because the artifact for a run enqueued a minute ago may not
 * exist yet, and two taps in a row must not both produce "Region 1".
 */
export function nextRegionName(
  existingLabels: Iterable<string | null | undefined>,
): string {
  const taken = new Set(existingLabels);
  for (let n = 1; ; n += 1) {
    const name = `Region ${n}`;
    if (!taken.has(name)) return name;
  }
}

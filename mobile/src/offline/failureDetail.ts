// The sentence a failed download shows when nothing better is known.
//
// Pure and on its own so it can be tested without React Native — and because
// it is a PRIVACY boundary, not a formatting helper: the text originates in an
// exception, lands on screen, and travels into any screenshot of that screen.
/**
 * A short, SAFE description of an unforeseen failure, for the row that reports
 * it. Message text only — no stack, no URL, no path, and nothing derived from
 * the bbox (privacy rule: a region of interest must not leak into a log, a
 * report or a screenshot). Capped, because an arbitrary `Error.message` is
 * arbitrary in length.
 */
export function failureDetail(err: unknown): string | undefined {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  // Anything URL- or path-shaped is dropped whole rather than trimmed: a tile
  // URL carries z/x/y, which IS the area.
  const safe = raw
    .split(/\s+/)
    .filter((word) => !/(https?:|file:|content:|\/)/i.test(word))
    .join(" ")
    .trim();
  return safe.length > 0 ? safe.slice(0, 120) : undefined;
}


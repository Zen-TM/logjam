// How a number is written as digits. `units.ts` owns the unit, the
// conversion and the suffix; this file owns digits and separators, so a
// language that groups or marks decimals differently changes one body.
// Guard: `units.test.ts` ("metric output is what Logjam wrote before").

/** `n` with exactly `fractionDigits` decimals: "1203", "1.2". */
export function formatNumber(n: number, fractionDigits: number): string {
  return n.toFixed(fractionDigits);
}

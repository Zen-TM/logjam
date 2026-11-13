// How a number is written as digits: `units.ts` adds the unit, the conversion
// and the suffix around what `formatNumber` returns. Today it is `toFixed`, so
// there is no digit grouping and the decimal mark is ".".
// Test: `units.test.ts` ("formatNumber").

/** `n` with exactly `fractionDigits` decimals: "1203", "1.2". */
export function formatNumber(n: number, fractionDigits: number): string {
  return n.toFixed(fractionDigits);
}

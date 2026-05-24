import type { TCanyon } from "../canyonUtils";
import { norm, stripWaterwaySuffix } from "@logjam/shared";

export { norm, stripWaterwaySuffix };

type MatchResult =
  | { kind: "match"; canyon: TCanyon }
  | { kind: "ambiguous"; canyons: TCanyon[] }
  | { kind: "none" };

export function matchCanyonByName(
  csvName: string,
  canyons: TCanyon[],
): MatchResult {
  const csvNorm = norm(csvName);
  const csvStripped = stripWaterwaySuffix(csvName);

  const exact = canyons.filter(
    (c) =>
      norm(c.name) === csvNorm ||
      c.altNames.some((a) => norm(a) === csvNorm),
  );
  if (exact.length === 1) return { kind: "match", canyon: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", canyons: exact };

  const stripped = canyons.filter(
    (c) =>
      stripWaterwaySuffix(c.name) === csvStripped ||
      c.altNames.some((a) => stripWaterwaySuffix(a) === csvStripped),
  );
  if (stripped.length === 1) return { kind: "match", canyon: stripped[0] };
  if (stripped.length > 1) return { kind: "ambiguous", canyons: stripped };

  const fuzzy = canyons.filter(
    (c) =>
      norm(c.name).includes(csvStripped) ||
      c.altNames.some((a) => norm(a).includes(csvStripped)),
  );
  if (fuzzy.length === 1) return { kind: "match", canyon: fuzzy[0] };
  if (fuzzy.length > 1) return { kind: "ambiguous", canyons: fuzzy };
  return { kind: "none" };
}

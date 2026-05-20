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
  const query = stripWaterwaySuffix(csvName);
  const matches = canyons.filter(
    (c) =>
      norm(c.name).includes(query) ||
      c.altNames.some((a) => norm(a).includes(query)),
  );
  if (matches.length === 1) return { kind: "match", canyon: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", canyons: matches };
  return { kind: "none" };
}

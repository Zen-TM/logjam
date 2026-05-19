import type { CanyonFieldRole } from "./canyonColumns";
import { GRADE_RANGES } from "./canyonColumns";

export type ParseOk<T> = { ok: true; value: T };
export type ParseFail = { ok: false; reason: MismatchKind; raw: string };
export type ParseResult<T> = ParseOk<T> | ParseFail;

export type MismatchKind =
  | "decimalInInt"
  | "outOfRange"
  | "scaleMismatch"
  | "nonNumeric"
  | "unparsableArray"
  | "unparsableJson"
  | "coordFormat"
  | "booleanish"
  | "mixedTypes"
  | "emptyDominant";

export function parseFloatStrict(raw: string): ParseResult<number> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: NaN }; // empty = no value, caller handles
  const n = Number(trimmed);
  if (isNaN(n)) return { ok: false, reason: "nonNumeric", raw };
  return { ok: true, value: n };
}

export function parseIntStrict(
  raw: string,
  role: CanyonFieldRole,
): ParseResult<number> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: NaN };

  const n = Number(trimmed);
  if (isNaN(n)) {
    // Check booleanish
    const lower = trimmed.toLowerCase();
    if (["yes", "no", "true", "false", "y", "n"].includes(lower)) {
      return { ok: false, reason: "booleanish", raw };
    }
    return { ok: false, reason: "nonNumeric", raw };
  }
  if (!Number.isInteger(n)) {
    return { ok: false, reason: "decimalInInt", raw };
  }
  const range = GRADE_RANGES[role];
  if (range) {
    const [min, max] = range;
    if (n < min || n > max) {
      // Check if values suggest scale mismatch (e.g. 1-10 data in 1-5 field)
      if (n > max && n <= max * 2) {
        return { ok: false, reason: "scaleMismatch", raw };
      }
      return { ok: false, reason: "outOfRange", raw };
    }
  }
  return { ok: true, value: n };
}

export function parseLatLng(raw: string): ParseResult<number> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: NaN };

  // Decimal degrees — happy path
  const n = Number(trimmed);
  if (!isNaN(n)) return { ok: true, value: n };

  // DMS: e.g. 33°44'00"S or 33 44 00 S
  const dmsMatch = trimmed.match(
    /^(-?)(\d+)[°\s](\d+)['\s](\d+(?:\.\d+)?)["\s]?([NSEWnsew]?)$/,
  );
  if (dmsMatch) {
    return { ok: false, reason: "coordFormat", raw };
  }
  return { ok: false, reason: "nonNumeric", raw };
}

export function parseDms(raw: string): number | null {
  const trimmed = raw.trim();
  const dmsMatch = trimmed.match(
    /^(-?)(\d+)[°\s](\d+)['\s](\d+(?:\.\d+)?)["\s]?([NSEWnsew]?)$/,
  );
  if (!dmsMatch) return null;
  const [, sign, deg, min, sec, dir] = dmsMatch;
  const decimal = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
  const negative = sign === "-" || ["S", "s", "W", "w"].includes(dir);
  return negative ? -decimal : decimal;
}

// Parses altNames from various formats:
// - comma-separated: "Gobsmacker, Bubble Bath"
// - semicolon-separated: "Gobsmacker; Bubble Bath"
// - JSON object: {"alternative_names": ["Gobsmacker"]}
// - JSON array: ["Gobsmacker"]
export function parseAltNames(raw: string): ParseResult<string[]> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: [] };

  // Try JSON object
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const names =
        obj["alternative_names"] ??
        obj["altNames"] ??
        obj["alt_names"] ??
        obj["names"];
      if (Array.isArray(names)) {
        return { ok: true, value: names.map(String).filter(Boolean) };
      }
    } catch {
      return { ok: false, reason: "unparsableJson", raw };
    }
  }

  // Try JSON array
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown[];
      if (Array.isArray(arr)) {
        return { ok: true, value: arr.map(String).filter(Boolean) };
      }
    } catch {
      return { ok: false, reason: "unparsableArray", raw };
    }
  }

  // Semicolon-separated
  if (trimmed.includes(";")) {
    return {
      ok: true,
      value: trimmed.split(";").map((s) => s.trim()).filter(Boolean),
    };
  }

  // Comma-separated (default)
  return {
    ok: true,
    value: trimmed.split(",").map((s) => s.trim()).filter(Boolean),
  };
}

// Parses sources from various formats:
// - JSON [[label, url], ...]
// - JSON [{label, url}, ...]
// - Newline or comma-separated URLs (label defaults to URL)
export function parseSources(raw: string): ParseResult<[string, string][]> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: [] };

  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown[];
      if (!Array.isArray(arr)) throw new Error();
      const result: [string, string][] = [];
      for (const item of arr) {
        if (Array.isArray(item) && item.length >= 1) {
          result.push([String(item[0] ?? ""), String(item[1] ?? "")]);
        } else if (typeof item === "object" && item !== null) {
          const obj = item as Record<string, unknown>;
          const label = String(obj["label"] ?? obj["name"] ?? "");
          const url = String(obj["url"] ?? obj["link"] ?? obj["href"] ?? "");
          result.push([label, url]);
        }
      }
      return { ok: true, value: result };
    } catch {
      return { ok: false, reason: "unparsableJson", raw };
    }
  }

  // Plain URLs separated by newline or comma
  const sep = trimmed.includes("\n") ? "\n" : ",";
  const urls = trimmed.split(sep).map((s) => s.trim()).filter(Boolean);
  return {
    ok: true,
    value: urls.map((url) => [url, url] as [string, string]),
  };
}

export function parseByRole(
  raw: string,
  role: CanyonFieldRole,
): ParseResult<unknown> {
  switch (role) {
    case "latitude":
    case "longitude":
      return parseLatLng(raw);
    case "longestAbseil":
    case "hours":
      return parseFloatStrict(raw);
    case "vGrade":
    case "aGrade":
    case "commitment":
    case "quality":
    case "wetsuits":
    case "numAbseils":
      return parseIntStrict(raw, role);
    case "altNames":
      return parseAltNames(raw);
    case "sources":
      return parseSources(raw);
    default:
      // name, notes, attr:*, new-attr, discard — always string, no mismatch
      return { ok: true, value: raw };
  }
}

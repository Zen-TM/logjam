import { parse } from "csv-parse/sync";

// notes is a Logjam user-only field — never sourced from RopeWiki.

const ROPEWIKI_CSV_URL =
  "https://ropewiki.com/index.php?title=Special:Ask" +
  "&x=-5B-5BCategory%3ACanyons-5D-5D-20-5B-5BLocated-20in-20region" +
  ".Located-20in-20regions%3A%3AX-7C-7CNew-20South-20Wales-5D-5D" +
  "%2F-3FHas-20pageid%3DPAGEID%2F-3FHas-20name%3DLocation%2F-3FHas-20" +
  "coordinates%3DCoords%2F-3FLocated-20in-20region%3DRegion%2F-3FHas-20user" +
  "-20rating%3DQuality%2F-3FHas-20rating%3DRating%2F-3FHas-20fastest-20typical" +
  "-20time%3DMin-20Time%2F-3FHas-20slowest-20typical-20time%3DMax-20Time%2F-3F" +
  "Has-20length-20of-20hike%3DHike%2F-3FHas-20info-20rappels%3DRappels%2F-3F" +
  "Has-20longest-20rappel%3DLongest%2F-3FHas-20best-20season%3DBest-20Season%2F-3F" +
  "Has-20shuttle-20length%3DShuttle%2F-3FHas-20vehicle-20type%3DVehicle&mainlabel" +
  "=-&limit=2000&order=descending%2C%20ascending&sort=Has_rank_rating%2C%20" +
  "Has_name&offset=0&format=csv";

export type RopeWikiCanyon = {
  ropeWikiId: number;
  name: string;
  latitude: number;
  longitude: number;
  numAbseils: number | null;
  longestAbseil: number | null;
  vGrade: number | null;
  aGrade: number | null;
  commitment: number | null;
  quality: number | null;
  hours: number | null;
  attributes: {
    sources?: [string, string][];
  };
};

// Scalar fields that RopeWiki may own on a linked canyon.
// name/latitude/longitude are always user-owned on link (Canyon requires them).
export type RopeWikiOwnableField =
  | "numAbseils"
  | "longestAbseil"
  | "vGrade"
  | "aGrade"
  | "commitment"
  | "quality"
  | "hours";

export const ROPE_WIKI_OWNABLE_FIELDS: RopeWikiOwnableField[] = [
  "numAbseils",
  "longestAbseil",
  "vGrade",
  "aGrade",
  "commitment",
  "quality",
  "hours",
];

// Snapshot stored alongside the canyon to detect user edits on refresh.
// Values are always the RopeWiki upstream values at last sync time.
// ropeWikiOwnedFields lists scalar fields RopeWiki contributed on link.
// "*" means all fields are RopeWiki-owned (fresh create, no pre-existing data).
export type RopeWikiSnapshot = {
  name: string;
  latitude: number;
  longitude: number;
  numAbseils: number | null;
  longestAbseil: number | null;
  vGrade: number | null;
  aGrade: number | null;
  commitment: number | null;
  quality: number | null;
  hours: number | null;
  attributes: { sources?: [string, string][] };
  ropeWikiOwnedFields: RopeWikiOwnableField[] | "*";
};

// For canyons created fresh from RopeWiki — all fields are RopeWiki-owned.
export function snapshotFromCreate(c: RopeWikiCanyon): RopeWikiSnapshot {
  return {
    name: c.name,
    latitude: c.latitude,
    longitude: c.longitude,
    numAbseils: c.numAbseils,
    longestAbseil: c.longestAbseil,
    vGrade: c.vGrade,
    aGrade: c.aGrade,
    commitment: c.commitment,
    quality: c.quality,
    hours: c.hours,
    attributes: { ...c.attributes },
    ropeWikiOwnedFields: "*",
  };
}

// For canyons linked from an existing local canyon — only null-filled fields
// are RopeWiki-owned. The caller supplies the ownership mask (from mergeFillNulls).
export function snapshotFromLink(
  c: RopeWikiCanyon,
  ropeWikiOwnedFields: RopeWikiOwnableField[],
): RopeWikiSnapshot {
  return {
    name: c.name,
    latitude: c.latitude,
    longitude: c.longitude,
    numAbseils: c.numAbseils,
    longestAbseil: c.longestAbseil,
    vGrade: c.vGrade,
    aGrade: c.aGrade,
    commitment: c.commitment,
    quality: c.quality,
    hours: c.hours,
    attributes: { ...c.attributes },
    ropeWikiOwnedFields,
  };
}

export function isRopeWikiOwned(
  snapshot: RopeWikiSnapshot,
  field: RopeWikiOwnableField,
): boolean {
  if (snapshot.ropeWikiOwnedFields === "*") return true;
  return snapshot.ropeWikiOwnedFields.includes(field);
}

function sourcesEqual(
  a: [string, string][] | undefined,
  b: [string, string][] | undefined,
): boolean {
  const aSrc = a ?? [];
  const bSrc = b ?? [];
  if (aSrc.length !== bSrc.length) return false;
  const key = (t: [string, string]) => t[0] + "\0" + t[1];
  const aSort = [...aSrc].sort((x, y) => key(x).localeCompare(key(y)));
  const bSort = [...bSrc].sort((x, y) => key(x).localeCompare(key(y)));
  return aSort.every((t, i) => t[0] === bSort[i][0] && t[1] === bSort[i][1]);
}

// Structural equality for RopeWikiSnapshot — avoids JSON.stringify key-order
// sensitivity after Postgres jsonb round-trips.
export function snapshotsEqual(
  a: RopeWikiSnapshot,
  b: RopeWikiSnapshot,
): boolean {
  return (
    a.name === b.name &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    a.numAbseils === b.numAbseils &&
    a.longestAbseil === b.longestAbseil &&
    a.vGrade === b.vGrade &&
    a.aGrade === b.aGrade &&
    a.commitment === b.commitment &&
    a.quality === b.quality &&
    a.hours === b.hours &&
    sourcesEqual(a.attributes?.sources, b.attributes?.sources)
  );
}

export function attributesSourcesEqual(
  a: { sources?: [string, string][] } | null | undefined,
  b: { sources?: [string, string][] } | null | undefined,
): boolean {
  return sourcesEqual(a?.sources, b?.sources);
}

/**
 * Parse DMS coordinates like `33° 33' 3.82" S, 150° 24' 6.13" E`
 * into { latitude, longitude } in decimal degrees.
 */
function parseDMS(
  coord: string,
): { latitude: number; longitude: number } | null {
  const pattern = /(\d+)[°]\s*(\d+)[''′]\s*([\d.]+)[""″]?\s*([NSEW])/gi;
  const matches = [...coord.matchAll(pattern)];
  if (matches.length < 2) return null;

  function toDec(m: RegExpMatchArray): number {
    const deg = parseFloat(m[1]);
    const min = parseFloat(m[2]);
    const sec = parseFloat(m[3]);
    const dir = m[4].toUpperCase();
    const decimal = deg + min / 60 + sec / 3600;
    return dir === "S" || dir === "W" ? -decimal : decimal;
  }

  const first = toDec(matches[0]);
  const second = toDec(matches[1]);

  // Determine which is lat/lng from the direction letters
  const dir1 = matches[0][4].toUpperCase();
  const dir2 = matches[1][4].toUpperCase();

  if ((dir1 === "N" || dir1 === "S") && (dir2 === "E" || dir2 === "W")) {
    return { latitude: first, longitude: second };
  }
  if ((dir1 === "E" || dir1 === "W") && (dir2 === "N" || dir2 === "S")) {
    return { latitude: second, longitude: first };
  }

  return null;
}

/**
 * Parse rating HTML to extract the French grading system.
 * RopeWiki stores two grading systems; the French grade (e.g. "v2a3 III")
 * appears inside parentheses. Commitment may be wrapped in <i></i> tags.
 *
 * Examples:
 *   `<i>4C</i>   (v4a3 V)`         → v4 a3 V
 *   `3B <i>III</i>  (v2a2 III)`     → v2 a2 III
 *   `3B   (<i>v3a2</i>)`            → v3 a2
 *   `<i>2B III</i>  (v1a2 <i>III</i>)` → v1 a2 III
 *   `<i>3</i>   (v3)`               → v3
 */
function parseRating(html: string): {
  v_grade?: number;
  a_grade?: number;
  commitment?: number;
} {
  const result: { v_grade?: number; a_grade?: number; commitment?: number } =
    {};
  if (!html) return result;

  // Extract content inside parentheses
  const parenMatch = html.match(/\(([^)]+)\)/);
  if (!parenMatch) return result;

  // Strip all HTML tags to get plain text
  const plain = parenMatch[1].replace(/<[^>]+>/g, "").trim();

  const romanToNum: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
  };

  const vMatch = plain.match(/v(\d)/i);
  if (vMatch) result.v_grade = parseInt(vMatch[1]);

  const aMatch = plain.match(/a(\d)/i);
  if (aMatch) result.a_grade = parseInt(aMatch[1]);

  // Match Roman numeral at end of string or after whitespace
  const romanMatch = plain.match(/\b(VI|IV|V?I{0,3})\s*$/);
  if (romanMatch && romanToNum[romanMatch[1]]) {
    result.commitment = romanToNum[romanMatch[1]];
  }

  return result;
}

/** Parse "50 feet" or "15 m" to meters. */
function parseLongestRappel(value: string): number | null {
  if (!value || !value.trim()) return null;
  const feetMatch = value.match(/([\d.]+)\s*(?:feet|ft)/i);
  if (feetMatch) return Math.round(parseFloat(feetMatch[1]) * 0.3048 * 10) / 10;
  const mMatch = value.match(/([\d.]+)\s*(?:m|meters?)/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 10) / 10;
  const numMatch = value.match(/([\d.]+)/);
  if (numMatch) return Math.round(parseFloat(numMatch[1]) * 0.3048 * 10) / 10;
  return null;
}

/** Parse a time string like "5 hours", "4-6 hours", or "5 hr" to a number. */
function parseHours(value: string): number | null {
  if (!value || !value.trim()) return null;
  const rangeMatch = value.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (rangeMatch) {
    return (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2;
  }
  const numMatch = value.match(/([\d.]+)/);
  if (numMatch) return parseFloat(numMatch[1]);
  return null;
}

/** Parse number of rappels — may be a range like "3-5", take the first number. */
function parseRappels(value: string): number | null {
  if (!value || !value.trim()) return null;
  const numMatch = value.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1]);
  return null;
}

/** Parse quality stars (1-5, decimals preserved). */
function parseQuality(value: string): number | null {
  if (!value || !value.trim()) return null;
  const numMatch = value.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) {
    const n = parseFloat(numMatch[1]);
    return n >= 1 && n <= 5 ? n : null;
  }
  return null;
}

export async function fetchAndParseRopeWiki(): Promise<{
  canyons: RopeWikiCanyon[];
  errors: string[];
}> {
  const response = await fetch(ROPEWIKI_CSV_URL, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent":
        "Logjam/1.0 (canyoning logbook; https://logjamnsw.com; noreply@notifications.logjamnsw.com)",
    },
  });
  if (!response.ok) {
    throw new Error(`RopeWiki returned HTTP ${response.status}`);
  }

  const csvText = await response.text();

  const records: string[][] = parse(csvText, {
    skip_empty_lines: true,
    relax_column_count: true,
  });

  if (records.length < 2) {
    throw new Error("RopeWiki CSV is empty or has no data rows");
  }

  // First row is headers — identify column indices by name
  const headers = records[0].map((h) => h.trim().toLowerCase());
  const requiredCol = (name: string): number => {
    const i = headers.indexOf(name);
    if (i === -1) {
      throw new Error(`RopeWiki CSV missing required column: ${name}`);
    }
    return i;
  };
  const optionalCol = (...names: string[]): number => {
    for (const name of names) {
      const i = headers.indexOf(name);
      if (i !== -1) return i;
    }
    for (const name of names) {
      const partial = headers.findIndex(
        (h) => h.length > 0 && (h.includes(name) || name.includes(h)),
      );
      if (partial !== -1) return partial;
    }
    return -1;
  };

  const pageIdCol = requiredCol("pageid");
  const coordCol = requiredCol("coords");
  const locationCol = requiredCol("location");
  const qualityCol = optionalCol("quality");
  const ratingCol = optionalCol("rating");
  const rappelsCol = optionalCol("rappels", "number of rappels");
  const longestCol = optionalCol("longest", "longest rappel");
  const maxTimeCol = optionalCol("max time");
  const timeCol = optionalCol("min time", "time");

  const canyons: RopeWikiCanyon[] = [];
  const errors: string[] = [];

  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    try {
      const pageIdRaw = row[pageIdCol]?.trim();
      const pageId = parseInt(pageIdRaw);
      if (isNaN(pageId)) {
        errors.push(`Row ${i}: invalid PAGEID "${pageIdRaw}"`);
        continue;
      }

      const name = locationCol >= 0 ? row[locationCol]?.trim() : "";
      if (!name) {
        errors.push(`Row ${i}: missing name`);
        continue;
      }

      const coordStr = coordCol >= 0 ? row[coordCol]?.trim() : "";
      const coords = parseDMS(coordStr || "");
      if (!coords) {
        errors.push(
          `Row ${i} (${name}): could not parse coordinates "${coordStr}"`,
        );
        continue;
      }

      const rating = ratingCol >= 0 ? parseRating(row[ratingCol] || "") : {};
      const quality =
        qualityCol >= 0 ? parseQuality(row[qualityCol] || "") : null;
      const numAbseils =
        rappelsCol >= 0 ? parseRappels(row[rappelsCol] || "") : null;
      const longestAbseil =
        longestCol >= 0 ? parseLongestRappel(row[longestCol] || "") : null;
      const maxTimeRaw = maxTimeCol >= 0 ? row[maxTimeCol] || "" : "";
      const minTimeRaw = timeCol >= 0 ? row[timeCol] || "" : "";
      const hours = parseHours(maxTimeRaw) ?? parseHours(minTimeRaw);

      canyons.push({
        ropeWikiId: pageId,
        name,
        latitude: coords.latitude,
        longitude: coords.longitude,
        numAbseils,
        longestAbseil,
        vGrade: rating.v_grade ?? null,
        aGrade: rating.a_grade ?? null,
        commitment: rating.commitment ?? null,
        quality: quality ?? null,
        hours: hours ?? null,
        attributes: {
          sources: [
            ["RopeWiki", `http://ropewiki.com/index.php?curid=${pageId}`],
          ],
        },
      });
    } catch (err) {
      errors.push(
        `Row ${i}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { canyons, errors };
}

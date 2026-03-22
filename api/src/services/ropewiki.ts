import { parse } from "csv-parse/sync";

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
  notes: string | null;
  attributes: {
    v_grade?: number;
    a_grade?: number;
    commitment?: number;
    quality?: number;
    hours?: number;
    sources?: [string, string][];
  };
};

// Snapshot stored alongside the canyon so we can detect user edits on refresh.
// Contains the same fields as the canyon data at import time.
export type RopeWikiSnapshot = {
  name: string;
  latitude: number;
  longitude: number;
  numAbseils: number | null;
  longestAbseil: number | null;
  attributes: RopeWikiCanyon["attributes"];
};

export function snapshotFromCanyon(c: RopeWikiCanyon): RopeWikiSnapshot {
  return {
    name: c.name,
    latitude: c.latitude,
    longitude: c.longitude,
    numAbseils: c.numAbseils,
    longestAbseil: c.longestAbseil,
    attributes: { ...c.attributes },
  };
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
 * Parse rating HTML like:
 * `<span class='pointed_canyon_rating'>v4</span><span class='pointed_canyon_rating'>a3</span><span class='pointed_canyon_rating'>III</span>`
 * into { v_grade, a_grade, commitment }.
 */
function parseRating(html: string): {
  v_grade?: number;
  a_grade?: number;
  commitment?: number;
} {
  const result: { v_grade?: number; a_grade?: number; commitment?: number } =
    {};
  if (!html) return result;

  // Extract text content from spans (or handle plain text)
  const spanTexts = [...html.matchAll(/>([^<]+)</g)].map((m) => m[1].trim());
  const texts = spanTexts.length > 0 ? spanTexts : [html.trim()];

  const romanToNum: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
  };

  for (const text of texts) {
    const vMatch = text.match(/^v(\d)$/i);
    if (vMatch) {
      result.v_grade = parseInt(vMatch[1]);
      continue;
    }
    const aMatch = text.match(/^a(\d)$/i);
    if (aMatch) {
      result.a_grade = parseInt(aMatch[1]);
      continue;
    }
    if (romanToNum[text]) {
      result.commitment = romanToNum[text];
    }
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

/** Parse "5 hours" or "4-6 hours" to a number. */
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

/** Parse quality stars (1-5). */
function parseQuality(value: string): number | null {
  if (!value || !value.trim()) return null;
  const numMatch = value.match(/(\d)/);
  if (numMatch) {
    const n = parseInt(numMatch[1]);
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
  const colIndex = (...names: string[]): number => {
    for (const name of names) {
      const i = headers.indexOf(name);
      if (i !== -1) return i;
    }
    // Try partial match against all names
    for (const name of names) {
      const partial = headers.findIndex((h) => h.includes(name) || name.includes(h));
      if (partial !== -1) return partial;
    }
    return -1;
  };

  const pageIdCol = colIndex("pageid", "");
  const coordCol = colIndex("coords", "coordinates");
  const locationCol = colIndex("location", "name");
  const qualityCol = colIndex("quality");
  const ratingCol = colIndex("rating");
  const rappelsCol = colIndex("rappels", "number of rappels");
  const longestCol = colIndex("longest", "longest rappel");
  const timeCol = colIndex("min time", "time");

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
      const hours = timeCol >= 0 ? parseHours(row[timeCol] || "") : null;

      const attributes: RopeWikiCanyon["attributes"] = {
        ...rating,
        ...(quality != null && { quality }),
        ...(hours != null && { hours }),
        sources: [
          ["RopeWiki", `http://ropewiki.com/index.php?curid=${pageId}`],
        ],
      };

      canyons.push({
        ropeWikiId: pageId,
        name,
        latitude: coords.latitude,
        longitude: coords.longitude,
        numAbseils,
        longestAbseil,
        notes: null,
        attributes,
      });
    } catch (err) {
      errors.push(
        `Row ${i}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { canyons, errors };
}

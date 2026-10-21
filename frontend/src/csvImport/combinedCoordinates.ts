// A place list whose coordinates share one column ("-33.56, 150.40", a DMS
// pair, or a Google My Maps / Earth `POINT (lon lat)` WKT cell) gets a
// Latitude and a Longitude column appended, so the rest of the import sees the
// ordinary two-column shape. Rows the column can't be split for (a WKT line,
// a blank) get empty cells and are reported as skipped like any unreadable
// coordinate.
import { detectFileKind } from "./detectFileKind";
import { detectPlaceColumns } from "./placeColumns";
import { parseLatLng } from "./placeValueParsers";

const WKT_POINT = /^POINT\s*\(\s*(\S+)\s+(\S+)\s*\)$/i;
// "33° 33' 33.12\" S, 150° 24' 11.88\" E": split after the hemisphere letter.
const DMS_PAIR = /^(.+?[NSns])[\s,;]+(.+?[EWew])$/;

function splitPair(cell: string): [number, number] | null {
  const text = cell.trim();
  if (/^-?\d+,\d+$/.test(text)) return null;
  const wkt = text.match(WKT_POINT);
  // WKT is x y: longitude first.
  const halves = wkt
    ? [wkt[2], wkt[1]]
    : (text.match(DMS_PAIR)?.slice(1, 3) ??
      (text.split(",").length === 2 ? text.split(",") : null));
  if (!halves) return null;
  const [lat, lon] = halves.map((h) => parseLatLng(h));
  if (!lat.ok || !lon.ok || isNaN(lat.value) || isNaN(lon.value)) return null;
  if (Math.abs(lat.value) > 90 || Math.abs(lon.value) > 180) return null;
  return [lat.value, lon.value];
}

export function splitCombinedCoordinates(
  headers: string[],
  rows: Record<string, string>[],
): { headers: string[]; rows: Record<string, string>[] } {
  const roles = Object.values(detectPlaceColumns(headers));
  // A logbook (name + date headers) has no coordinates to find; a decimal
  // comma ("-33,5603") is one number, not a pair.
  if (
    roles.includes("latitude") ||
    roles.includes("longitude") ||
    detectFileKind(headers) !== "unknown"
  )
    return { headers, rows };
  const column = headers.find((h) => {
    const cells = rows.map((r) => r[h]).filter(Boolean);
    const split = cells.filter((c) => splitPair(c) !== null).length;
    return split > 0 && split * 2 >= cells.length;
  });
  if (!column) return { headers, rows };
  const [lat, lon] = ["Latitude", "Longitude"];
  return {
    headers: [...headers, lat, lon],
    rows: rows.map((r) => {
      const pair = splitPair(r[column] ?? "");
      return {
        ...r,
        [lat]: pair ? String(pair[0]) : "",
        [lon]: pair ? String(pair[1]) : "",
      };
    }),
  };
}

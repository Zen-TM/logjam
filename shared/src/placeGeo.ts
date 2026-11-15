const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/** `d` degrees wrapped into [0, 360). Exact for a `d` already in range. */
const wrapTurn = (d: number): number => {
  const m = d % 360;
  return m < 0 ? m + 360 : m;
};

/**
 * The whole turns, in degrees, from the world copy `lon` is in to the one
 * [-180, 180) is in: 0 for a longitude in that range, 360 for 180, -360 for a
 * longitude a hair under -180. Guard: placeGeo.test.ts.
 */
export const lonTurn = (lon: number): number => 360 * Math.round(lon / 360);

/**
 * A longitude wrapped into [-180, 180): the one wrap every longitude read goes
 * through, so 180 is -180 and a longitude already in range comes back as it
 * is. Guard: placeGeo.test.ts.
 */
export const wrapLon = (lon: number): number =>
  lon >= -180 && lon < 180 ? lon : lon - lonTurn(lon);

/**
 * How many degrees a box spans from `west` east to `east`, a box wrapped across
 * the date line (`west` above `east`) counting the turn it crosses. A box that
 * arrives unwrapped (an edge past ±180) keeps its width, which is a turn or
 * more where it holds the whole world. Guard: placeGeo.test.ts.
 */
export function lonWidth(west: number, east: number): number {
  return east >= west ? east - west : wrapTurn(east - west);
}

/**
 * A box shifted by whole turns until its centre is in [-180, 180): a map
 * panned round the world reports longitudes past ±180, while a region's
 * borders and a hemisphere are read in that range. A box that arrives wrapped
 * (`west` above `east`) comes back unwrapped, its centre across the line where
 * it is. A box wider than a turn keeps its width. Guard: placeGeo.test.ts.
 */
export function wrapBox<B extends { west: number; east: number }>(box: B): B {
  const east =
    box.east >= box.west ? box.east : box.west + lonWidth(box.west, box.east);
  const turn = lonTurn((box.west + east) / 2);
  return turn === 0 && east === box.east
    ? box
    : { ...box, west: box.west - turn, east: east - turn };
}

/**
 * `lon` moved by whole turns to the copy of the world nearest `near`: a longitude
 * read back from a grid (always in [-180, 180]) beside a box that follows the
 * map into another world copy. Exact where no turn is needed. Guard: placeGeo.test.ts.
 */
export const lonNear = (lon: number, near: number): number =>
  lon + 360 * Math.round((near - lon) / 360);

// Coarse pre-filter before haversine. ±degLatLng on both axes. ~0.05° ≈ 5 km
// at NSW latitudes; pick larger than your auto-link/review radius. The
// longitude difference is wrapped, so two places either side of the date line
// are close. Guard: placeGeo.test.ts.
export function withinBbox(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  degLatLng: number,
): boolean {
  return (
    Math.abs(lat1 - lat2) <= degLatLng &&
    Math.abs(wrapLon(lng1 - lng2)) <= degLatLng
  );
}

/**
 * Whether the box `innerWest`..`innerEast` lies wholly inside the box
 * `west`..`east`, edges included, across the date line. Each box arrives
 * unwrapped (an edge past ±180, possibly a whole world copy away) or wrapped
 * (`west` above `east`); a box a turn or more wide holds every longitude, so
 * every box. Guard: placeGeo.test.ts.
 */
export function lonBoxWithin(
  west: number,
  east: number,
  innerWest: number,
  innerEast: number,
): boolean {
  const span = lonWidth(west, east);
  if (span >= 360) return true;
  return wrapTurn(innerWest - west) + lonWidth(innerWest, innerEast) <= span;
}

/**
 * Whether a stored longitude, always in [-180, 180], lies in the box between
 * `west` and `east`, inclusive, across the date line: `lonBoxWithin` for a
 * box with no width. Guard: placeGeo.test.ts.
 */
export function lonWithin(lon: number, west: number, east: number): boolean {
  return lonBoxWithin(west, east, lon, lon);
}

/**
 * The width in degrees where two longitude ranges meet, or null where they do
 * not. Ranges that only touch meet in a width of 0. Either range may be
 * unwrapped or wrapped, in any world copy, and the widest overlap in any copy
 * counts. Guard: placeGeo.test.ts.
 */
export function lonOverlap(
  west: number,
  east: number,
  otherWest: number,
  otherEast: number,
): number | null {
  const span = lonWidth(west, east);
  const otherSpan = lonWidth(otherWest, otherEast);
  let widest: number | null = null;
  // `shift` is where the other range starts, measured from `west`, in each
  // world copy from the one just below `west` up past `east`.
  for (
    let shift = wrapTurn(otherWest - west) - 360;
    shift <= span;
    shift += 360
  ) {
    const width = Math.min(span, shift + otherSpan) - Math.max(0, shift);
    if (width >= 0 && (widest === null || width > widest)) widest = width;
  }
  return widest;
}

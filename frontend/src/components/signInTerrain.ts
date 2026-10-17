// The decisions behind the sign-in terrain, kept out of the component so they
// can be tested: which area, where the sun is over it, and where rain runs.

const RAD = Math.PI / 180;

/**
 * The area to show this visit: any but the last one shown, so a returning
 * user sees somewhere new. `random` is in [0, 1).
 */
export function pickArea(keys: string[], last: string | null, random: number) {
  const choices = keys.length > 1 ? keys.filter((k) => k !== last) : keys;
  return choices[Math.floor(random * choices.length)];
}

/**
 * The sun's position seen from (lat, lon) at `date`, to a fraction of a
 * degree: plenty for shading. `azimuth` is clockwise from north.
 */
export function sunPosition(date: Date, lat: number, lon: number) {
  const d = date.getTime() / 86_400_000 - 10_957.5; // days from J2000
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const ecliptic = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const tilt = (23.439 - 0.00000036 * d) * RAD;
  const dec = Math.asin(Math.sin(tilt) * Math.sin(ecliptic));
  const ra = Math.atan2(
    Math.cos(tilt) * Math.sin(ecliptic),
    Math.cos(ecliptic),
  );
  const gmst = 280.46061837 + 360.98564736629 * d;
  const hour = (gmst + lon) * RAD - ra;
  const phi = lat * RAD;
  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(dec) +
      Math.cos(phi) * Math.cos(dec) * Math.cos(hour),
  );
  const azimuth = Math.atan2(
    -Math.sin(hour) * Math.cos(dec),
    Math.sin(dec) * Math.cos(phi) -
      Math.cos(dec) * Math.sin(phi) * Math.cos(hour),
  );
  return { azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI), altitude };
}

type Vec3 = [number, number, number];

/** A light from compass `azimuth` at `altitude`, in image axes (x east, y south, z up). */
function lightFrom(azimuth: number, altitude: number): Vec3 {
  const c = Math.cos(altitude);
  return [Math.sin(azimuth) * c, -Math.cos(azimuth) * c, Math.sin(altitude)];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The light an area at (lat, lon) is shaded with at `date`: the sun where it stands, and
 * after dusk the north-west light printed maps use, dimmer. The sun is held
 * at least 12° up, as a lower one throws whole slopes into black.
 */
export function valleyLight(date: Date, lat: number, lon: number) {
  const sun = sunPosition(date, lat, lon);
  const day = smoothstep(-6 * RAD, 6 * RAD, sun.altitude);
  const lit = lightFrom(sun.azimuth, Math.max(sun.altitude, 12 * RAD));
  const night = lightFrom(315 * RAD, 35 * RAD);
  const mixed = night.map((v, i) => v + (lit[i] - v) * day) as Vec3;
  const length = Math.hypot(...mixed);
  return {
    light: mixed.map((v) => v / length) as Vec3,
    gain: 0.7 + 0.3 * day,
  };
}

// D8, in the order the drainage file was written: N NE E SE S SW W NW.
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];
/** A cell whose water leaves the map. */
export const OUTLET = 255;

/** How many cells drain through each cell, itself included. */
export function drainage(dir: Uint8Array, w: number, h: number) {
  const next = new Int32Array(dir.length).fill(-1);
  const inflow = new Uint8Array(dir.length);
  for (let i = 0; i < dir.length; i++) {
    if (dir[i] === OUTLET) continue;
    const x = (i % w) + DX[dir[i]];
    const y = Math.floor(i / w) + DY[dir[i]];
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    next[i] = y * w + x;
    inflow[next[i]]++;
  }
  const area = new Float32Array(dir.length).fill(1);
  const ready: number[] = [];
  for (let i = 0; i < dir.length; i++) if (inflow[i] === 0) ready.push(i);
  while (ready.length) {
    const i = ready.pop()!;
    const j = next[i];
    if (j < 0) continue;
    area[j] += area[i];
    if (--inflow[j] === 0) ready.push(j);
  }
  return area;
}

/** The cells a drop landing on (x, y) runs through, to where it leaves the map. */
export function traceDownhill(
  dir: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
) {
  const cells: number[] = [];
  // The file has no loops; the cap only guards against a corrupt one.
  while (cells.length < w + h * 4) {
    if (x < 0 || x >= w || y < 0 || y >= h) break;
    const i = y * w + x;
    cells.push(i);
    if (dir[i] === OUTLET) break;
    x += DX[dir[i]];
    y += DY[dir[i]];
  }
  return cells;
}

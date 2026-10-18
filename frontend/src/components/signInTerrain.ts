// The decisions behind the sign-in terrain, kept out of the component so they
// can be tested: which area, where the sun is over it, and where rain runs.

const RAD = Math.PI / 180;

/**
 * The areas that have all three of their files (`<key>.json`,
 * `<key>Normals.webp`, `<key>Flow.webp`), from the paths each kind was found
 * at: one missing file leaves its area out rather than breaking the screen.
 */
export function areaKeys(
  contours: string[],
  normals: string[],
  flows: string[],
) {
  const key = (path: string, suffix: string) =>
    path.slice(path.lastIndexOf("/") + 1, -suffix.length);
  const withNormals = new Set(normals.map((p) => key(p, "Normals.webp")));
  const withFlow = new Set(flows.map((p) => key(p, "Flow.webp")));
  return contours
    .map((p) => key(p, ".json"))
    .filter((k) => withNormals.has(k) && withFlow.has(k));
}

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

/**
 * D8 as [dy, dx], in the order the drainage file's bytes count them: N NE E
 * SE S SW W NW. The generator declares the same table and the same OUTLET;
 * signInTerrain.test.ts holds the two together.
 */
export const D8: readonly (readonly [number, number])[] = [
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
];
const DX = D8.map(([, dx]) => dx);
const DY = D8.map(([dy]) => dy);
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

/** Scale and offset that make a w×h source cover a W×H box, centred. */
export function cover(W: number, H: number, w: number, h: number) {
  const s = Math.max(W / w, H / h);
  return { s, ox: (W - w * s) / 2, oy: (H - h * s) / 2 };
}

/** Where water runs next from each cell, and how much ground drains through it. */
export type Flow = {
  dir: Uint8Array;
  area: Float32Array;
  w: number;
  h: number;
};

/** A drop's path on screen, from where it landed to where it leaves the map. */
export function dropPath(
  flow: Flow,
  cells: number[],
  s: number,
  ox: number,
  oy: number,
) {
  const n = cells.length;
  const raw = cells.flatMap((i) => [
    ((i % flow.w) + 0.5) * s + ox,
    (Math.floor(i / flow.w) + 0.5) * s + oy,
  ]);
  // A run of grid steps is a staircase: each point is averaged with two
  // neighbours either side.
  const points = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2);
    const b = Math.min(n - 1, i + 2);
    for (let j = a; j <= b; j++) {
      points[i * 2] += raw[j * 2] / (b - a + 1);
      points[i * 2 + 1] += raw[j * 2 + 1] / (b - a + 1);
    }
  }
  const along = new Float32Array(n);
  const width = new Float32Array(n);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i > 0)
      along[i] =
        along[i - 1] +
        Math.hypot(
          points[i * 2] - points[i * 2 - 2],
          points[i * 2 + 1] - points[i * 2 - 1],
        );
    const size = Math.log2(flow.area[cells[i]]);
    width[i] = 0.5 + 0.11 * size;
    alpha[i] = Math.min(0.55, 0.25 + 0.025 * size);
  }
  return { points, along, width, alpha };
}

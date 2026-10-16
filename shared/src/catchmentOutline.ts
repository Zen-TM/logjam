/**
 * An approximate outline of the land that drains to a point, drawn from the
 * creeks upstream of it (`FlowNetworkUpstream.lines`). The flow network layer
 * carries creeks, not basin polygons, so the outline is grown from the lines:
 * every creek is surrounded by land that drains into it, and the ridge between
 * two neighbouring creeks lies somewhere between them.
 *
 * The lines are painted onto a coarse grid in a local metric frame, grown past
 * the outermost creeks (`reachCells`), closed so the bays between branches
 * fill in the way a ridge line would, and the outer edge traced, smoothed and
 * returned in lon/lat. It is a picture of roughly where the water comes from,
 * never a surveyed boundary: a client that words it says so.
 */

export type LonLat = [number, number];

export type CatchmentOutline =
  | { type: "Polygon"; coordinates: LonLat[][] }
  | { type: "MultiPolygon"; coordinates: LonLat[][][] };

export type CatchmentOutlineOptions = {
  /**
   * How far the land reaches past the outermost creeks, in grid cells. More
   * when the smallest creeks were left out of the lines (`trimmedBelowOrder`):
   * the tips then stop well short of the ridges.
   */
  reachCells?: number;
};

/** A grid cell is this share of the lines' longer side… */
const CELL_SHARE = 0.025;
/** …but never finer than a creek's own wobble or coarser than a gully. */
const MIN_CELL_M = 30;
const MAX_CELL_M = 250;
/** Bays narrower than about twice this many cells fill in. */
const CLOSE_CELLS = 6;
const DEFAULT_REACH_CELLS = 2;
const METRES_PER_DEGREE_LAT = 110_574;
const METRES_PER_DEGREE_LON_AT_EQUATOR = 111_320;

/** The outline of the land draining through `lines`, or null with no lines. */
export function catchmentOutline(
  lines: readonly (readonly LonLat[])[],
  { reachCells = DEFAULT_REACH_CELLS }: CatchmentOutlineOptions = {},
): CatchmentOutline | null {
  const points = lines.flat().filter(([x, y]) => Number.isFinite(x + y));
  if (points.length === 0) return null;

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lon, lat] of points) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  // A local flat frame around the middle: over a catchment's few tens of
  // kilometres the error is far below a cell.
  const lon0 = (west + east) / 2;
  const lat0 = (south + north) / 2;
  const kx =
    METRES_PER_DEGREE_LON_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  const ky = METRES_PER_DEGREE_LAT;
  const toX = (lon: number) => (lon - lon0) * kx;
  const toY = (lat: number) => (lat - lat0) * ky;

  const spanM = Math.max(toX(east) - toX(west), toY(north) - toY(south));
  const cell = Math.min(
    MAX_CELL_M,
    Math.max(MIN_CELL_M, spanM * CELL_SHARE, spanM / 400),
  );
  const reach = Math.max(0, reachCells);
  // Room on every side for the growing, so the border stays empty.
  const pad = Math.ceil(reach + CLOSE_CELLS) + 2;
  const x0 = toX(west) - pad * cell;
  const y0 = toY(south) - pad * cell;
  const nx = Math.ceil((toX(east) - toX(west)) / cell) + 2 * pad + 1;
  const ny = Math.ceil((toY(north) - toY(south)) / cell) + 2 * pad + 1;

  let grid: Uint8Array = new Uint8Array(nx * ny);
  const mark = (x: number, y: number) => {
    const i = Math.floor((x - x0) / cell);
    const j = Math.floor((y - y0) / cell);
    if (i >= 0 && j >= 0 && i < nx && j < ny) grid[j * nx + i] = 1;
  };
  for (const line of lines) {
    const xy = line
      .filter(([x, y]) => Number.isFinite(x + y))
      .map(([lon, lat]) => [toX(lon), toY(lat)] as const);
    if (xy.length === 1) mark(xy[0][0], xy[0][1]);
    for (let k = 1; k < xy.length; k++) {
      const [ax, ay] = xy[k - 1];
      const [bx, by] = xy[k];
      // Half-cell steps never skip a cell the segment crosses.
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 2)),
      );
      for (let s = 0; s <= steps; s++)
        mark(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
    }
  }

  // A closing: grow by the reach and the close together, fill what the
  // growth encloses, then shrink back by the close alone. Bays between
  // branches fill; the edge ends up `reach` past the outermost creeks.
  grid = grow(grid, nx, ny, reach + CLOSE_CELLS, 1);
  fillHoles(grid, nx, ny);
  grid = grow(grid, nx, ny, CLOSE_CELLS, 0);

  const rings = traceRings(grid, nx, ny)
    .map((ring) => smooth(ring, 0.5))
    .filter((ring) => ring.length >= 3 && signedArea(ring) > 0)
    .sort((a, b) => signedArea(b) - signedArea(a))
    .map((ring) => {
      const out = ring.map(
        ([i, j]): LonLat => [
          round6(lon0 + (x0 + i * cell) / kx),
          round6(lat0 + (y0 + j * cell) / ky),
        ],
      );
      out.push(out[0]);
      return out;
    });

  if (rings.length === 0) return null;
  return rings.length === 1
    ? { type: "Polygon", coordinates: [rings[0]] }
    : { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Grows the filled cells by a disc of `radius` cells (`into` 1), or grows the
 * empty ones, which shrinks the filled (`into` 0).
 */
function grow(
  grid: Uint8Array,
  nx: number,
  ny: number,
  radius: number,
  into: 0 | 1,
): Uint8Array {
  const offsets: [number, number][] = [];
  const r = Math.floor(radius);
  for (let dj = -r; dj <= r; dj++)
    for (let di = -r; di <= r; di++)
      if (di * di + dj * dj <= radius * radius) offsets.push([di, dj]);
  const out = new Uint8Array(grid);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (grid[j * nx + i] !== into) continue;
      for (const [di, dj] of offsets) {
        const a = i + di;
        const b = j + dj;
        if (a >= 0 && b >= 0 && a < nx && b < ny) out[b * nx + a] = into;
      }
    }
  return out;
}

/** Fills every empty cell the border cannot reach through empty cells. */
function fillHoles(grid: Uint8Array, nx: number, ny: number) {
  const outside = new Uint8Array(nx * ny);
  const stack: number[] = [];
  const visit = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return;
    const k = j * nx + i;
    if (grid[k] || outside[k]) return;
    outside[k] = 1;
    stack.push(k);
  };
  for (let i = 0; i < nx; i++) {
    visit(i, 0);
    visit(i, ny - 1);
  }
  for (let j = 0; j < ny; j++) {
    visit(0, j);
    visit(nx - 1, j);
  }
  while (stack.length > 0) {
    const k = stack.pop()!;
    const i = k % nx;
    const j = (k - i) / nx;
    visit(i + 1, j);
    visit(i - 1, j);
    visit(i, j + 1);
    visit(i, j - 1);
  }
  for (let k = 0; k < grid.length; k++) if (!outside[k]) grid[k] = 1;
}

type Edge = { from: [number, number]; to: [number, number]; used: boolean };

/**
 * The outer edges of the filled cells as closed rings of cell corners,
 * counter-clockwise (filled on the left). Where two filled cells touch only at
 * a corner the walk turns right, joining them, as the hole fill did.
 */
function traceRings(
  grid: Uint8Array,
  nx: number,
  ny: number,
): [number, number][][] {
  const filled = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < ny && grid[j * nx + i] === 1;
  const edges: Edge[] = [];
  const starting = new Map<number, Edge[]>();
  const key = ([i, j]: [number, number]) => j * (nx + 1) + i;
  const add = (from: [number, number], to: [number, number]) => {
    const edge = { from, to, used: false };
    edges.push(edge);
    const list = starting.get(key(from));
    if (list) list.push(edge);
    else starting.set(key(from), [edge]);
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!filled(i, j)) continue;
      if (!filled(i, j - 1)) add([i, j], [i + 1, j]);
      if (!filled(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
      if (!filled(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
      if (!filled(i - 1, j)) add([i, j + 1], [i, j]);
    }

  const rings: [number, number][][] = [];
  for (const first of edges) {
    if (first.used) continue;
    const ring: [number, number][] = [];
    let edge: Edge | undefined = first;
    while (edge && !edge.used) {
      edge.used = true;
      ring.push(edge.from);
      const dx = edge.to[0] - edge.from[0];
      const dy = edge.to[1] - edge.from[1];
      const next: Edge[] = (starting.get(key(edge.to)) ?? []).filter(
        (each) => !each.used,
      );
      // Right turn first: the cross product of the way in and the way out is
      // negative for a right turn.
      next.sort((a, b) => turn(dx, dy, a) - turn(dx, dy, b));
      edge = next[0];
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function turn(dx: number, dy: number, edge: Edge): number {
  return dx * (edge.to[1] - edge.from[1]) - dy * (edge.to[0] - edge.from[0]);
}

/**
 * A staircase of cell edges as a soft line: the midpoint of each step (which
 * turns stairs into diagonals), simplified to `tolerance` cells, then one round
 * of corner cutting.
 */
function smooth(
  ring: [number, number][],
  tolerance: number,
): [number, number][] {
  const mids = ring.map(([i, j], k): [number, number] => {
    const [a, b] = ring[(k + 1) % ring.length];
    return [(i + a) / 2, (j + b) / 2];
  });
  const simple = simplifyClosed(mids, tolerance);
  if (simple.length < 3) return simple;
  const cut: [number, number][] = [];
  for (let k = 0; k < simple.length; k++) {
    const [ax, ay] = simple[k];
    const [bx, by] = simple[(k + 1) % simple.length];
    cut.push(
      [0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by],
      [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by],
    );
  }
  return cut;
}

/** Douglas–Peucker on a closed ring, split at its two farthest-apart points. */
function simplifyClosed(
  ring: [number, number][],
  tolerance: number,
): [number, number][] {
  if (ring.length < 4) return ring;
  let far = 0;
  let best = -1;
  for (let k = 1; k < ring.length; k++) {
    const d = Math.hypot(ring[k][0] - ring[0][0], ring[k][1] - ring[0][1]);
    if (d > best) {
      best = d;
      far = k;
    }
  }
  const first = simplifyOpen(ring.slice(0, far + 1), tolerance);
  const second = simplifyOpen([...ring.slice(far), ring[0]], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function simplifyOpen(
  line: [number, number][],
  tolerance: number,
): [number, number][] {
  if (line.length <= 2) return line;
  const [ax, ay] = line[0];
  const [bx, by] = line[line.length - 1];
  const length = Math.hypot(bx - ax, by - ay);
  let worst = 0;
  let index = 0;
  for (let k = 1; k < line.length - 1; k++) {
    const [px, py] = line[k];
    const d =
      length === 0
        ? Math.hypot(px - ax, py - ay)
        : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
    if (d > worst) {
      worst = d;
      index = k;
    }
  }
  if (worst <= tolerance) return [line[0], line[line.length - 1]];
  return [
    ...simplifyOpen(line.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyOpen(line.slice(index), tolerance),
  ];
}

function signedArea(ring: [number, number][]): number {
  let sum = 0;
  for (let k = 0; k < ring.length; k++) {
    const [ax, ay] = ring[k];
    const [bx, by] = ring[(k + 1) % ring.length];
    sum += ax * by - bx * ay;
  }
  return sum / 2;
}

// One-off calibration for the per-source tile-size constants in
// `src/mapRegionEstimate.ts`. Samples real tiles from each offline-capable
// raster basemap over a bush bbox and prints mean/p90 bytes per zoom.
//
// Run: node shared/scripts/calibrate-basemap-tile-sizes.mjs
//
// Re-run this (and update the constants + their provenance comment) if a
// provider re-renders its cache or a new offline-capable source is added.
// The estimate is what the user sees before committing to a download, so a
// guessed constant is a lie with a progress bar attached.

// TWO areas, sampled together.
//
// The first pass used only bush, and the resulting estimate was 40 % under for a
// download centred on Katoomba: a topo tile over a town carries streets, labels
// and building fill, and measures ~1.5x a tile of bush at the same zoom. Users
// save the area around a trailhead, which is usually a town, so a bush-only
// calibration is a systematically optimistic estimate.
const BBOXES = [
  // Canyon country: dense contours, bush, no streets.
  { name: "bush", west: 150.15, south: -33.85, east: 150.35, north: -33.55 },
  // Katoomba / Leura / Blackheath: where the cars get left.
  { name: "town", west: 150.28, south: -33.75, east: 150.42, north: -33.6 },
];
const SAMPLES_PER_ZOOM_PER_BBOX = 7;

const SOURCES = [
  { id: "six-topo", service: "NSW_Topo_Map", maxZoom: 16 },
  { id: "six-base", service: "NSW_Base_Map", maxZoom: 18 },
  { id: "six-imagery", service: "NSW_Imagery", maxZoom: 18 },
];

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const phi = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * n);
  return { x, y };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function tileBytes(service, z, x, y) {
  const url = `https://maps.six.nsw.gov.au/arcgis/rest/services/public/${service}/MapServer/tile/${z}/${y}/${x}`;
  const response = await fetch(url);
  if (response.status === 404) return null; // uncached area — a "gap", not a size
  if (!response.ok) throw new Error(`${service} z${z} HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  return buffer.byteLength;
}

for (const source of SOURCES) {
  const perZoom = [];
  const all = [];
  for (let z = 12; z <= source.maxZoom; z++) {
    const sizes = [];
    let gaps = 0;
    for (const bbox of BBOXES) {
      const min = lonLatToTile(bbox.west, bbox.north, z);
      const max = lonLatToTile(bbox.east, bbox.south, z);
      for (let i = 0; i < SAMPLES_PER_ZOOM_PER_BBOX; i++) {
        const x = min.x + Math.floor(Math.random() * (max.x - min.x + 1));
        const y = min.y + Math.floor(Math.random() * (max.y - min.y + 1));
        const bytes = await tileBytes(source.service, z, x, y);
        if (bytes == null) gaps++;
        else {
          sizes.push(bytes);
          all.push(bytes);
        }
        // Politeness: the same ~3 tiles/s envelope the downloader itself uses.
        await new Promise((resolve) => setTimeout(resolve, 330));
      }
    }
    sizes.sort((a, b) => a - b);
    perZoom.push({
      z,
      n: sizes.length,
      gaps,
      mean: Math.round(sizes.reduce((sum, v) => sum + v, 0) / (sizes.length || 1)),
      p90: percentile(sizes, 90),
    });
  }
  all.sort((a, b) => a - b);
  console.log(`\n=== ${source.id} ===`);
  for (const row of perZoom) {
    console.log(
      `  z${row.z}  n=${row.n} gaps=${row.gaps}  mean=${row.mean}  p90=${row.p90}`,
    );
  }
  console.log(
    `  ALL   mean=${Math.round(all.reduce((sum, v) => sum + v, 0) / all.length)}  p90=${percentile(all, 90)}`,
  );
}

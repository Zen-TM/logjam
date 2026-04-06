# topo_mbtiles

Convert an **ELVIS (NSW Spatial Services) LiDAR ZIP** into a set of raster
**MBTiles** files ready to import into **Gaia GPS**.

---

## Output files

| File | Contents |
|------|----------|
| `hillshade.mbtiles` | Faint greyscale hillshade from DTM |
| `vegetation.mbtiles` | Semi-transparent walking-height vegetation density (0.25–2 m CHM) |
| `features.mbtiles` | OSM topo features: waterways, tracks, roads, buildings, power lines, campsites, peaks, springs, viewpoints, caves, picnic areas |
| `slope.mbtiles` | Slope angle overlay: 40–50° yellow → 50–60° orange → 60–70° red → 70°+ dark red |
| `contours.mbtiles` | 5 m contours (z16–z18), 10 m (z14–z15), 50 m (z12–z13); 50 m always labelled; 10 m labelled when 5 m contours are also showing |
| `composite.mbtiles` | All five layers composited in correct stacking order |

Zoom range: **z12–z18**

---

## Quick start (Docker — recommended)

### Prerequisites
- Docker Desktop (Windows/macOS) or Docker Engine (Linux)
- An ELVIS LiDAR ZIP downloaded from https://elvis.ga.gov.au/

### Steps

```bash
# 1. Clone / copy this project
git clone <this-repo> topo_mbtiles
cd topo_mbtiles

# 2. Create input/output directories
mkdir -p input output

# 3. Copy your ELVIS ZIP in
cp /path/to/your/elvis_download.zip input/elvis.zip

# 4. Build the Docker image (first time only – takes ~5 min)
docker compose build

# 5. Run
docker compose up

# MBTiles will appear in ./output/ when complete.
```

### Custom options

Edit the `command:` section in `docker-compose.yml`, or override at runtime:

```bash
docker compose run topo \
  /input/elvis.zip \
  --output /output \
  --workers 8 \
  --keep-work
```

| Flag | Default | Description |
|------|---------|-------------|
| `--output DIR` | `./output` | Where to write MBTiles |
| `--workers N` | CPU count − 1 | Parallel tile-render workers |
| `--work-dir DIR` | auto temp dir | Where to keep intermediate rasters |
| `--keep-work` | off | Don't delete intermediate files |
| `--skip-osm` | off | Skip Overpass API download (offline mode) |

---

## Running without Docker (Linux)

### System dependencies

```bash
# Ubuntu / Debian
sudo apt-get update
sudo apt-get install -y gdal-bin libgdal-dev python3-gdal pdal fonts-dejavu-core
```

### Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate

# GDAL Python bindings must match the system GDAL version
pip install "GDAL==$(gdal-config --version)"
pip install -r requirements.txt
```

### Run

```bash
python3 topo_mbtiles.py /path/to/elvis.zip --output ./output --workers 4
```

---

## How to import into Gaia GPS

1. Copy the `.mbtiles` files to your device (USB, Files app, cloud sync, etc.)
2. In Gaia GPS → **Map Layers** → **+** → **Import MBTiles**
3. Import each file. You can toggle layers on/off independently, or use `composite.mbtiles` as a single all-in-one layer.

**Tip:** Import `composite.mbtiles` for the full map, then import individual layers
(e.g. `slope.mbtiles`) as toggleable overlays on top.

---

## Architecture notes

### Why raster tiles and not vector?
Gaia GPS only accepts **raster MBTiles**. To preserve the "vector-like" appearance
of contours and OSM features at all zoom levels, each zoom level is rendered at its
**native tile resolution** with zoom-calibrated line widths and font sizes — rather
than scaling up lower-zoom tiles. This gives clean, sharp lines at every zoom level
without the overhead of true vector tiles.

### Processing pipeline

```
ELVIS ZIP
  └─ LAZ/LAS files
       └─ PDAL pipeline
            ├─ DTM (ground-return raster, 1 m resolution)
            │    ├─ Hillshade   (gdal.DEMProcessing)
            │    ├─ Slope       (gdal.DEMProcessing)
            │    └─ Contours    (gdal_contour CLI → GeoJSON)
            └─ DSM (max-return raster)
                 └─ CHM = DSM − DTM → vegetation density

OSM Overpass API → features GeoJSON (auto-fetched from tile bbox)

Parallel tile renderer (ProcessPoolExecutor)
  └─ For each (z, x, y):
       ├─ Read raster windows
       ├─ Render 5 × RGBA tiles
       ├─ Alpha-composite → composite tile
       └─ Write PNG to MBTiles (SQLite)
```

### Performance

| Area | Tiles (z12–z18) | 8-core VM | 4-core laptop |
|------|----------------|-----------|---------------|
| ~5 km² (1–2 LAZ) | ~3 000 | ~3 min | ~8 min |
| ~50 km² (10 LAZ) | ~25 000 | ~15 min | ~40 min |
| ~200 km² | ~100 000 | ~45 min | ~2 hr |

The bottleneck is the PDAL point-cloud processing step, which is single-threaded.
Tile rendering is fully parallelised across all available cores.

### GPU acceleration
GPU rendering is not implemented. For this pipeline (raster windowed reads +
Pillow compositing), parallelised CPU workers achieve near-equivalent throughput
to GPU-based tile rendering while avoiding CUDA/ROCm dependency complexity.

---

## Troubleshooting

**`pdal: command not found`**
Install PDAL: `sudo apt-get install pdal`

**`gdal_contour: command not found`**
Install GDAL tools: `sudo apt-get install gdal-bin`

**Overpass API timeout**
Large areas (> 100 km²) may hit the Overpass API rate limit. The script will warn
and produce an empty features layer. Re-run with `--skip-osm` and add OSM data
manually via the Overpass Turbo web export if needed.

**Empty or patchy output tiles**
This usually means the LiDAR tiles have nodata holes. The `fill_nodata` step
fills gaps up to 50 m across. For larger holes, increase `max_distance` in
`fill_nodata()`.

**Out of memory during PDAL**
Reduce the number of LAZ files processed at once, or increase the Docker memory
limit in `docker-compose.yml`.

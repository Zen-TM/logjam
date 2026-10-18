# Topo Pipeline

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

## Data sources & licences

Outputs are derived from third-party open data. Each source requires attribution
wherever the derived material is shared (in-app map UI and exported GeoPDF/MBTiles).
Attribution strings are centralised in `shared/src/geoPdfBaseLayers.ts`
(`GEOPDF_OVERLAY_ATTRIBUTION`).

| Source | Used for | Licence | Required credit |
|--------|----------|---------|-----------------|
| **ELVIS LiDAR** (Geoscience Australia + NSW Spatial Services) | hillshade, slope, contours | CC BY 4.0 | "Elevation data © Geoscience Australia / NSW Spatial Services (CC BY 4.0)" |
| **NSW State Vegetation Type Map (SVTM)** | vegetation | CC BY 4.0 *(to confirm via SEED portal — see note)* | "Vegetation data © State of NSW (DCCEEW) — State Vegetation Type Map (CC BY 4.0)" |
| **NPWS Fire History** (Wildfires and Prescribed Burns) | vegetation (fire-staleness hatch, see `apply_fire_history` in `pipeline.py`) | CC BY 4.0 | "© State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2010" |
| **OpenStreetMap** | features; the place registry Logjam searches | ODbL | "Features © OpenStreetMap contributors"; the registry: "© OpenStreetMap contributors" |
| **SIX Maps** (NSW DCS Spatial Services) | basemap | CC BY | "© Department of Customer Service (NSW) — SIX Maps, [year]" |

> **SVTM licence — unconfirmed.** NSW open data on the SEED portal
> (<https://datasets.seed.nsw.gov.au/>) is typically CC BY 4.0, but the exact
> SVTM licence and the precise required attribution string have not yet been
> verified. Confirm before any public release and update the credit strings if
> the licence differs.

> **NPWS Fire History — full citation:** © State Government of NSW and NSW
> Department of Climate Change, Energy, the Environment and Water 2010, NPWS
> Fire History - Wildfires and Prescribed Burns, accessed from The Sharing and
> Enabling Environmental Data Portal
> (<https://datasets.seed.nsw.gov.au/dataset/fire-history-wildfires-and-prescribed-burns-1e8b6>),
> date accessed 2026-07-05. Licensed CC BY 4.0
> (<https://creativecommons.org/licenses/by/4.0/>).

---

## Quick start (Docker — recommended)

### Prerequisites
- Docker Desktop (Windows/macOS) or Docker Engine (Linux)
- An ELVIS LiDAR ZIP downloaded from https://elvis.ga.gov.au/

### Steps

```bash
# 1. Clone / copy this project
git clone <this-repo> logjam-topo
cd logjam-topo

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
python3 pipeline.py /path/to/elvis.zip --output ./output --workers 4
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

## Building the NSW 5 m DEM archive

`build_nsw_dem.py` turns NSW Spatial Services' 5 m DEM sheets into the
`nsw-5m` archive Logjam reads heights from: terrarium PNG tiles, zoom 8 to 15,
in one PMTiles file. It is a one-off build, separate from the LiDAR pipeline
above, and needs GDAL with its Python bindings, NumPy, Pillow and the
[`pmtiles`](https://pypi.org/project/pmtiles/) Python package (all in
`requirements.txt`). Only `contours` also needs the
[`pmtiles`](https://github.com/protomaps/go-pmtiles) binary.

```bash
# One sheet, about 200 MB to download and 10 minutes to tile on 4 cores.
python3 build_nsw_dem.py fetch dem/src Katoomba
python3 build_nsw_dem.py tile dem/src dem/work --jobs 4
python3 build_nsw_dem.py pack dem/work dem/nsw-5m.pmtiles --extracted "October 2026"
```

`fetch` with no sheet named downloads all 343 (65 GB). `fetch` and `tile` skip
what is already done, so a stopped run carries on where it left off. The
format and why: [ADR 0030](../docs/decisions/0030-dem-tiles-are-terrarium-png-in-pmtiles.md).

Contours of the same sheets, as vector tiles for the vector basemap (10 m
lines, the 50 m ones from zoom 11 and the rest from zoom 14):

```bash
python3 build_nsw_dem.py contours dem/src dem/contours-work dem/contours-nsw.pmtiles \
  --extracted "October 2026"
```

A stopped contour run also carries on: each sheet's lines are kept whole or
not at all.

### The statewide build

All 343 sheets, once. Why Logjam hosts its own copy, and what the licence
asks: [ADR 0031](../docs/decisions/0031-nsw-heights-come-from-the-spatial-services-5m-dem.md).

Measured on the October 2026 build, on a 32-core machine with 128 GB of RAM:

| | |
|---|---|
| `fetch` | 1 h 49 min, one sheet at a time; about 60 GB on disk once converted |
| `tile` | 1 h 36 min with 30 workers, for 885 blocks (about 48 core-hours) |
| `pack` | 3 min |
| Result | 16.9 GB, 1,027,356 tiles |
| Disk | 96 GB in use when `pack` finished; allow 150 GB |

Any machine with GDAL and Python does: nothing here touches AWS
until the archive is published.

```bash
python3 build_nsw_dem.py fetch dem/src
python3 build_nsw_dem.py tile dem/src dem/work --jobs 30
python3 build_nsw_dem.py pack dem/work dem/nsw-5m.pmtiles --extracted "<Month Year>"
pmtiles show dem/nsw-5m.pmtiles     # zoom 8 to 15, bounds are NSW
```

Run `tile` only after `fetch` has finished: a block is built from every sheet
that touches it, and a finished block is not rebuilt when a neighbour arrives.

Publishing is a prod change and the maintainer's to make. The archive goes to
the topo bucket at the path `NSW_5M.archivePath` names in
`shared/src/demSources.ts`:

```bash
aws s3 cp dem/nsw-5m.pmtiles s3://logjam-topo-jobs/master/dem/nsw-5m.pmtiles \
  --content-type application/vnd.pmtiles
curl -s -o /dev/null -w '%{http_code}\n' -r 0-6 https://logjamnsw.com/master/dem/nsw-5m.pmtiles   # 206
```

No deploy is needed. The API looks for the archive every five minutes and
starts reading it when it appears; the clients read it on their next lookup.
If `--extracted` was not the month in `NSW_5M.credit`, change the credit in
the same week.

### The statewide slope archive

The same 5 m heights as a second archive, `nsw-5m-slope.pmtiles`, whose
"height" is the slope of the ground in degrees, rounded to 1°, so a client draws
it as a `raster-dem` `color-relief` layer and the bands are a style, not a
rebuild. Format and zooms: z15 is Horn's slope over the z15 height tiles
(`demSlopeAt` in `shared/src/demSlope.ts`, to 0.000004°), each coarser zoom to z8
the steepest pixel of the four below. A pixel is no-data wherever any of its nine
heights is.

`slope` reads the finished height archive, not the sheets, so it runs anywhere
that has the archive:

```bash
python3 build_nsw_dem.py slope dem/nsw-5m.pmtiles dem/nsw-5m-slope.pmtiles \
  --extracted "<Month Year>" --jobs 8
```

`--extracted` is the month the height archive was built with. The work files go
in `dem/nsw-5m-slope.work/` (`--work` moves them), one per block, and a stopped
run on the same disk carries on from the blocks it finished. The Python
`pmtiles` writer spools the archive through `$TMPDIR`: point it at the disk with
room if `/tmp` is a small tmpfs.

Measured on the Katoomba sheet (6 blocks, 3,649 tiles), on one core of a busy
laptop: 45 ms a tile on its fullest blocks (the PNG encoding is nearly all of it,
at level 6), 845 MB peak per job, and 107 MB against the height archive's
133 MB (it is one of the most rugged sheets, so a worst case). Scaled to the
state's 1.03 M tiles that is about 13 core-hours, so under two hours on 8 vCPU,
and 11 to 13 GB out.

#### Building it in AWS

Fargate has what it needs without a new task definition: the
`logjam-topo-worker` one has 8 vCPU and 16 GB, its role reads and writes the
topo bucket, and the image carries `build_nsw_dem.py` and the `pmtiles` package.
Its default disk is 20 GiB, so the run asks for more: about 17 GB of input, 13 GB
of block files, and a further 13 GB each for the MBTiles the packer builds, its
spool and the result. Run it after this has merged and *Deploy topo worker* has
pushed the image. The commands run from your machine with your AWS login; the
task, not you, moves the 17 GB:

```bash
cd infra/terraform/envs/prod
EXTRACTED="<Month Year>"   # as the height archive's credit
JOB='set -e; cd /tmp
python3 -c "import boto3; boto3.client(\"s3\").download_file(\"logjam-topo-jobs\", \"master/dem/nsw-5m.pmtiles\", \"nsw-5m.pmtiles\")"
python3 /app/build_nsw_dem.py slope nsw-5m.pmtiles nsw-5m-slope.pmtiles --extracted "'"$EXTRACTED"'" --jobs 8
python3 -c "import boto3; boto3.client(\"s3\").upload_file(\"nsw-5m-slope.pmtiles\", \"logjam-topo-jobs\", \"master/dem/nsw-5m-slope.pmtiles\", ExtraArgs={\"ContentType\": \"application/vnd.pmtiles\"})"'
aws ecs run-task --cluster "$(terraform output -raw ecs_cluster)" --launch-type FARGATE \
  --task-definition logjam-topo-worker \
  --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -raw ecs_subnets)],securityGroups=[$(terraform output -raw ecs_security_groups)],assignPublicIp=ENABLED}" \
  --overrides "$(jq -n --arg job "$JOB" '{ephemeralStorage: {sizeInGiB: 120},
      containerOverrides: [{name: "topo-worker", command: ["sh", "-c", $job]}]}')"
```

Follow it with `aws logs tail /ecs/logjam-topo-worker --follow` (one line per
finished block, 885 in all). A Fargate disk is gone when the task stops, so a
task that dies starts over: there is no resuming across tasks. When it has
exited 0, check the result as for the height archive:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -r 0-6 https://logjamnsw.com/master/dem/nsw-5m-slope.pmtiles   # 206
```

The image's command is now a `CMD`, which is what lets a RunTask command
override run this script under the worker's task role; the worker with no
override still starts `worker.py`. No Terraform changes.

---

## Building the place registry

`build_place_registry.py` turns Geofabrik's NSW OpenStreetMap extract into the
place registry Logjam's location search reads: every named feature, one row
each, in one gzipped JSON file. Why, and what it leaves out:
[ADR 0034](../docs/decisions/0034-location-search-reads-a-public-osm-place-registry.md).
A scheduled ECS task runs `publish` monthly; these commands are for trying a
change by hand. They need Python 3 and `pip install osmium boto3` (boto3 and AWS
credentials only for `publish`). Run them from `topo/`.

```bash
curl -fLO https://download.geofabrik.de/australia-oceania/australia/new-south-wales-latest.osm.pbf
python3 build_place_registry.py build new-south-wales-latest.osm.pbf places/
python3 build_place_registry.py measure new-south-wales-latest.osm.pbf
```

`build` writes `places-<extract date>-<hash>.json.gz` and its pointer `latest.json`:
about 4.5 MB, in under two minutes at a 1.3 GB peak. `measure` prints how much
each class of feature (roads, shops, creeks…) adds to the file, which is how
to judge a change to `EXCLUDED`.

`publish` downloads the extract, builds, and uploads the file then the pointer
to `master/places/v1/` in the topo bucket. The file goes up as
`places-<extract date>-<hash>.json`, still gzipped, with `Content-Encoding:
gzip`, so clients' HTTP stacks decompress it. It refuses a build much smaller than
the one it replaces. Publishing is a prod change and the maintainer's to make:

```bash
python3 build_place_registry.py publish --bucket logjam-topo-jobs
curl -s https://logjamnsw.com/master/places/v1/latest.json
```

After changing the file's shape, regenerate the fixture both sides test
against and bump `FORMAT` in `build_place_registry.py` and
`PLACE_REGISTRY_FORMAT` in `shared/src/placeRegistry.ts`:

```bash
REGENERATE_FIXTURE=1 python3 -m unittest tests.test_place_registry
(cd .. && npm run format)
```

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

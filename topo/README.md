# Topo Pipeline

Turns an **ELVIS (NSW Spatial Services) LiDAR ZIP** into a sharpened area:
`sharpen.py` writes height, slope and contour archives at the survey's own
cell ([Sharpening an area](#sharpening-an-area)), and, when the owner ticks
it, `pipeline.py` renders the walking-height vegetation layer from the ZIP's
point clouds.

---

## Data sources & licences

Outputs are derived from third-party open data. Each source requires attribution
wherever the derived material is shared (in-app map UI and exported GeoPDF/MBTiles).
Attribution strings are centralised in `shared/src/geoPdfBaseLayers.ts`
(`GEOPDF_OVERLAY_ATTRIBUTION`).

| Source | Used for | Licence | Required credit |
|--------|----------|---------|-----------------|
| **ELVIS LiDAR** (Geoscience Australia + NSW Spatial Services) | heights, slope, contours, vegetation | CC BY 4.0 | "Elevation data © Geoscience Australia / NSW Spatial Services (CC BY 4.0)" |
| **NSW State Vegetation Type Map (SVTM)** | vegetation | CC BY 4.0 *(to confirm via SEED portal — see note)* | "Vegetation data © State of NSW (DCCEEW) — State Vegetation Type Map (CC BY 4.0)" |
| **NPWS Fire History** (Wildfires and Prescribed Burns) | vegetation (fire-staleness hatch, see `apply_fire_history` in `pipeline.py`) | CC BY 4.0 | "© State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2010" |
| **OpenStreetMap** | the place registry Logjam searches | ODbL | "© OpenStreetMap contributors" |
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

## The vegetation pass

`pipeline.py` renders a ticked job's vegetation layer: PDAL counts the
returns over the ground, they become a scrub push-through density weighted by
the SVTM formation, and a hatch marks ground burned since the capture. Each
point cloud's ground is its own class 2 where it has any, and SMRF's where it
has none.

```bash
mkdir -p input output && cp /path/to/elvis_download.zip input/elvis.zip
docker compose build
docker compose up            # writes ./output/vegetation.mbtiles
```

Or, without Docker, with GDAL, PDAL and `requirements.txt` installed (the
GDAL Python bindings must match the system GDAL):

```bash
python3 pipeline.py /path/to/elvis.zip --output ./output --workers 4
```

| Flag | Default | Description |
|------|---------|-------------|
| `--output DIR` | `./output` | Where to write `vegetation.mbtiles` |
| `--workers N` | CPU count − 1 | Parallel tile-render workers |
| `--work-dir DIR` | auto temp dir | Where to keep intermediate rasters |
| `--keep-work` | off | Don't delete intermediate files |
| `--benchmark` | off | Print a per-step timing report at the end |
| `--settings-json PATH` | none | The job's settings; only `vegetation` is read (`TopoSettings` in `shared/src/topoSettings.ts`) |
| `--metrics-json PATH` | none | Write per-phase timings and tile counts to `PATH` |
| `--progress-file PATH` | none | Write `{done,total,ts}` progress to `PATH` |

A ZIP with no point clouds writes nothing.

---

## Building the NSW 5 m DEM archive

`build_nsw_dem.py` turns NSW Spatial Services' 5 m DEM sheets into the
`nsw-5m` archive Logjam reads heights from: terrarium PNG tiles, zoom 8 to 15,
in one PMTiles file. It is a one-off build, separate from the LiDAR pipeline
above, and needs GDAL with its Python bindings (installed separately, as in
[Running without Docker](#running-without-docker-linux)), and NumPy, Pillow and
the [`pmtiles`](https://pypi.org/project/pmtiles/) Python package (in
`requirements.txt`). Only `contours` and the `pmtiles show` check below need the
[`pmtiles`](https://github.com/protomaps/go-pmtiles) binary.

`pack` and `slope` write PMTiles with the Python package, which spools the
archive through `$TMPDIR`: point it at a disk with room if `/tmp` is a small
tmpfs, or `pack` fails with "Disk quota exceeded".

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

Measured on the October 2026 build, on a 32-core machine with 128 GB of RAM
(`pack` then used the go-pmtiles binary, which is quicker and spooled nothing
through `$TMPDIR`; `pack` now takes longer and about one archive more disk):

| | |
|---|---|
| `fetch` | 1 h 49 min, one sheet at a time; about 60 GB on disk once converted |
| `tile` | 1 h 36 min with 30 workers, for 885 blocks (about 48 core-hours) |
| `pack` | 3 min (go-pmtiles) |
| Result | 16.9 GB, 1,027,356 tiles |
| Disk | 96 GB in use when `pack` finished (go-pmtiles); allow 150 GB, and more with the Python writer |

Any machine with GDAL and Python (and the `pmtiles` binary for the check) does:
nothing here touches AWS until the archive is published.

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
the same week. A new height archive leaves the slope archive (below) on the old
heights and month: rebuild it, deleting `dem/nsw-5m-slope.work/` first if an
earlier local run left one.

### The statewide slope archive

The same 5 m heights as a second archive, `nsw-5m-slope.pmtiles`, whose
"height" is the slope of the ground in degrees, rounded to 1°, so a client draws
it as a `raster-dem` `color-relief` layer and the bands are a style, not a
rebuild. Format and zooms: z15 is Horn's slope over the z15 height tiles, the
method of `demSlopeAt` in `shared/src/demSlope.ts` (on the Katoomba sheet, 80
probe points differed from it by at most 0.000004° before rounding); each
coarser zoom to z8 is the steepest pixel of the four below. A pixel is no-data
wherever any of its nine heights is.

`slope` reads the finished height archive, not the sheets, so it runs anywhere
that has the archive:

```bash
python3 build_nsw_dem.py slope dem/nsw-5m.pmtiles dem/nsw-5m-slope.pmtiles --jobs 8
```

The archive's credit takes the month from the height archive's own credit. The
work files go in `dem/nsw-5m-slope.work/` (`--work` moves them), one per block,
and a stopped run on the same disk carries on from the blocks it finished. A
block that fails stops the run at once with its traceback, and a child killed
part-way (out of memory) stops it with an error rather than hanging it.

Measured on the Katoomba sheet (6 blocks, 3,649 tiles), on one core of a busy
laptop: 45 ms a tile on its fullest blocks (the PNG encoding is nearly all of it,
at level 6), 845 MB peak per job, and 107 MB against the height archive's
133 MB (it is one of the most rugged sheets, so a worst case). Scaled to the
state's 1.03 M tiles that is about 13 core-hours, or under two hours on 8 vCPU,
and 11 to 13 GB out. The statewide archive's directories are bigger than this
sheet's and every tile read decodes one, which could add a fifth: allow three
hours. It has not been run statewide.

#### Building it in AWS

Running it is a prod change and the maintainer's to make: it needs `ecs run-task`
and the Terraform outputs, which a contributor's read-only access does not have.
Fargate has what it needs without a new task definition: the
`logjam-topo-worker` one has 8 vCPU and 16 GB, its role reads and writes the
topo bucket, and the image carries `build_nsw_dem.py` and the `pmtiles` package.
The image starts `worker.py` as a `CMD`, which the run's command override
replaces.
The task runs `python3 /app/build_nsw_dem.py slope-s3 logjam-topo-jobs`, which
downloads `master/dem/nsw-5m.pmtiles`, builds the slope archive and uploads
`master/dem/nsw-5m-slope.pmtiles`, and exits non-zero at the first step that
fails (nothing is uploaded from a build that did not finish). Its default disk
is 20 GiB, so the run asks for 120: about 17 GB of input, 13 GB of block files,
and a further 13 GB each for the MBTiles the packer builds, its spool and the
result. Run it once *Deploy topo worker* has pushed an image that has `slope-s3`.
Run the blocks below in order, from `topo/` of a fresh clone, and stop at the
first one that prints an error.

The task holds 8 of the account's 30 Fargate vCPU for two to three hours, and the
API's cap on user jobs (`MAX_CONCURRENT_WORKER_VCPUS`, 24 by default, in
`api/src/lib/env.ts`) counts job rows, not tasks, so it does not see it. A user
job that starts while it runs can fail to start, and shows as failed, once user
load passes 22 vCPU. Run it when Logjam is quiet. The `logjam-topo-stuck-task`
alarm emails when some task has been running in each of six clock hours in a
row. This run can set it off if it takes over four hours, or with user jobs
running either side of it: that is expected, so do not stop the task because
of it.

First the cluster, subnets and security group. All three lines must print a
value:

```bash
cd "$(git rev-parse --show-toplevel)/infra/terraform/envs/prod" && terraform init -input=false && CLUSTER=$(terraform output -raw ecs_cluster) && SUBNETS=$(terraform output -raw ecs_subnets) && SG=$(terraform output -raw ecs_security_groups) && echo "$CLUSTER" && echo "$SUBNETS" && echo "$SG"
```

The later blocks use `CLUSTER`, `SUBNETS`, `SG` and `TASK`, and stop with an
error if one is not set. In a new shell, run the block above again, and set
`TASK` to the ARN the start block printed (keep it; while the task runs,
`aws ecs list-tasks --cluster "$CLUSTER" --started-by slope-build` finds it).

Then see what is running. Before the start the list should be empty (a user job
in it means wait); during the run it should hold only your task:

```bash
: "${CLUSTER:?run the first block}" && aws ecs list-tasks --cluster "$CLUSTER" --desired-status RUNNING
```

Start it. `TASK` must print a task ARN:

```bash
OUT=; : "${CLUSTER:?run the first block}" "${SUBNETS:?run the first block}" "${SG:?run the first block}" && OUT=$(aws ecs run-task --cluster "$CLUSTER" --started-by slope-build --launch-type FARGATE --task-definition logjam-topo-worker --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" --overrides '{"ephemeralStorage":{"sizeInGiB":120},"containerOverrides":[{"name":"topo-worker","command":["python3","/app/build_nsw_dem.py","slope-s3","logjam-topo-jobs","--jobs","8"]}]}' --output json)
TASK=$(jq -er '.tasks[0].taskArn' <<<"$OUT") || { TASK=; echo "NOT STARTED:"; jq '.failures' <<<"$OUT"; }
echo "$TASK"
```

If it printed `NOT STARTED`, nothing is running: read the failure reason and fix
it, then run the block again. Otherwise wait for the container to start. RunTask
accepts a task that then fails to pull the image or to start, and that would
otherwise look like a silent download:

```bash
if : "${CLUSTER:?run the first block}" "${TASK:?no task started}" && aws ecs wait tasks-running --cluster "$CLUSTER" --tasks "$TASK"; then echo RUNNING; fi
```

If it did not print `RUNNING`, read why with the `describe-tasks` command below
(`stoppedReason`); if the waiter timed out after 10 minutes, run it again.

Follow the log (the log group also holds every user job's streams):

```bash
: "${TASK:?run the start block}" && aws logs tail /ecs/logjam-topo-worker --follow --log-stream-name-prefix "ecs/topo-worker/${TASK##*/}"
```

The log reads, in order: `downloading s3://…/nsw-5m.pmtiles`, `downloaded N
bytes`, `N blocks` (885 at most), one `[n/N] …` line per finished block, `built N
bytes`, and `uploaded s3://…/nsw-5m-slope.pmtiles`. The download (`downloading`
to `downloaded`) and the packing (the last block line to `built`) are each
silent for tens of minutes. A block that fails stops the run with its
traceback. From the `N blocks` line on, if 15 minutes pass with no new block
line before the last `[n/N]`, stop the task and read the log:

```bash
: "${CLUSTER:?run the first block}" "${TASK:?run the start block}" && aws ecs stop-task --cluster "$CLUSTER" --task "$TASK"
```

After the last block line, wait for `uploaded s3://…`: the run has succeeded
when the log prints it. Press Ctrl-C then (the tail never exits by itself).
Confirm with the task, checking every 15 minutes: it has finished when this
prints `STOPPED`, with exit code `0` beside it. ECS forgets a stopped task after
about an hour, so read it within the hour:

```bash
: "${CLUSTER:?run the first block}" "${TASK:?run the start block}" && aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].[lastStatus,containers[0].exitCode,stoppedReason]' --output text
```

Later than that, the upload is the task's last step, so a `LastModified` after
the time you started the task means it exited 0:

```bash
aws s3api head-object --bucket logjam-topo-jobs --key master/dem/nsw-5m-slope.pmtiles --query '[LastModified,ContentLength,ContentType]'
```

A Fargate disk is gone when the task stops, so a task that dies starts over:
there is no resuming across tasks. Check the result as for the height archive;
it should print `206`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -r 0-6 https://logjamnsw.com/master/dem/nsw-5m-slope.pmtiles
```

---

## Sharpening an area

A job the API marks to sharpen (`topo_jobs.sharpen`, set at `/start` while
`SHARPEN_NEW_JOBS` in `shared/src/sharpen.ts` is on, as it is) runs `sharpen.py`
instead of `pipeline.py`. It writes the statewide terrain formats at the
survey's own cell: `heights.pmtiles` and `slope.pmtiles` (terrarium PNG,
z15 to z16 for 2 m ground or z17 for 1 m) and `contours.pmtiles` (10 m
lines at z14). Where the survey has no ground, each tile holds the statewide
5 m data, so a client takes every tile from one archive. Ground is the ZIP's
ELVIS DEM, or a TIN of the survey's class 2 when it has none, or of
SMRF's ground for a survey with no class 2 at all; a ZIP with only 5 m DEMs
fails with a sentence for its owner.

To run it by hand, put the two statewide archives in `./output/statewide`,
or a clip of them over the area (the [NSW 5 m DEM
archive](#building-the-nsw-5-m-dem-archive) and [the statewide slope
archive](#the-statewide-slope-archive) say how they are built), then:

```bash
docker compose run topo python3 /app/sharpen.py /input/elvis.zip /output/sharpened \
  --statewide-heights /output/statewide/nsw-5m.pmtiles \
  --statewide-slope /output/statewide/nsw-5m-slope.pmtiles
```

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

**Empty or patchy output tiles**
This usually means the LiDAR tiles have nodata holes. The `fill_nodata` step
fills gaps up to 50 m across. For larger holes, increase `max_distance` in
`fill_nodata()`.

**Out of memory during PDAL**
Reduce the number of LAZ files processed at once, or increase the Docker memory
limit in `docker-compose.yml`.

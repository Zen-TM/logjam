# 0048. The Weather overlay is public files cut from Open-Meteo's grids by a scheduled job, which alone runs Open-Meteo's GPL reader

- **Date:** 2026-11-07
- **Status:** Accepted
- **Supersedes:** —

## Context

Issue #832: "Show the weather here"
([0038](0038-a-forecast-request-sends-the-cell-not-the-spot.md)) answers
for one spot, but planning a canyon trip needs the region over time: where
rain will fall and when, how much fell this week, and wind and temperature on
the tops. Both clients need the same picture of NSW.

Open-Meteo publishes its gridded forecasts in a public S3 bucket
(`s3://openmeteo`, CC BY 4.0, sends `Access-Control-Allow-Origin: *`). The
`data_spatial/<model>/` layout holds one `.om` file per run and time step,
every variable of the globe in it, kept for 7 days. Measured on 2026-11-07
for `ecmwf_ifs` (IFS HRES):

- runs at 00, 06, 12 and 18 UTC; `latest.json` (4 KB) names the newest
  complete run about 6 hours after its run time;
- the grid is ECMWF's reduced Gaussian O1280 (about 9 km), not a lat/lon
  grid: 6,599,680 points in one dimension, in chunks of 1,024;
- steps are hourly to 90 h, 3-hourly to 144 h, 6-hourly to 360 h, and a
  3-hourly step's rain is the sum of its three hours (checked against the
  point API: 0.7 + 0.7 + 0.7 against 2.1);
- reading five variables for NSW from one step is about 0.3 MB per variable
  in a few range requests.

Every `.om` reader Open-Meteo publishes is GPL-2.0-only: `omfiles` on PyPI
(its `Cargo.toml` says `license = "GPL-2.0-only"`, its repository the GPL-2.0
text), `@openmeteo/file-reader` and `@openmeteo/weather-map-layer` on npm, and
the `om-file-format` C library under them. Logjam is AGPL-3.0-only
([0021](0021-agpl-and-dco.md)), and GPL-2.0-only code can't be combined with
GPL-3.0 or AGPL-3.0 code in anything conveyed to someone else.

## Decision

**The Weather overlay is files on our own CDN, the same for every user,
written by an hourly ECS job (`logjam-weather`, `topo/build_weather.py`) that
reads Open-Meteo's grids with Open-Meteo's own Python reader. The reader is
installed in the private topo worker image only, never in anything a user
receives.**

- **Public files.** Under `WEATHER_MAP.prefix` (`master/weather/v1/`):
  `latest.json` (the manifest, `WeatherMapFile` in
  `shared/src/weatherMap.ts`) and a folder per run, `runs/<run>/`, holding one
  PMTiles archive per field and step, one per rain total, and `wind.json`
  for the arrows. A run's files go up before the manifest names them, and the
  run before is kept, so a client holding the old manifest still finds its
  files. Guard: `topo/tests/test_weather.py` ("the manifest goes up last and
  two runs are kept"), and `shared/src/weatherMap.test.ts` against the
  fixtures the builder writes.
- **Hourly, building only on a new run.** The job reads `latest.json` each
  hour at 20 past and stops unless its `reference_time` is newer than the
  published run's. Runs land 5 to 8 hours after their run time, varying by
  model and day, so a run is published within the hour it lands, and most
  hours cost one 4 KB request. No guard holds the schedule; the job holds the
  comparison ("a published run is not built again").
- **The job's requests hold only the model's name and times,** never anything
  a user sent. Guard: `test_weather.py` ("urls hold only the model and
  times").
- **Values, not colours.** Each field is ADR 0030's terrarium encoding at
  z5 (about 4 km a pixel over the model's 9 km), over NSW with about 2°
  around it (`BOX`), and both clients colour it with a `color-relief`
  expression from `WEATHER_LAYERS`, as they draw the slope archive
  ([0039](0039-the-statewide-slope-archive-is-rounded-to-1-degree.md)). Rain
  is a rate over its step; temperature is rounded to 0.5°, wind and gusts to
  2 km/h, rain to 0.1. A run is about 12 MB: 105 steps of rain,
  temperature, wind and gusts, five totals, and the arrows.
- **Past rain is the model's estimate, never a measurement.** Each past hour
  is read from the run that began just before it (its first six hours), as
  Open-Meteo builds its Historical Forecast API; if that run is gone, from
  one up to 18 hours older. A total with an hour no run holds is left out of
  the manifest rather than drawn short. Guard: `test_weather.py` ("a total
  missing an hour is left out"). Totals count from the build's hour, which
  the manifest calls `anchor` and the clients label.
- **The reader is GPL-2.0-only and runs only in the job.** `omfiles` is in
  `topo/requirements.txt` and imported only inside `read_cut`; the image goes
  to the account's private ECR repository and is never published. No client
  package depends on an Open-Meteo reader. Guard: `test_weather.py` ("Open-
  Meteo's reader is in the worker image only"), which fails if `omfiles`
  appears in another requirements file or `@openmeteo/` in any
  `package.json` or lockfile.
- **Credit** is the manifest's `attribution`, "Weather data by
  Open-Meteo.com (CC BY 4.0), ECMWF IFS", drawn wherever the overlay is.

## Consequences

- **Positive:** viewing the overlay sends nothing to Open-Meteo and nothing
  about where anyone looks: every user reads the same files from our CDN, so
  this is less than "Show the weather here" sends. Logjam GPS draws it with
  the `raster-dem` and `color-relief` it already has, though Hermes runs no
  WebAssembly and MapLibre Native can't add a custom protocol, which rules
  out every browser reader. Totals need no client to read 168 steps.
- **Negative:** the job is one more scheduled task, alarm pair and image
  dependency for the maintainer, and Open-Meteo's layout is not a promised
  API: a change to the grid, the paths or the variables stops it, loudly
  (`check_source` refuses a grid other than O1280), and the overlay ages
  until it is fixed. Whoever conveys the topo worker image to anyone else
  would convey GPL-2.0-only code combined with AGPL-3.0 code: the image must
  stay private, which nothing but its ECR repository's policy enforces. A
  later client-side reader means writing our own decoder.
- **Neutral:** the bucket's 7 days limit past rain to a week; ERA5 runs 5
  days behind, so no reanalysis covers the last 72 hours either. Each build
  reads about 250 MB from the bucket, four times a day.

## Alternatives considered

- **Clients reading the public bucket directly.** Open-Meteo's own
  `@openmeteo/weather-map-layer` does this in a browser. It ships a
  GPL-2.0-only reader to users, Logjam GPS can't run it at all (WASM in a
  Web Worker; Hermes runs none and MapLibre Native has no custom protocol),
  the bucket's owner sees each user's IP and roughly where they look, and a
  total would mean reading every step on the device. Its README also says it
  isn't production-ready.
- **Our own `.om` decoder,** in the job or in the clients. It removes the
  licence question, and a client-side one would let a phone read the bucket.
  It means reimplementing Open-Meteo's chunked PFor-delta format and keeping
  up with its changes, for a job that can run their reader legally as it is.
  It stays the fallback if the image ever has to be conveyed.
- **Open-Meteo's point API over a grid of points.** NSW at 0.1° is about
  10,000 points a run against a free limit of 10,000 calls a day.
- **A fixed six-hourly schedule.** A run lands 5 to 8 hours after its run
  time, varying by model and day, so a fixed time waits needlessly or misses
  a run; the hourly check costs one small request.
- **Colour baked into the tiles** (a plain raster MapLibre could draw
  smoothly). The palette would be the job's, a legend change a rebuild, and
  the files couldn't answer a value.
- **Another model.** `dwd_icon`, `ncep_gfs013` and
  `ukmo_global_deterministic_10km` are coarser or less frequent; IFS is the
  finest hourly global grid here and has gusts, and Open-Meteo's best match
  for the Blue Mountains is already IFS. BoM's ACCESS-G is not in
  `data_spatial/`.
- **BoM radar for "now" and past rain.** The best source, but the Bureau's
  terms forbid automated access ([0038](0038-a-forecast-request-sends-the-cell-not-the-spot.md)).

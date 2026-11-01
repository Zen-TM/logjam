# GeoPDF parser fixtures

Committed binary fixtures for `shared/src/geoPdfImport/`. All coordinates are
the synthetic test extent (150.2–150.3 E, 33.6–33.7 S) or round fake MGA grid
numbers — no real place locations.

| File | What | Regeneration |
|---|---|---|
| `logjam-a5.pdf` | Current Logjam generator output (post WKT fix): A5 landscape, 20×14 px grey canvas, extent N -33.6 S -33.7 E 150.3 W 150.2 | Frozen output of the removed server writer (recoverable from git history before the PR that removed it). A new Logjam-written fixture comes from `frontend/src/geoPdf/pdf.ts` |
| `logjam-legacy-a5.pdf` | Pre-fix generator (commit `36281f5`): WKT emitted as a malformed PDF name (quirk Q0), page-fraction LPTS (Q1), `Type /PROJCS` (Q2) | Frozen output of the removed server writer at that commit (recoverable from git history); not regenerable |
| `gdal-mga56.pdf` | Third-party ISO32000 writer: 64×48 px checkerboard GeoTIFF in EPSG:28356 (TL E 250000 N 6270000, 10 m/px) → `gdal_translate -of PDF -co GEO_ENCODING=ISO32000` | GDAL ≥ 3.x on any host; exact commands in the Stage 6 session log |

`buildTestPdf.ts` is the tier-1c synthetic writer (built in-test, nothing
committed). Tier-3 NSW Spatial Services sheets are **not** committed (tens of
MB); the env-gated suite reads them from `GEOPDF_SAMPLE_DIR` when
`RUN_GEOPDF_SAMPLES=1`.

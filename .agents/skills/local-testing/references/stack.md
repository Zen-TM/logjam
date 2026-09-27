# API, Logjam Web and the dev stack

| Symptom | Cause | Fix |
|---|---|---|
| After `make shared`, the running API still runs the old `shared/` code (not data the seed wrote from it, which needs `make seed`) | nodemon ignores `node_modules`, which is where `@logjam/shared` resolves | Restart `npm run dev` in `api/`, or `touch api/src/index.ts` |
| Integration tests answer 500 in files your change does not touch; the API log shows a refused database connection | Postgres is down while the API process is still up | `docker compose ps`, bring it back with `make dev`, rerun. Not a regression |
| `POST /basemap/region-clip` answers 503 "Region clips are not available"; Logjam GPS says the vector map is unavailable for a region download | Local dev has no `PROTOMAPS_ARCHIVE_URI` or `pmtiles` binary by default | Expected locally; do not chase it. It needs the NSW archive and the `pmtiles` version `api/Dockerfile` pins |

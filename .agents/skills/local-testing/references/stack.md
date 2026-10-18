# API, Logjam Web and the dev stack

| Symptom | Cause | Fix |
|---|---|---|
| After `make shared`, the running API still runs the old `shared/` code (not data the seed wrote from it, which needs `make seed`) | nodemon ignores `node_modules`, which is where `@logjam/shared` resolves | Restart `npm run dev` in `api/`, or `touch api/src/index.ts` |
| Integration tests answer 500 in files your change does not touch; the API log shows a refused database connection | Postgres is down while the API process is still up | `docker compose ps`, bring it back with `make dev`, rerun. Not a regression |
| `POST /basemap/region-clip` answers 503 "Region clips are not available" | Local dev has no `PROTOMAPS_ARCHIVE_URI` or `pmtiles` binary by default. Only Logjam GPS builds older than the phone-cut clips call it | Expected locally; do not chase it. It needs the NSW archive and the `pmtiles` version `api/Dockerfile` pins |
| A region save in Logjam GPS reports the vector map, contours or 5 m heights as not finished | The phone cuts those clips by byte range from `EXPO_PUBLIC_TOPO_CDN_BASE_URL`, and that host does not serve the archive with `206` responses | Point it at a host that answers range requests for the archives under `master/` |

# 0034. Catchment lookups run on the API, from a GeoPackage it copies out of a private prefix

- **Date:** 2026-10-15
- **Status:** Accepted
- **Supersedes:** —

## Context

Logjam Web's "What is here?" popover shows how much land drains through the
creek nearest a point, and can draw every creek upstream of it. The answer
comes from the flow network layer: creek segments with their catchment area
at each end and the segment each flows into, built offline from the NSW 5 m
DEM by `topo/build_flow_network.py` and written as one GeoPackage (a SQLite
file with an R-tree index), with a `basins` layer saying what it covers.

A lookup needs the nearest segment to a point and, for the creeks upstream, a
walk of `flows_into` backwards: thousands of segments for a large river. The
whole Grose River (669 km²) is 13,490 segments and 4.3 MB; the state would be
hundreds of megabytes. Where someone is looking is private (root `AGENTS.md`),
and the API has Postgres without PostGIS.

## Decision

- **The API answers; clients never hold the layer.** `POST
  /flow-network/lookup` (`api/src/routes/flowNetwork.ts`) takes the point in
  the body and answers from the layer (`api/src/services/flowNetwork.ts`).
  The point is never logged or echoed in an error. Guards:
  `api/src/lib/logger.unit.test.ts` ("a catchment lookup's point"),
  `api/src/routes/flowNetwork.unit.test.ts`.
- **The layer lives outside what the CDN serves**: in the topo bucket at
  `FLOW_NETWORK_KEY` (`api/src/lib/flowNetwork/objectKey.ts`), under the
  `private/` prefix, never under `master/`. Guard:
  `api/src/lib/flowNetwork/objectKey.unit.test.ts`, which reads the prefixes
  the CDN policy grants.
- **The API reads the GeoPackage itself with `node:sqlite`.** On the first
  lookup it copies the file to local disk and opens it read-only; every five
  minutes at most it compares the object's ETag and swaps in a rebuild. No
  deploy publishes a new layer. The API's Node is at least 22.13, where
  `node:sqlite` is unflagged: CI's api jobs run 22, `api/Dockerfile` 26.
- **The credit** of [0031](0031-nsw-heights-come-from-the-spatial-services-5m-dem.md)
  comes with every answer (`NSW_5M.credit`) and on the map sources that draw
  it.

## Consequences

- **Positive:** no new infrastructure: a file in a bucket the API already
  reads, and no database extension. A rebuilt layer is one upload. Lookups are
  fast (the Grose outlet's 3,689 upstream segments in about 60 ms) and the
  upstream walk is one recursive query over an index on `flows_into`.
- **Negative:** every API instance downloads the whole layer, and the first
  lookup after a start or a rebuild waits for it: seconds for a basin,
  longer for the state. Each instance keeps a copy on its own disk.
- **Negative:** the API now sees the points people ask about, where heights
  are read by the clients themselves from the CDN. They are not logged, but
  they cross the network to us.
- **Negative:** a lookup needs a connection, so Logjam GPS cannot answer one
  offline; it has no catchment yet (a gap recorded in
  `shared/src/contracts/mapPoint.ts`).
- **Negative:** `node:sqlite` prints an ExperimentalWarning on Node 22, and
  the api CI jobs can no longer run on Node 20.
- **Neutral:** the layer must be uploaded by hand after a build, by whoever
  holds prod access (`topo/README.md`). Until then the route answers 503.

## Alternatives considered

- **The client reads the layer**, fetched in pieces from the CDN as the DEM
  is. A GeoPackage cannot be read in pieces; it would need vector tiles, the
  upstream walk needs the whole network at once, and the CDN would see which
  areas each user looks at (the trade 0031 accepted for heights, which is not
  needed here).
- **PostGIS.** The obvious home for spatial queries, but a database extension
  to run, a loading pipeline, and migrations for a read-only layer rebuilt a
  few times a year. Worth it only if the layer were written often, joined to
  users' data, or grew by an order of magnitude.
- **SQLite over S3 byte ranges**, without the copy. `node:sqlite` has no
  virtual file system for it, and an R-tree query and a recursive walk are
  many small reads each: tens of round trips per lookup.
- **better-sqlite3.** Mature and fast, but a native module: the
  `node:26-slim` image would need a build toolchain or a prebuilt binary for
  that Node, and `node:sqlite` needs neither.
- **The whole layer in memory as JavaScript objects.** Simple for one basin;
  hundreds of megabytes per instance for the state.

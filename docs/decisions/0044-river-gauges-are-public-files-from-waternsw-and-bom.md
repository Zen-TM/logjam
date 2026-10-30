# 0044. River gauges are public files, with readings from WaterNSW and history from the Bureau of Meteorology

- **Date:** 2026-10-30
- **Status:** Accepted
- **Supersedes:** —

## Context

Issue #682: a canyoner wants to see how much water is in the rivers around a
canyon, and to set a trip's gauge reading beside the one now. Both clients need
the same readings of about 280 NSW gauges, and neither can ask WaterNSW
directly: its Water Data API needs a subscription key issued to a person, its
Basic tier allows 29 calls a day and 5 a minute, and one call covers 20 sites.
The public Hydstra service sends no CORS headers and shares a queue of 20
requests.

WaterNSW's copyright page says: "You may copy, distribute, display, download
and otherwise freely deal with the information for any purpose, on the
condition that you include the copyright notice © State of New South Wales
through WaterNSW on all uses." It asks for permission to charge for access, to
include the information in a product for sale, or to modify a document. The
Bureau of Meteorology's Water Data Online lists WaterNSW as the owner of the
same stations' history under CC BY, with the attribution "© WaterNSW".

Measured on 2026-10-30: 279 of 884 sites in the 12 coastal basins reported
level in the previous 7 days; BoM's daily means reach back to 1971 for the Colo
at Upper Colo and run about two days behind.

## Decision

**Gauge readings reach clients as public files on the topo CDN, written by a
scheduled job, never through an API route or a client call to a gauge
service.**

- **Public files.** `topo/build_gauges.py` writes `latest.json` and
  `history/<id>.json` under `GAUGE_PREFIX` (`master/gauges/v1/`) in the topo
  bucket, which the web distribution serves without authentication, like the
  place registry ([0034](0034-location-search-reads-a-public-osm-place-registry.md)).
  They hold only public gauge data, the same for every user. The job's
  requests hold only a gauge id and constants. Guards:
  `topo/tests/test_gauges.py` ("urls hold only gauge ids and constants"), and
  `shared/src/gauges.test.ts` against the fixtures the builder writes.
- **Current readings come from WaterNSW's Water Data API,** fetched every two
  hours with the key in Secrets Manager (`logjam/waternsw-api-key`). The 20
  hot gauges named in the script are fetched on every run (12 calls a day);
  the rest once a day in chunks of 20 (13 calls), 4 spare. Guard:
  `topo/tests/test_gauges.py` ("hot and cold fit the daily quota"), which
  also holds the registry to 20 hot and 279 gauges.
- **A reading of no value, or quality 255 (Data Unavailable), is dropped.**
  The portal sends those as 0.000, which would read as a dry river. Guard:
  `topo/tests/test_gauges.py` ("a q255 zero never becomes a reading").
- **History comes from BoM's Water Data Online,** daily means of level and
  flow, extended once a day: a gauge without a history file gets its full
  series, otherwise the last 14 days are merged in. It is requested one gauge
  a second, and one gauge failing is left for tomorrow. Credit is always drawn:
  `attribution` in `latest.json` carries both notices.
- **Readings, never advice.** No copy built on these files says a river is
  safe, high or runnable.
- **A sharee sees the place's gauge, read-only; a trip's gauge reading stays
  owner-only,** because trips are. The column that links a place to a gauge
  arrives in a later PR, with the sharee test for this boundary.
- **A client fetches a gauge's history from our own CDN,** one file per gauge.
  The CDN logs show which gauge a client opened, and we hold those logs;
  WaterNSW and BoM never see a client. Shipping every gauge's history to every
  client instead would be tens of megabytes to hide which one was opened, a
  poor trade on a phone. Opening a gauge's panel is not tied to a place:
  anyone can open any gauge.

## Consequences

- **Positive:** guests and signed-in users read the same files with no call to
  our API and no user input to WaterNSW; no key ships in a client; the API
  gains no unauthenticated route.
- **Negative:** readings are up to two hours old for hot gauges and a day for
  the rest, plus the gauge's own delay. A WaterNSW outage or a lapsed key
  leaves the old file, which clients show with its age. 29 calls a day is a
  hard budget, so more hot gauges means fewer cold sweeps. The job and
  its key need the maintainer: the key is set by hand.
- **Neutral:** WaterNSW's terms bind redistribution only to the notice; a
  charge for access or a product for sale would need its permission, and
  Logjam does neither.

## Alternatives considered

- **An API route with a shared cache.** It needs auth or an open proxy to
  WaterNSW, shuts guests out or adds an unauthenticated route, and tells our
  API which gauge each user asks about.
- **Each client calling WaterNSW directly,** as weather calls Open-Meteo
  ([0038](0038-a-forecast-request-sends-the-cell-not-the-spot.md)). Keys are
  issued to a person who signs up, so every user would need a WaterNSW
  account.
- **Polling Hydstra.** It needs no key, but it sidesteps the quota WaterNSW
  publishes for the official API, and no terms for scheduled use were found.
- **History from WaterNSW.** Its Hourly and Instantaneous data reach back 168
  hours only; BoM serves the daily series since the 1970s under CC BY with no
  key.
- **The nearest gauge chosen automatically.** It gives a confident answer
  about the wrong river; a person picks, from a list.

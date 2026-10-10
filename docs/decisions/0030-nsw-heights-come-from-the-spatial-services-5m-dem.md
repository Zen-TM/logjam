# 0030. Heights in NSW come from the Spatial Services 5 m DEM, built once into our own archive

- **Date:** 2026-10-10
- **Status:** Accepted
- **Supersedes:** —

## Context

Logjam read every height from the public Terrain Tiles on AWS Open Data, which
in NSW are 1-arcsecond SRTM: posts about 30 m apart, heights in whole metres,
with tree canopy included. Measured against LiDAR over 11 × 18 km of Blue
Mountains escarpment (#341), 24 % of the area was more than 20 m out and the
floor of one major valley read about 280 m too high. A slope cannot be shown
honestly from it at all (#352).

NSW Spatial Services publishes a statewide 5 m DEM as 343 sheets (65 GB
zipped), a 2020 snapshot: bare earth, from LiDAR on the coast and ranges and
from photogrammetry further west. On six whole sheets it met its stated ±0.9 m
at 88 to 100 % of survey marks.

Its licence is Creative Commons Attribution 3.0 Australia, with two terms of
its own in the metadata shipped in every sheet: a derived product must
"clearly mark the date that any extractions ... occurred", and the data
"should only be loaded on any external cloud platforms if [the] Intellectual
Property ... remains unchanged, maintained and preserved".

## Decision

- **The source.** Inside NSW and the ACT, heights come from the Spatial
  Services 5 m DEM: the `NSW_5M` entry in `shared/src/demSources.ts`, ahead of
  the worldwide tiles, which still answer wherever it has no height
  ([0028](0028-a-height-comes-from-the-finest-dem-source-that-has-it.md)).
- **Our own copy.** `topo/build_nsw_dem.py` builds every sheet into one
  archive, kept in the topo bucket beside the vector basemap
  ([0029](0029-dem-tiles-are-terrarium-png-in-pmtiles.md)). Nothing asks
  Spatial Services for data at run time.
- **All of the state**, not only the rugged or forested parts.
- **The credit** is shown wherever a height from it is shown, and names the
  publisher, that the data is derived, the licence, and the month the sheets
  were downloaded. The same text is in the archive's metadata. It is
  `NSW_5M.credit`; the build takes the month as `--extracted`.
- **A rebuild** replaces the whole archive and updates the month in the credit
  in the same change.

No guard test enforces the credit's wording. `shared/src/demSources.test.ts`
checks that a result credits the sources it was read from.

## Consequences

- **Positive:** heights, profiles, and gain and loss in NSW are read from a
  surface good to about a metre on open ground. A slope reading and contours
  become possible. Requests for heights in NSW go to our own CDN as byte
  ranges, where they went to a third party's bucket as tile indices.
- **Negative:** Logjam now hosts and is responsible for a 16 GB derived
  dataset: up to about 150 core-hours to rebuild, storage and egress on our account,
  and a credit that goes stale if the archive is rebuilt and the text is not.
  The data is a 2020 snapshot and is wrong where the ground has changed since.
  Where it comes from photogrammetry, the publisher warns of no-data and lower
  accuracy on steep, shadowed or forested ground; that ground was not tested.
- **Negative:** the second licence term can be read as forbidding a derived
  form on a cloud host. That reading contradicts the Creative Commons grant
  beside it, and the publisher's own data is served from AWS through ELVIS, so
  the decision is to build on the other reading: keep the notice and licence with
  the data. Spatial Services has not been asked. If they answer otherwise, the
  archive is deleted and `NSW_5M` removed; the worldwide tiles then answer
  again with no other change.
- **Neutral:** NSW heights are AHD and the worldwide tiles are EGM96. They
  differ by well under a metre here and no correction is made.

## Alternatives considered

- **Keep the worldwide tiles.** No hosting and no licence to keep. Rejected on
  the measurements above: wrong by tens of metres in canyon country, which is
  where Logjam is used.
- **Copernicus GLO-30 instead.** Open, worldwide, and it does not have SRTM's
  280 m valley error. Still a 30 m surface with canopy: 17 % of the test area
  more than 20 m out, and slope within ±5° at 66 % of points against 57 %.
- **Only the rugged, reserved and coastal parts of the state.** 14 GB against
  21 GB at the rounding first measured, a saving of about 17 cents a month,
  for a mask to maintain and a seam wherever a route leaves it.
- **The 1 to 2 m LiDAR DEMs from ELVIS.** Finer, but they cover part of the
  state, are delivered by email order with no bulk download, and would be
  several times the size.
- **Ask Spatial Services' servers per request.** No copy to host. It would
  send where each user is looking to a third party, depend on their
  availability in the field, and still need tiling for offline areas.

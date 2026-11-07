# 0047. Measured rain is a public file of WaterNSW's gauges, drawn within 15 km and filled from the model only where a gauge has not reported

- **Date:** 2026-11-07
- **Status:** Accepted
- **Supersedes:** —

## Context

Issue #839. The weather view's past-days row was Open-Meteo's `past_days`
output (`shared/src/weather.ts`, ADR [0038](0038-a-forecast-request-sends-the-cell-not-the-spot.md)):
a model with no gauge or radar correction, ECMWF IFS at about 9 km in the Blue
Mountains. Over 29 Oct to 4 Nov 2026 it put 17.5 mm on a cell where five
gauges within 25 km measured 14.5 to 62.5 mm. A canyoner asks how much fell
in a catchment before a trip, and a model that smooths storms answers a
different question.

The Bureau of Meteorology's Water Data Online (WDO), the keyless KiWIS
service ADR [0044](0044-river-gauges-are-public-files-from-waternsw-and-bom.md)
already reads for river history, carries the 9am-to-9am totals of the rain
stations of WaterNSW and other owners (`DMQaQc.Merged.DailyTotal.09HR`,
stamped at the period's end). Measured on 2026-11-07 at 17:00 AEDT:

- **Freshness.** The tips behind the totals (`DMQaQc.Merged.AsStored.1`)
  reached 5 Nov 09:00 AEST, so the newest whole period began on 4 Nov: about
  two days behind. WDO sends the next period as `null` with quality `-1`; on
  2026-11-05 the research behind #839 also saw a newest total summed from
  part of its day.
- **Owners.** With the registry's filter (inside `NSW_BOX`, a total in the
  last ten days), 225 live series are WaterNSW's, 223 of them with a
  station-number id; 22 NSW series name no owner, Snowy Hydro has 17, Gosford
  City Council 3 and Central Coast Council 1. WDO's copyright page says use
  is "subject to the terms and conditions of the supplying organisations"; it
  lists WaterNSW, Sydney Water and Central Coast Council under CC BY, Snowy
  Hydro under other conditions, and says nothing for the rest.
- **Faults.** Two WaterNSW series were wrong for the whole year to
  2026-10-31: Stonequarry Creek at Picton (212053) is a running counter (3,029
  to 64,328 mm "a day"), and Cobbong (568072) had 66 days over 100 mm.
- **Distance.** Over the year to 2026-10-31, at 87 gauges in canyon country
  (-35.8..-32.7, 149.4..151.1), each gauge's measured week was predicted by
  Open-Meteo's archived best-match forecast at that gauge (the figures the
  client draws) and by every other gauge, by distance. Method: WDO's daily
  totals, leaving out missing values and the two faulty series; Open-Meteo's
  historical-forecast API at each gauge's point, best match, hourly rain
  summed over the same 9am-to-9am AEST periods; the error of a prediction is
  |predicted − measured| ÷ measured, over the periods at or above a
  threshold, with weeks as consecutive seven-day runs with no day missing;
  the median is over every gauge pair in a distance band. The scripts were
  one-off and are not kept: the steps above redo them. On weeks of 20 mm or
  more, the median relative error:

  | Neighbour gauge at | 0–4 km | 4–8 | 8–12 | 12–16 | 16–20 | 20–25 | 30–40 |
  |---|---|---|---|---|---|---|---|
  | Week ≥ 20 mm | 19% | 21% | 27% | 33% | 35% | 38% | 44% |
  | Day ≥ 10 mm | 18% | 32% | 36% | 42% | 47% | 50% | 58% |

  The model's were 30% on wet weeks and 48% on wet days. A gauge beats the
  model on weeks out to about 12 km and on days out to about 20 km.
- **Coverage.** Against the 60 canyons of the built-in OzUltimate list
  (`shared/src/ozUltimate.ts`), each placed at its name in the OpenStreetMap
  place registry (ADR [0034](0034-location-search-reads-a-public-osm-place-registry.md))
  within 15 km of its area's locality, or at that locality where no name
  matched (24 of 60), the nearest WaterNSW gauge is within 12 km of 22, within
  15 km of 38 and within 20 km of 56. The Wollangambe canyons sit 16 to 21 km
  from Greaves Creek; Wollemi's heart and the Budawangs are further still.

## Decision

**Measured rain reaches clients as one public file of WaterNSW's rain gauges,
published by the gauge job; a client draws the nearest gauges within 15 km,
each on its own row, and the model only for the days a gauge has not
reported.**

- **A public file beside the river gauges'.** `topo/build_gauges.py`
  (`publish_rain`) writes `rain.json` under `GAUGE_PREFIX` (`RainFile`,
  `shared/src/rainGauges.ts`) on every two-hourly run, first and apart from
  the WaterNSW calls: a BoM failure leaves the old file and exits non-zero
  after the river files are out, and WaterNSW's quota is not touched. The
  file holds each station's totals for the ten periods before today, dated by
  the morning the period began. Its requests hold only series ids and
  constants. Guards: `topo/tests/test_gauges.py` ("rain urls hold only series
  ids and constants", "a rain failure still publishes latest",
  "rain is published even when waternsw fails"), and
  `shared/src/rainGauges.test.ts` against the fixture the builder writes.
- **WaterNSW's stations only.** `rain-registry` keeps a live station whose
  WDO owner is in `RAIN_OWNERS` ("NSW - Water NSW"), whose terms ADR 0044
  read: free use with "© State of New South Wales through WaterNSW" on it,
  which `attribution` carries and both clients draw under the rows. The list
  is committed (`topo/rain_gauges.json`), as `gauges.json` is. Left out, and
  why: the 20 stations with no owner named, among them Katoomba Cascade Dam,
  Warragamba and the Greater Sydney dams and the regional storages (WaterNSW
  lists most of them on its HydroTel pages, but WDO names no owner and BoM
  says to ask one; an owner's word would let them in); Snowy Hydro's 17 (not
  CC BY; "please contact them"); Gosford City Council's 3 (no terms found);
  Central Coast Council's one (CC BY, but a hand-kept copy of a Manly
  Hydraulics Laboratory gauge, whose data needs MHL's written permission).
  Sydney Water's stations are CC BY but had no live daily total. Guards:
  `test_gauges.py` ("the registry keeps only cleared owners"); the credit,
  `frontend/src/components/weather/weather.test.tsx` ("fetches the public
  file with the forecast and draws the gauge near") and
  `mobile/src/weather/weatherContracts.test.ts` ("draws the rain gauges'
  credit beside Open-Meteo's").
- **A missing or partial day is never a dry one.** A total WDO marks missing
  (`null`, quality `-1`), one stamped past the last tip WDO holds, or one
  outside 0 to 400 mm is `null` in the file. `rain-registry` drops a series
  whose last year has a median above 1 mm (a counter) or more than ten days
  over 100 mm. Guards: `test_gauges.py` ("a day without a whole total is null
  never dry", "a faulty year is dropped from the registry").
- **15 km, a trade-off.** `RAIN_GAUGE_MAX_M`. On a wet week a neighbour is
  as good as the model to about 12 km and a few points worse from 12 to 16
  (33% against 30%); on a wet day it is better to about 20 km; and it catches
  the storm the model smears. 15 km keeps a gauge for 38 of the built-in
  canyons against 22 at 12 km; past about 16 km the model wins the weekly
  total, the figure the row sums. Guard: `rainGauges.test.ts` ("stops at the
  cutoff").
- **Picked on the device, each gauge named.** `nearbyRain` takes the nearest
  three within 15 km that measured at least one of the days shown, nearest
  first; each is a row titled with its name and distance, never an average.
  The spot never leaves the device: the file is the same for everyone. Past
  15 km the row is the model's and says no gauge is near; a near gauge with
  nothing for the days says that instead. Guards: `shared/src/weather.test.ts`
  ("draws a row for each gauge, named, with its distance", "says why the row
  is the model's"), `rainGauges.test.ts` ("tells a near gauge with no data
  from no gauge near").
- **The model fills only what a gauge has not sent,** drawn as modelled: the
  card says "Model", its bar is muted, and it is read aloud as modelled. On a
  normal day that is the newest one or two. Guards: `shared/src/weather.test.ts`
  ("fills a day the gauge has none for from the model, marked"),
  `frontend/src/components/weather/weather.test.tsx` ("fetches the public file
  with the forecast and draws the gauge near").
- **Fetched with the forecast, on the same press,** over mobile data as the
  forecast is, whatever the sync setting: the press is the user's own ask.
  Logjam Web waits at most 15 s for it and keeps nothing; Logjam GPS never
  waits and keeps the last file in its gauges directory, which the sign-out
  wipe deletes. It shows no age: the totals are dated, so an old file only
  leaves more days to the model, each marked. Guards:
  `mobile/src/gauges/gaugeFeed.test.ts` ("refreshRain"), `weather.test.tsx`
  ("shows the forecast without the file when it stalls").

## Consequences

- **Positive:** the row shows what fell where someone measured it, storms
  included; the spot is sent nowhere, not even as the model's cell; no key and
  no quota.
- **Negative:** measured days end about two days back, so the newest one or
  two are still the model's. Katoomba's nearest gauge (Katoomba Cascade Dam,
  3.5 km) is not shown until its owner is confirmed; Wollangambe, Wollemi and
  the Budawangs mostly fall back to the model. The cutoff comes from one year
  of one model; a different year, or a different model chosen in the view,
  would move it a little. The station list is a committed file someone must
  regenerate (`python3 build_gauges.py rain-registry`) as stations come and
  go. Every run makes about 17 BoM calls (5 for coverage, 12 for values).
- **Neutral:** the model's past row is unchanged where there is no gauge, so
  the fallback is what shipped before.

## Alternatives considered

- **Keep the model only.** Costs nothing and misses storms (Context).
- **Reach today with SILO.** SILO's DataDrill and Patched Point APIs run a day
  ahead of WDO and are CC BY 4.0, but need an email address as the username;
  a gridded value is interpolated (17.5 mm on the day gauges read 10 to 51),
  and a station's newest day may be patched rather than measured. Not without
  an address the maintainer chooses to give, and then only for one day.
- **Reach today with WaterNSW's Water Data API.** Hours behind rather than
  days, but its Basic tier's 29 calls a day are already 26 spent (ADR 0044);
  the three left are the river job's room for failure.
- **WaterNSW's HydroTel pages or the realtimedata site.** Fresh, keyless HTML
  with a "9AM Rain" column, but no terms for automated use; ADR 0044 already
  turned down polling Hydstra.
- **Clients call WDO directly** for the nearest series from a shipped list.
  A request names a series, not a spot, but BoM states no rate limit, a
  client cannot tell a partial day, and a per-user call to a government
  service is outside what 0044 chose.
- **BoM's Registered User feeds.** Paid.
- **A person picks the gauge, as for rivers.** ADR 0044 has a person pick a
  river gauge because a level belongs to one river and the nearest is often
  another's. Rain is an area's: the nearest few, each named with its distance,
  show its spread, so none is picked for the user and none is averaged.
- **Once a day,** as the issue proposed. WDO lands in batches at a time not
  measured (its tips did not move between 17:00 and 18:00 on 7 Nov), so a run
  at a fixed hour could miss a batch by most of a day; every run costs 17
  keyless calls.
- **Average the nearest gauges.** On 3 Nov 2026 Greaves Creek read 51.5 mm
  and Medlow Bath 39 mm, about 1 km apart; an average hides which catchment got
  the storm.
- **A 25 km cutoff** (the issue's guess), **or 12 km.** At 25 km a gauge is
  worse than the model on a wet week (38% against 30%); at 12 km 16 of the
  built-in canyons lose a gauge that is still about as good as the model.
- **Date a total by its end**, as BoM does. Most of a 9-to-9 period's rain
  falls in the afternoon of the day it began, the day Open-Meteo's calendar
  day covers; dated by its end, a storm would show on the day after.

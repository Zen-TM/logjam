# 0038. A forecast request sends the 0.1° cell and the height, never the spot, straight from the client to Open-Meteo

- **Date:** 2026-10-18
- **Status:** Accepted
- **Supersedes:** —

## Context

Both clients show the weather for a place on its page and for a point
pressed on the map, behind "Show the weather here" (`WEATHER` in
`shared/src/contracts/weather.ts`). The forecast has to come from a third
party, and the position the user asks about is often one they keep
unpublished. A request with the exact coordinates gives the place away, and
every press would add one more.

The free providers' terms, read 2026-10-18:

| | |
|---|---|
| Open-Meteo | Free for non-commercial use: no subscriptions, no ads. Under 10,000 calls a day, 5,000 an hour, 600 a minute, counted per IP (the maintainer, open-meteo discussion #853). CC BY 4.0. No key; serves browsers (CORS). |
| MET Norway | Commercial use allowed, 20 requests a second per application. Requires a server proxy for mobile and browser apps, an identifying User-Agent, at most 4 decimals, and honouring `Expires`. CC BY 4.0. |
| Bureau of Meteorology | The site's terms forbid automated extraction; `api.weather.bom.gov.au` is undocumented; its data licences are paid. |

The forecast models behind Open-Meteo's NSW answer have cells of 1.5 to
25 km, so a coordinate finer than about 0.1° (11 × 9 km in NSW) adds nothing
to the forecast. Height does matter: Open-Meteo corrects temperature for
terrain from the height it is given, or else from its own DEM at the
requested point, and in canyon country the cell's centre can be hundreds of
metres above or below the spot.

## Decision

**A forecast request carries the 0.1° cell around the spot and the spot's
height to the nearest 10 m, and nothing else about it. It goes from the
client straight to Open-Meteo, never through our API, and only when the user
presses for it.**

- **The cell, not the spot.** `weatherCell` in `shared/src/weather.ts` snaps
  the position to the 0.1° grid and the height to 10 m; `weatherRequestUrl`
  builds the request only from a cell, so no client can send more. Guard:
  `shared/src/weather.test.ts` ("sends only the cell, never the spot").
- **Never logged.** The request URL holds the cell, so `fetchForecast`'s
  errors never include it. Guard: `weather.test.ts` ("fails without naming
  the cell"). Logjam GPS's crash reports already reduce any URL to
  `[redacted-url]`: `mobile/src/sentry/scrubEvent.test.ts`.
- **Straight from the client.** A guest gets the weather like anyone, with no
  route on our API to guard or log, and each device spends its own per-IP
  allowance. No guard: Logjam Web's CSP `connect-src` is what allows the host
  (`frontend/src/cspAgreement.test.ts` keeps the policy and its record in
  step).
- **On a press, never by itself.** Opening a place or pressing the map sends
  nothing; "Show the weather here" does. Nothing polls (and
  [0013](0013-background-work-battery-rules.md) would forbid it behind a dark
  screen). No guard.
- **Logjam GPS keeps the last forecast per cell** and shows it offline with
  its age, in a store declared in `mobile/src/offline/localStores.ts` and
  emptied by the wipe ([0006](0006-on-device-data-privacy.md)). Guard:
  `localStores.test.ts`. Logjam Web keeps none.
- **The credit is always drawn,** as CC BY 4.0 requires: `WEATHER.copy.credit`
  linking `WEATHER_CREDIT_URL`, a section of the contract both clients render.

## Consequences

- **Positive:** a forecast for any spot, for guests too, with no new API
  route, no key and no cost; the provider learns a cell that holds many
  published canyons, not a place.
- **Negative:** Open-Meteo still sees the user's IP with each cell, and the
  height narrows the spot to a band of contour within it. `privacy.html`
  says so. The free tier is non-commercial: subscriptions or ads would need
  Open-Meteo's paid plan, or MET Norway behind a proxy. Rain is the cell's,
  not the catchment's, and a forecast for a point near a cell's edge is the
  neighbouring ground's as much as its own.
- **Neutral:** the figures both clients draw are `weatherDayFacts`; change
  them there.

## Alternatives considered

- **Through our API:** it would hide the user's IP from Open-Meteo and share
  one cache between users. Rejected: every user would then count against one
  server IP's free allowance, a guest would need an unauthenticated route,
  and the route would be one more place a cell could be logged. Open-Meteo
  would still see every cell.
- **The exact coordinates:** precision the models cannot use, for the one
  piece of the request that gives a place away.
- **No height:** temperatures off by several degrees between plateau and
  canyon floor.
- **MET Norway:** commercial use is allowed, but its terms require the proxy
  rejected above, and a User-Agent a browser cannot set. The fallback if
  Logjam ever charges.
- **The Bureau of Meteorology:** the official forecast, but its terms forbid
  automated access and its feeds are paid.
- **A self-hosted Open-Meteo:** no third party at all, for the price of
  downloading and serving model runs for one button.
- **Fetching on opening a place:** every place opened would send its cell,
  wanted or not.

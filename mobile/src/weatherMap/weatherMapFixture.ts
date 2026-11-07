import type { WeatherMapFile } from "@logjam/shared";

/** A made-up run of four hourly steps, for tests. */
export const weatherFixture: WeatherMapFile = {
  format: 1,
  model: "ecmwf_ifs",
  run: "2026-11-07T00:00Z",
  built: "2026-11-07T09:07Z",
  anchor: "2026-11-07T09:00Z",
  path: "runs/20261107T0000Z/",
  bounds: [139, -39.5, 156, -26],
  zoom: 5,
  steps: [
    { time: "2026-11-07T09:00Z", hours: 1 },
    { time: "2026-11-07T10:00Z", hours: 1 },
    { time: "2026-11-07T11:00Z", hours: 1 },
    { time: "2026-11-07T12:00Z", hours: 1 },
  ],
  totals: ["rainPast168", "rainNext24"],
  attribution: "Weather data by Open-Meteo.com (CC BY 4.0), ECMWF IFS",
};

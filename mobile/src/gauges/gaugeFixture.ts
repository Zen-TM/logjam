import type { GaugeLatestFile } from "@logjam/shared";

/** Made-up readings at real public gauge ids, for tests. */
export const gaugeFixture: GaugeLatestFile = {
  version: 1,
  generatedAt: "2026-10-31T00:00:00.000Z",
  coldSweptAt: "2026-10-31T00:00:00.000Z",
  attribution: "© WaterNSW",
  gauges: [
    {
      id: "212290",
      name: "COLO R @ UPPER COLO",
      lat: -33.41832,
      lon: 150.72589,
      hot: true,
      hasFlow: true,
      readings: [[1_793_000_000, 0.9, 120]],
    },
  ],
};

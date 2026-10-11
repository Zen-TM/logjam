// A track file's page charts the file: both charts for a recording, no speed
// chart for a file without times, and one download however often it is opened.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatDurationMs,
  TRACK_PROFILE_COPY,
  type ElevationProfile,
} from "@logjam/shared";

import { createRouteHoverChannel, type RouteHover } from "../../map/routeHover";
import type { Stat } from "../../../ui";
import { clearTrackTexts } from "../../media/trackGeo";
import TrackProfiles from "./TrackProfiles";

const dem = vi.hoisted(() => ({
  profile: null as (ElevationProfile & { attribution: string }) | null,
  asked: [] as unknown[],
}));
vi.mock("../../../placeUtils", () => ({
  useElevationProfile: (line: unknown) => {
    dem.asked.push(line);
    return { profile: line ? dem.profile : null, loading: false, error: null };
  },
}));

// Synthetic coords only (repo rule). Twelve fixes a minute apart, climbing.
const trkpts = (timed: boolean) =>
  Array.from({ length: 12 }, (_, i) => {
    const time = `<time>2026-01-01T00:${String(i).padStart(2, "0")}:00Z</time>`;
    return `<trkpt lat="${(-33.6 - i * 0.0005).toFixed(4)}" lon="150.2000"><ele>${700 + i * 20}</ele>${timed ? time : ""}</trkpt>`;
  }).join("");
const gpx = (timed: boolean) =>
  `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>${trkpts(timed)}</trkseg></trk></gpx>`;

function show(mediaId: string, text: string, stored: Stat[] = []) {
  const fetchMock = vi.fn(async () => new Response(text));
  vi.stubGlobal("fetch", fetchMock);
  const displayUrl = vi.fn(() => "https://files.test/track");
  const routeHover = createRouteHoverChannel();
  const view = render(
    <TrackProfiles
      source={{ mediaId, filename: "walk.gpx", displayUrl }}
      stored={stored}
      color="#F97316"
      routeHover={routeHover}
    />,
  );
  return { fetchMock, displayUrl, view, routeHover };
}

beforeEach(() => {
  clearTrackTexts();
  dem.profile = null;
  dem.asked = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TrackProfiles", () => {
  it("charts a recording's heights and speed from the file", async () => {
    show("timed", gpx(true));
    expect(screen.getByText(TRACK_PROFILE_COPY.reading)).toBeTruthy();
    await screen.findByText(TRACK_PROFILE_COPY.elevationTitle);
    expect(screen.getByText(TRACK_PROFILE_COPY.speedTitle)).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /^Elevation profile: 700 m to 920 m/ }),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: /^Speed profile: / })).toBeTruthy();
    // No terrain answered, so the page says whose heights these are.
    expect(
      screen.getByText("Heights from GPS — no terrain data here"),
    ).toBeTruthy();
    // The terrain is asked about the track as SEGMENTS, never one joined line.
    expect(dem.asked[dem.asked.length - 1]).toEqual([expect.any(Array)]);
  });

  it("prefers the terrain when it answers the whole line", async () => {
    dem.profile = {
      samples: [
        { distanceM: 0, elevationM: 400 },
        { distanceM: 600, elevationM: 480 },
      ],
      gainM: 80,
      lossM: 0,
      minM: 400,
      maxM: 480,
      attribution: "Terrain credit",
    };
    show("terrain", gpx(true));
    await screen.findByText("Heights from terrain data");
    expect(
      screen.getByRole("img", { name: /^Elevation profile: 400 m to 480 m/ }),
    ).toBeTruthy();
    expect(screen.getByText("Terrain credit")).toBeTruthy();
  });

  it("draws no speed chart for a file without times", async () => {
    show("untimed", gpx(false));
    await screen.findByText(TRACK_PROFILE_COPY.elevationTitle);
    expect(screen.queryByText(TRACK_PROFILE_COPY.speedTitle)).toBeNull();
  });

  it("lists the file's figures in Logjam GPS's order, the row's own kept", async () => {
    const { view } = show("rows", gpx(true), [
      { label: "Distance", value: "stored km" },
      { label: "Size", value: "12 kB" },
    ]);
    await screen.findByText(TRACK_PROFILE_COPY.elevationTitle);
    const labels = [...view.container.querySelectorAll("dt")].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual([
      "Time",
      "Distance",
      "Moving",
      "Stopped",
      "Ascent",
      "Descent",
      "Avg speed",
      "Avg moving speed",
      "High point",
      "Low point",
      "Size",
    ]);
    // The row's distance, not the one measured from the file.
    expect(screen.getByText("stored km")).toBeTruthy();
    // Eleven minutes between the first fix and the last, all of it moving.
    expect(screen.getAllByText(formatDurationMs(660_000))).toHaveLength(2);
  });

  it("marks the map where the track was at the speed cursor's time", async () => {
    const { routeHover } = show("hover", gpx(true));
    const chart = await screen.findByRole("img", { name: /^Speed profile: / });
    const seen: RouteHover[] = [];
    routeHover.subscribe((hover) => seen.push(hover));
    // jsdom lays nothing out, so the cursor lands on the first sample: the
    // start of the recording, which is the first fix.
    fireEvent.pointerMove(chart, { clientX: 0 });
    await waitFor(() =>
      expect(seen[seen.length - 1]).toEqual({
        position: [150.2, -33.6],
        color: "#F97316",
      }),
    );
    fireEvent.pointerLeave(chart);
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("shows only the row's figures for a file with no line", async () => {
    const { view } = show(
      "waypoints",
      `<?xml version="1.0"?><gpx version="1.1" creator="test"><wpt lat="-33.6" lon="150.2"/></gpx>`,
      [{ label: "Size", value: "12 kB" }],
    );
    await waitFor(() =>
      expect(screen.queryByText(TRACK_PROFILE_COPY.reading)).toBeNull(),
    );
    expect(view.container.textContent).toBe("Size12 kB");
  });

  it("says so in our own words when the file cannot be read", async () => {
    show("broken", "<gpx><trk>");
    await screen.findByText("Couldn't read that file.");
  });

  it("downloads a file once, and asks for a URL only on the first open", async () => {
    const first = show("again", gpx(true));
    await screen.findByText(TRACK_PROFILE_COPY.elevationTitle);
    cleanup();
    const second = show("again", gpx(true));
    await screen.findByText(TRACK_PROFILE_COPY.elevationTitle);
    expect(first.fetchMock).toHaveBeenCalledTimes(1);
    expect(second.fetchMock).not.toHaveBeenCalled();
    expect(second.displayUrl).not.toHaveBeenCalled();
  });
});

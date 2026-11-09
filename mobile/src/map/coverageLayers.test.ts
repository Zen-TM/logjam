import {
  COVERAGE_HATCH_IMAGE,
  COVERAGE_HATCH_PIXEL_RATIO,
  COVERAGE_HATCH_URIS,
  COVERAGE_MIN_ZOOM,
  coverageFilter,
  coverageOpacity,
  zoomFadeIn,
} from "@logjam/shared";
import { describe, expect, it, vi } from "vitest";
import {
  COVERAGE_IMAGES,
  coverageAtTap,
  coverageLayerFilter,
  coverageLayerId,
  coverageLayerPaint,
  coverageMinZoom,
  pickCoverageCarrier,
} from "./coverageLayers";

describe("coverageLayerPaint", () => {
  // Mutation: build the pattern or the opacity from anything but shared's,
  // and the map hatches where the legend says there is reception, or draws a
  // hatch it doesn't key; drop the fade, and it pops in at its first zoom.
  it("paints with exactly shared's expressions", () => {
    expect(coverageLayerPaint()).toEqual({
      "fill-pattern": COVERAGE_HATCH_IMAGE,
      "fill-opacity": zoomFadeIn(COVERAGE_MIN_ZOOM, coverageOpacity()),
    });
  });
});

describe("coverageLayerFilter", () => {
  // Mutation: ignore `carrier` and the map draws every carrier's gaps at once.
  it("keeps one carrier's areas", () => {
    expect(coverageLayerFilter("optus")).toEqual(coverageFilter("optus"));
    expect(coverageLayerFilter("optus")).not.toEqual(
      coverageLayerFilter("telstra"),
    );
  });
});

describe("COVERAGE_IMAGES", () => {
  // Mutation: key the hatch by anything but shared's name, and the
  // fill-pattern names an image the style does not have: the gap draws bare.
  // Drop the scale, and the 2x hatch draws twice as coarse as Logjam Web's.
  it("registers the hatch shared's paint names, at its pixel ratio", () => {
    expect(COVERAGE_IMAGES).toEqual(
      Object.fromEntries(
        Object.entries(COVERAGE_HATCH_URIS).map(([name, uri]) => [
          name,
          { source: { uri, scale: COVERAGE_HATCH_PIXEL_RATIO } },
        ]),
      ),
    );
    expect(Object.keys(COVERAGE_IMAGES)).toEqual([COVERAGE_HATCH_IMAGE]);
  });
});

describe("coverageLayerId", () => {
  // Mutation: drop the key, and two saved areas' layers share an id.
  it("is one per source", () => {
    expect(coverageLayerId("b")).not.toBe(coverageLayerId("a"));
  });
});

describe("coverageMinZoom", () => {
  // Mutation: return `layerMinZoom ?? 0` alone, and a CDN source draws
  // coverage below COVERAGE_MIN_ZOOM from a clip that holds coarser tiles.
  it("never draws below COVERAGE_MIN_ZOOM", () => {
    expect(coverageMinZoom(undefined)).toBe(COVERAGE_MIN_ZOOM);
    expect(coverageMinZoom(COVERAGE_MIN_ZOOM - 2)).toBe(COVERAGE_MIN_ZOOM);
    expect(coverageMinZoom(COVERAGE_MIN_ZOOM + 1)).toBe(COVERAGE_MIN_ZOOM + 1);
  });
});

describe("coverageAtTap", () => {
  const queried: unknown[] = [];
  const map = {
    queryRenderedFeatures: async (box: unknown, options: unknown) => {
      queried.push([box, options]);
      return [
        { properties: { level: "outdoor" } },
        { properties: { level: "none" } },
      ];
    },
  };

  // Mutation: query other layers than the ones drawn, or name another carrier,
  // and a tap answers nothing or for the wrong network.
  it("reads the drawn layers at the press, for the drawn carrier", async () => {
    queried.length = 0;
    expect(await coverageAtTap(map, [100, 50], ["a", "b"], "optus")).toBe(
      "Optus: no mobile reception",
    );
    expect(queried).toEqual([[[100, 50], { layers: ["a", "b"] }]]);
  });

  // Mutation: drop the carrier test, and a tap before the pick asks a layer
  // that isn't drawn, or names a network nobody chose.
  it("answers nothing with no carrier or no layer", async () => {
    queried.length = 0;
    expect(await coverageAtTap(map, [1, 2], ["a"], null)).toBeNull();
    expect(await coverageAtTap(map, [1, 2], [], "optus")).toBeNull();
    expect(await coverageAtTap(null, [1, 2], ["a"], "optus")).toBeNull();
    expect(queried).toEqual([]);
  });
});

describe("pickCoverageCarrier", () => {
  const pick = (
    previous: "telstra" | null,
    disabled: boolean,
    value = "tpg",
  ) => {
    const on = { choose: vi.fn(), turnOn: vi.fn() };
    pickCoverageCarrier(value, previous, disabled, on);
    return on;
  };

  // Mutation: drop the turn-on, and the user who pressed "Choose your
  // carrier" must still find the switch; turn on at every pick, and changing
  // carrier switches a hidden overlay back on.
  it("turns the overlay on at the first pick only", () => {
    const first = pick(null, false);
    expect(first.turnOn).toHaveBeenCalledOnce();
    expect(first.choose).toHaveBeenCalledWith("tpg");
    const later = pick("telstra", false);
    expect(later.turnOn).not.toHaveBeenCalled();
    expect(later.choose).toHaveBeenCalledWith("tpg");
  });

  // Mutation: ignore the switch's state, and offline with no saved clip the
  // overlay is stored on behind a switch that says it can't be.
  it("leaves a disabled switch as it was, and refuses a value no build offers", () => {
    const offline = pick(null, true);
    expect(offline.turnOn).not.toHaveBeenCalled();
    expect(offline.choose).toHaveBeenCalledWith("tpg");
    const stale = pick(null, false, "vodafone");
    expect(stale.choose).not.toHaveBeenCalled();
    expect(stale.turnOn).not.toHaveBeenCalled();
  });
});

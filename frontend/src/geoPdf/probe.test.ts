import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CanvasFactory,
  probeCanvasLimits,
  readCachedLimits,
  writeCachedLimits,
} from "./probe";
import { STRIP_MAX_PX } from "./strips";

type Fake = { width: number; height: number; px: number };
type Limits = {
  /** Over this single size: allocate but read back zeros (Safari). */
  silentAbove?: number;
  /** Over this single size: throw. */
  throwAbove?: number;
  /** Live pixels over this: read back zeros. */
  totalBudget?: number;
  maxDim?: number;
};

function fakeBrowser(l: Limits) {
  const all: Fake[] = [];
  let calls = 0;
  const live = () => all.reduce((s, c) => s + c.width * c.height, 0);
  const make: CanvasFactory = (width, height) => {
    calls++;
    if (
      (l.throwAbove && width * height > l.throwAbove) ||
      (l.maxDim && (width > l.maxDim || height > l.maxDim))
    ) {
      throw new Error("too big");
    }
    const c: Fake = { width, height, px: 0 };
    all.push(c);
    const blank =
      (l.silentAbove !== undefined && width * height > l.silentAbove) ||
      (l.totalBudget !== undefined && live() > l.totalBudget);
    return {
      get width() {
        return c.width;
      },
      set width(v) {
        c.width = v;
      },
      get height() {
        return c.height;
      },
      set height(v) {
        c.height = v;
      },
      getContext: () => ({
        fillStyle: "",
        fillRect: () => {
          c.px = 1;
        },
        getImageData: () => ({
          data: blank ? [0, 0, 0, 0] : [10, 20, 30, 255],
        }),
      }),
    };
  };
  return { make, all, calls: () => calls };
}

describe("probeCanvasLimits", () => {
  it("measures a desktop with no limits in five allocations", async () => {
    const b = fakeBrowser({});
    const l = await probeCanvasLimits({ makeCanvas: b.make });
    expect(l.maxCanvasPx).toBe(STRIP_MAX_PX);
    expect(l.maxTotalPx).toBeGreaterThanOrEqual(2 * STRIP_MAX_PX + 2_000_000);
    expect(l.maxWidth).toBe(STRIP_MAX_PX / 16);
    expect(b.calls()).toBe(5);
    expect(b.all.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });

  // mutation: trust allocation without reading the pixel back
  it("counts a canvas that reads back blank as failed (Safari)", async () => {
    const b = fakeBrowser({ silentAbove: 8_000_000, maxDim: 65_536 });
    const l = await probeCanvasLimits({ makeCanvas: b.make });
    expect(l.maxCanvasPx).toBeLessThanOrEqual(8_000_000);
    expect(l.maxCanvasPx).toBeGreaterThan(7_000_000);
    expect(l.maxWidth).toBeLessThanOrEqual(65_536);
    expect(l.maxWidth).toBeGreaterThan(65_536 - 256);
    expect(b.calls()).toBeLessThan(40);
    expect(b.all.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });

  // mutation: remove the try/catch around allocation
  it("counts a throw as failed", async () => {
    const b = fakeBrowser({ throwAbove: 4_000_000 });
    const l = await probeCanvasLimits({ makeCanvas: b.make });
    expect(l.maxCanvasPx).toBeLessThanOrEqual(4_000_000);
    expect(l.maxCanvasPx).toBeGreaterThan(3_000_000);
    expect(b.all.every((c) => c.width === 0)).toBe(true);
  });

  // mutation: stop at the first canvas instead of accumulating, or never free the live ones
  it("finds the total budget and stops when one fails", async () => {
    const b = fakeBrowser({ silentAbove: 16_600_000, totalBudget: 40_000_000 });
    const l = await probeCanvasLimits({ makeCanvas: b.make });
    expect(l.maxCanvasPx).toBe(STRIP_MAX_PX);
    // 16 MP-ish canvases: two fit in 40 MP, the third reads blank.
    expect(l.maxTotalPx).toBeGreaterThan(30_000_000);
    expect(l.maxTotalPx).toBeLessThanOrEqual(40_000_000);
    expect(b.all.every((c) => c.width === 0 && c.height === 0)).toBe(true);
    expect(b.calls()).toBeLessThan(10);
  });

  it("measures an iPhone 8: 16.6 MP single, 64 MP total", async () => {
    const b = fakeBrowser({
      silentAbove: 16_600_000,
      totalBudget: 64_000_000,
      maxDim: 65_536,
    });
    const l = await probeCanvasLimits({ makeCanvas: b.make });
    expect(l.maxCanvasPx).toBe(STRIP_MAX_PX);
    expect(l.maxTotalPx).toBeGreaterThanOrEqual(34_000_000);
    expect(l.maxWidth).toBeGreaterThan(65_000);
  });
});

describe("limits cache", () => {
  const limits = { maxCanvasPx: 1, maxTotalPx: 2, maxWidth: 3 };
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips", () => {
    writeCachedLimits(limits);
    expect(readCachedLimits()).toEqual(limits);
  });

  // mutation: drop the user-agent comparison
  it("ignores limits stored under another user agent", () => {
    writeCachedLimits(limits);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("other");
    expect(readCachedLimits()).toBeNull();
  });

  it("ignores malformed values", () => {
    for (const raw of [
      "{",
      "null",
      '{"ua":1}',
      JSON.stringify({ ua: navigator.userAgent, limits: { maxCanvasPx: "x" } }),
    ]) {
      localStorage.setItem("logjam.geoPdf.canvasLimits.v1", raw);
      expect(readCachedLimits()).toBeNull();
    }
  });

  // mutation: remove the try/catch in read/write
  it("swallows storage errors", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(readCachedLimits()).toBeNull();
    expect(() => writeCachedLimits(limits)).not.toThrow();
  });
});

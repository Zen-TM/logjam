import { describe, expect, it } from "vitest";
import {
  FIRE_RAMP,
  fireColor,
  fireEdgeOpacity,
  fireFillOpacity,
  fireLegendRows,
  fireNameOf,
  fireTintAt,
  NSW_FIRE,
} from "./nswFire.js";
import { LAND_CLASSES } from "./nswLand.js";
import { RASTER_TEMPLATE_DEFAULTS } from "./topoSettings.js";

type Props = Record<string, unknown>;

/** The few expression operators the ramp uses, as MapLibre evaluates them. */
function evaluate(expr: unknown, props: Props): unknown {
  if (!Array.isArray(expr)) return expr;
  const [op, ...args] = expr as [string, ...unknown[]];
  const n = (i: number) => evaluate(args[i], props) as number;
  switch (op) {
    case "get":
      return props[args[0] as string];
    case "+":
      return n(0) + n(1);
    case "-":
      return n(0) - n(1);
    case "*":
      return n(0) * n(1);
    case "/":
      return n(0) / n(1);
    case "interpolate": {
      expect(args[0]).toEqual(["linear"]);
      const x = n(1);
      const stops = args.slice(2);
      const at = (i: number) => stops[i] as number;
      if (x <= at(0)) return stops[1];
      for (let i = 2; i < stops.length; i += 2) {
        if (x <= at(i)) {
          const [a, b] = [stops[i - 1], stops[i + 1]];
          if (typeof a !== "number") return { from: a, to: b };
          const t = (x - at(i - 2)) / (at(i) - at(i - 2));
          return a + ((b as number) - a) * t;
        }
      }
      return stops[stops.length - 1];
    }
    default:
      throw new Error(`unexpected operator ${op}`);
  }
}

const NOV_2026 = new Date(2026, 10, 7);
const fire = (year: number, month: number, type?: number) => ({
  properties: {
    [NSW_FIRE.yearProperty]: year,
    [NSW_FIRE.monthProperty]: month,
    ...(type === undefined ? {} : { [NSW_FIRE.typeProperty]: type }),
  },
});

describe("the fire tint", () => {
  // Mutation: count from the fire's year alone (or from January), and a fire
  // in December reads a year older than it is.
  it("counts the years since the fire's month, as of today", () => {
    const fill = fireFillOpacity(NOV_2026);
    // December 2019 to November 2026 is 83 months, 6.92 years.
    expect(evaluate(fill, fire(2019, 12).properties)).toBeCloseTo(
      fireTintAt(83 / 12).fill,
      9,
    );
    expect(evaluate(fill, fire(2026, 11).properties)).toBe(FIRE_RAMP[0].fill);
  });

  // Mutation: let the last stop keep some opacity, and every old fire tints.
  it("is darkest within the year and gone by ten years", () => {
    const fill = fireFillOpacity(NOV_2026);
    const edge = fireEdgeOpacity(NOV_2026);
    const at = (year: number, month: number) => ({
      fill: evaluate(fill, fire(year, month).properties) as number,
      edge: evaluate(edge, fire(year, month).properties) as number,
    });
    expect(at(2026, 1).fill).toBe(at(2026, 10).fill);
    expect(at(2022, 6).fill).toBeLessThan(at(2025, 6).fill);
    expect(at(2022, 6).fill).toBeGreaterThan(0);
    expect(at(2016, 11)).toEqual({ fill: 0, edge: 0 });
    expect(at(1975, 1)).toEqual({ fill: 0, edge: 0 });
  });

  // Mutation: change a stop in one expression alone, and the legend's
  // swatches no longer match the map.
  it("draws what fireTintAt says, in every property", () => {
    for (const [expression, key] of [
      [fireColor(NOV_2026), "colour"],
      [fireFillOpacity(NOV_2026), "fill"],
      [fireEdgeOpacity(NOV_2026), "edge"],
    ] as const) {
      expect(expression.slice(3)).toEqual(
        FIRE_RAMP.flatMap((stop) => [stop.years, stop[key]]),
      );
    }
    expect(fireTintAt(0)).toEqual({ ...FIRE_RAMP[0] });
    expect(fireTintAt(30)).toEqual({ ...FIRE_RAMP[FIRE_RAMP.length - 1] });
    expect(fireTintAt(2.5)).toEqual({
      colour: "#cd206a",
      fill: 0.375,
      edge: 0.8,
    });
  });

  // Mutation: make the ramp a fire's red or orange, or Land's purple, and
  // the tint reads as a slope band or a holding.
  it("is a hue neither Slope's default bands nor Land's edges use", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [0, 1, 2].map(
        (i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255,
      ) as [number, number, number];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      const h =
        max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
      return (h * 60 + 360) % 360;
    };
    const others = [
      ...RASTER_TEMPLATE_DEFAULTS.slope.bands.map((band) => band.colour),
      ...LAND_CLASSES.filter(
        ({ source }) => source !== "Unresolved Tenure",
      ).map((c) => c.colour),
    ];
    for (const { colour } of FIRE_RAMP) {
      for (const other of others) {
        const apart = Math.abs(hue(colour) - hue(other.slice(0, 7)));
        expect(Math.min(apart, 360 - apart)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  // Mutation: return the tint's own translucent colour, and on Logjam GPS's
  // dark sheet the older swatches all but vanish.
  it("keys each row as the tint shows on a white map, with no row for an old fire", () => {
    const rows = fireLegendRows();
    expect(rows.map((r) => r.label)).toEqual([
      "Under a year ago",
      "4 years ago",
      "7 years ago",
    ]);
    // #be185d at 0.45 over white.
    expect(rows[0]!.colour).toBe("#e297b6");
  });
});

describe("fireNameOf", () => {
  it("names the fire and its month", () => {
    expect(fireNameOf([fire(2019, 12, 1)])).toBe("Wildfire, Dec 2019");
    expect(fireNameOf([fire(2023, 5, 2)])).toBe("Prescribed burn, May 2023");
  });

  // Mutation: take the first feature, and a tap where two tiles' margins
  // overlap can name the older fire.
  it("names the newest fire a tap found", () => {
    expect(fireNameOf([fire(2013, 10, 1), fire(2019, 12, 2)])).toBe(
      "Prescribed burn, Dec 2019",
    );
  });

  // Mutation: return null for a type no list has, and a new code hides the
  // date of every fire it marks.
  it("still dates a fire whose type it doesn't know", () => {
    expect(fireNameOf([fire(2020, 1, 7)])).toBe("Fire, Jan 2020");
    expect(fireNameOf([fire(2020, 1)])).toBe("Fire, Jan 2020");
  });

  it("is null with nothing there", () => {
    expect(fireNameOf([])).toBeNull();
    expect(fireNameOf([{ properties: null }, fire(2020, 13, 1)])).toBeNull();
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGauges } from "./gauges/useGauges";
import { useNow } from "./ui/useNow";

// Guards for mobile/AGENTS.md "Nothing automatic wakes the radio or the CPU
// behind a dark screen: a timer arms only in the foreground, and a sensor runs
// only while the screen that shows it is focused" (ADR 0013, ADR 0010).
//
// Three layers:
//  1. `useNow` and `useGauges` run as plain functions with React stubbed
//     (mobile's vitest has no renderer), and their interval must not tick while
//     AppState is `background`.
//  2. MapScreen cannot be rendered here, so a syntax-tree check says each
//     effect that opens a sensor, or runs the GPS-quality timer, starts with
//     `if (… || !sensorsActive …) return;`, and that `sensorsActive` is
//     `mapFocused && appActive`.
//  3. An inventory: every `setInterval` and sensor subscription in `src/` is
//     declared below with the reason it is safe. A new one fails until someone
//     writes that reason down. `setTimeout` is not inventoried: the ones that
//     retry are one-shot ladders (`syncEngine.ts` has its own foreground test).
//
// Mutations that turn it red:
//  - `useNow.ts` or `useGauges.ts`: `if (AppState.currentState === "active")
//    start…();` to an unconditional call, or drop the `state !== "active"`
//    return in the change listener (layer 1).
//  - `MapScreen.tsx`: drop `!sensorsActive ||` from the GPS watcher's, the
//    heading's or the compass probe's effect, or the GPS-quality timer's; make
//    `sensorsActive` `mapFocused || appActive` (layer 2).
//  - Add a `setInterval` or `Accelerometer.addListener` to any file, or a second
//    one to a declared file (layer 3).

const SRC = __dirname;

// ---- Layer 1: the hooks' timers ------------------------------------------

const { appState, effects, setters } = vi.hoisted(() => ({
  appState: {
    currentState: "active" as string,
    listeners: [] as ((state: string) => void)[],
  },
  effects: [] as (() => void | (() => void))[],
  setters: [] as ReturnType<typeof vi.fn>[],
}));

vi.mock("react", () => ({
  useState: (init: unknown) => {
    const set = vi.fn();
    setters.push(set);
    return [typeof init === "function" ? (init as () => unknown)() : init, set];
  },
  useEffect: (fn: () => void | (() => void)) => {
    effects.push(fn);
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_: string, listener: (state: string) => void) => {
      appState.listeners.push(listener);
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("./map/connectivity", () => ({
  subscribeReconnect: () => vi.fn(),
}));
vi.mock("./gauges/gaugeFeed", () => ({
  GAUGE_REFRESH_MS: 300_000,
  refreshGauges: () => Promise.resolve(null),
}));
vi.mock("./gauges/gaugeStorage", () => ({
  readCachedGauges: () => Promise.resolve(null),
}));

/** Run a hook once and its effects; returns the setter of the n-th useState. */
function mount(hook: () => unknown, stateIndex: number) {
  effects.length = 0;
  setters.length = 0;
  appState.listeners.length = 0;
  hook();
  for (const effect of effects) effect();
  return setters[stateIndex];
}

const MINUTE = 60_000;

describe("the hooks that tick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appState.currentState = "active";
  });

  it("useNow starts no timer behind a dark screen", async () => {
    appState.currentState = "background";
    const setNow = mount(() => useNow(MINUTE), 0);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(
      setNow,
      "useNow ticked while AppState was background: arm the interval only when AppState.currentState is active (ADR 0013).",
    ).not.toHaveBeenCalled();
  });

  it("useNow ticks in front, stops on background and restarts on return", async () => {
    const setNow = mount(() => useNow(MINUTE), 0);
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(setNow).toHaveBeenCalledTimes(3);

    appState.listeners.forEach((l) => l("background"));
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(
      setNow,
      "useNow kept ticking after AppState went to background: the change listener must clear the interval and only restart it for `active` (ADR 0013).",
    ).toHaveBeenCalledTimes(3);

    appState.listeners.forEach((l) => l("active"));
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(setNow.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("useGauges starts no timer behind a dark screen", async () => {
    appState.currentState = "background";
    const setNow = mount(() => useGauges(true), 2);
    await vi.advanceTimersByTimeAsync(0);
    const afterFirstLoad = setNow.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(
      setNow.mock.calls.length,
      "useGauges ticked while AppState was background: arm the interval only when AppState.currentState is active (ADR 0013).",
    ).toBe(afterFirstLoad);
  });

  it("useGauges ticks in front and stops on background", async () => {
    const setNow = mount(() => useGauges(true), 2);
    await vi.advanceTimersByTimeAsync(0);
    const afterFirstLoad = setNow.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15 * MINUTE);
    expect(setNow.mock.calls.length).toBe(afterFirstLoad + 3);

    appState.listeners.forEach((l) => l("background"));
    const stopped = setNow.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(
      setNow.mock.calls.length,
      "useGauges kept ticking after AppState went to background: the change listener must clear the interval (ADR 0013).",
    ).toBe(stopped);
  });
});

// ---- Layer 2: MapScreen's sensors ----------------------------------------

const parse = (path: string) =>
  ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

const calleeText = (call: ts.CallExpression) => call.expression.getText();

/** The `||` operands of a condition, through parentheses. */
function orOperands(expr: ts.Expression): ts.Expression[] {
  if (ts.isParenthesizedExpression(expr)) return orOperands(expr.expression);
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return [...orOperands(expr.left), ...orOperands(expr.right)];
  }
  return [expr];
}

/** True when the effect around `node` begins `if (… || !ident …) return;`. */
function effectIsGatedBy(node: ts.Node, ident: string): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (!ts.isArrowFunction(n) && !ts.isFunctionExpression(n)) {
      continue;
    }
    const call: ts.Node = n.parent;
    if (
      !ts.isCallExpression(call) ||
      call.arguments[0] !== n ||
      !/^(React\.)?useEffect$/.test(calleeText(call))
    ) {
      continue;
    }
    if (!ts.isBlock(n.body)) return false;
    const first = n.body.statements[0];
    if (!first || !ts.isIfStatement(first)) return false;
    const then = first.thenStatement;
    const returns =
      (ts.isReturnStatement(then) && !then.expression) ||
      (ts.isBlock(then) &&
        then.statements.length === 1 &&
        ts.isReturnStatement(then.statements[0]) &&
        !(then.statements[0] as ts.ReturnStatement).expression);
    return (
      returns &&
      orOperands(first.expression).some(
        (op) =>
          ts.isPrefixUnaryExpression(op) &&
          op.operator === ts.SyntaxKind.ExclamationToken &&
          op.operand.getText() === ident,
      )
    );
  }
  return false; // not inside a useEffect at all
}

const SENSOR_CALL =
  /^(Location\.(watchPositionAsync|watchHeadingAsync|startLocationUpdatesAsync)|(DeviceMotion|Magnetometer|Accelerometer|Gyroscope|Barometer|LightSensor)\.addListener|Pedometer\.watchStepCount)$/;

/** Calls in a file, each with whether its effect starts with the gate. */
function callsIn(
  path: string,
  want: (call: ts.CallExpression) => boolean,
  ident: string,
) {
  const out: { text: string; line: number; gated: boolean }[] = [];
  const file = parse(path);
  walk(file, (n) => {
    if (ts.isCallExpression(n) && want(n)) {
      out.push({
        text: calleeText(n),
        line: file.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        gated: effectIsGatedBy(n, ident),
      });
    }
  });
  return out;
}

describe("the map's sensors and timers", () => {
  const mapScreen = join(SRC, "map", "MapScreen.tsx");

  it("watch the GPS and the compass only while the map is focused and in front", () => {
    const sensors = callsIn(
      mapScreen,
      (c) => SENSOR_CALL.test(calleeText(c)),
      "sensorsActive",
    );
    // GPS watcher, rotation vector, the legacy heading fallback, the probe's
    // magnetometer and heading watcher: a regex that stops matching drops below.
    expect(sensors.length).toBeGreaterThanOrEqual(5);
    const loose = sensors.filter((s) => !s.gated);
    expect(
      loose.map((s) => `${s.text} at MapScreen.tsx:${s.line}`),
      "A sensor subscription in MapScreen must sit in a useEffect that begins `if (!sensorsActive || …) return;`, so it stops when the tab blurs or the app backgrounds (ADR 0010).",
    ).toEqual([]);
  });

  it("ticks the GPS-quality age only under the same gate", () => {
    const timers = callsIn(
      mapScreen,
      (c) =>
        calleeText(c) === "setInterval" &&
        /^noteGpsQuality\b/.test(c.arguments[0]?.getText() ?? ""),
      "sensorsActive",
    );
    expect(timers).toHaveLength(1);
    expect(
      timers.filter((t) => !t.gated),
      "The GPS-quality timer must sit in an effect that begins `if (!sensorsActive || …) return;` (ADR 0013).",
    ).toEqual([]);
  });

  it("defines sensorsActive as focused and in front", () => {
    let init = "";
    walk(parse(mapScreen), (n) => {
      if (ts.isVariableDeclaration(n) && n.name.getText() === "sensorsActive") {
        init = n.initializer?.getText() ?? "";
      }
    });
    expect(
      init,
      "`sensorsActive` must stay `mapFocused && appActive`: a sensor behind a dark screen or another tab is the drain ADR 0010 forbids.",
    ).toBe("mapFocused && appActive");
  });

  it("hands the readout chips the same gate", () => {
    const handed: Record<string, string[]> = {};
    walk(parse(mapScreen), (n) => {
      if (!ts.isJsxSelfClosingElement(n) && !ts.isJsxOpeningElement(n)) return;
      const tag = n.tagName.getText();
      if (tag !== "SpeedElevationChip" && tag !== "NavReadout") return;
      const active = n.attributes.properties.find(
        (p) => ts.isJsxAttribute(p) && p.name.getText() === "active",
      ) as ts.JsxAttribute | undefined;
      (handed[tag] ??= []).push(active?.initializer?.getText() ?? "none");
    });
    expect(
      handed,
      "SpeedElevationChip and NavReadout tick only while their `active` prop is true: MapScreen must pass `active={sensorsActive}` at each use.",
    ).toEqual({
      SpeedElevationChip: ["{sensorsActive}"],
      NavReadout: expect.arrayContaining(["{sensorsActive}"]),
    });
    expect(handed.NavReadout.every((a) => a === "{sensorsActive}")).toBe(true);
  });
});

// ---- Layer 3: the inventory ----------------------------------------------

type Declared = {
  file: string;
  /** How many calls the file holds. */
  count: number;
  why: string;
  /** Calls that must sit in an effect beginning `if (!<ident> || …) return;`. */
  gated?: { ident: string; count: number };
};

const INTERVALS: Declared[] = [
  {
    file: "ui/useNow.ts",
    count: 1,
    why: "armed only while AppState is active; held by the hook tests above",
  },
  {
    file: "gauges/useGauges.ts",
    count: 1,
    why: "armed only while AppState is active; held by the hook tests above",
  },
  {
    file: "tracks/RecordingSheet.tsx",
    count: 1,
    why: "the 1 Hz clock runs only while the sheet is open and AppState is active; the recording itself needs no timer",
  },
  {
    file: "map/MapScreen.tsx",
    count: 3,
    gated: { ident: "sensorsActive", count: 1 },
    why: "the GPS-quality tick is gated on sensorsActive (above); the heading ticker is started by a heading sample and stops once settled, so it only runs while the gated heading effect delivers; the third is the rename form's focus retry, capped at 12 attempts",
  },
  {
    file: "map/SpeedElevationChip.tsx",
    count: 1,
    gated: { ident: "active", count: 1 },
    why: "ticks only while its `active` prop (MapScreen's sensorsActive) is true",
  },
  {
    file: "ui/NavReadout.tsx",
    count: 1,
    gated: { ident: "active", count: 1 },
    why: "ticks only while its `active` prop (MapScreen's sensorsActive) is true and the fix is stale",
  },
  {
    file: "map/FocusPulse.tsx",
    count: 1,
    why: "a one-shot animation that clears itself after FOCUS_PULSE_MS, started by a tap",
  },
  {
    file: "geopdf/importRunner.ts",
    count: 1,
    why: "a 100 ms stall meter while a GeoPDF import the user started runs; it only measures and is cleared when the import ends",
  },
  {
    file: "offline/regionDownloads.ts",
    count: 1,
    why: "the watchdog of one range request in a map download the user started (ADR 0013 update 2026-10-10); cleared when the request ends",
  },
];

const SENSORS: Declared[] = [
  {
    file: "map/MapScreen.tsx",
    count: 5,
    gated: { ident: "sensorsActive", count: 5 },
    why: "GPS marker, rotation-vector compass, its legacy fallback and the calibration probe: all under sensorsActive (ADR 0010)",
  },
  {
    file: "tracks/trackRecorder.ts",
    count: 5,
    why: "the recorder, the one sanctioned background sensor: the user starts it, it only appends points (ADR 0013)",
  },
];

/** Files that may import expo-sensors at all, so a renamed import is still seen. */
const SENSOR_IMPORTS: Record<string, string> = {
  "map/MapScreen.tsx": "the compass and its calibration probe (gated above)",
  "tracks/sensorLog.ts":
    "borrows the Pedometer's permission request only; it subscribes to nothing",
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
      ? [path]
      : [];
  });
}

describe("the inventory of timers and sensors", () => {
  const files = sources(SRC);
  const scan = (
    want: (c: ts.CallExpression) => boolean,
    gateFor: (rel: string) => string,
  ) => {
    const found = new Map<string, { total: number; gated: number }>();
    for (const path of files) {
      const rel = relative(SRC, path);
      const text = readFileSync(path, "utf8");
      // Cheap pre-filter: parsing 400 files twice is the slow part.
      if (!/setInterval|watch|addListener|startLocationUpdatesAsync/.test(text))
        continue;
      const calls = callsIn(path, want, gateFor(rel));
      if (calls.length) {
        found.set(rel, {
          total: calls.length,
          gated: calls.filter((c) => c.gated).length,
        });
      }
    }
    return found;
  };

  const check = (
    what: string,
    declared: Declared[],
    found: Map<string, { total: number; gated: number }>,
  ) => {
    const seen = Object.fromEntries(
      [...found].map(([file, { total }]) => [file, total]),
    );
    const want = Object.fromEntries(declared.map((d) => [d.file, d.count]));
    expect(
      seen,
      `${what} in src/ differ from the declared list in batteryRules.test.ts. A new one must arm only in the foreground (a timer) or only while its screen is focused (a sensor): add an entry saying why it is safe, or gate it. Nothing automatic runs behind a dark screen (ADR 0013, ADR 0010); anything else needs the maintainer's sign-off.`,
    ).toEqual(want);
    for (const d of declared.filter((x) => x.gated)) {
      expect(
        found.get(d.file)?.gated,
        `${d.file}: ${d.gated!.count} ${what} must sit in an effect that begins \`if (!${d.gated!.ident} || …) return;\`.`,
      ).toBe(d.gated!.count);
    }
    for (const d of declared) expect(d.why.length, d.file).toBeGreaterThan(20);
  };

  it("lists every setInterval", () => {
    const found = scan(
      (c) => calleeText(c) === "setInterval",
      (rel) => (rel === "map/MapScreen.tsx" ? "sensorsActive" : "active"),
    );
    // Real counts today are 9 files; a scan that matches nothing cannot pass.
    expect(found.size).toBeGreaterThanOrEqual(9);
    // The MapScreen gate applies to the quality tick only; its other two are
    // declared by `why`, so compare totals and check that tick above.
    check("setInterval calls", INTERVALS, found);
  });

  it("lists every sensor subscription", () => {
    const found = scan(
      (c) => SENSOR_CALL.test(calleeText(c)),
      () => "sensorsActive",
    );
    expect(found.size).toBeGreaterThanOrEqual(2);
    check("sensor subscriptions", SENSORS, found);
  });

  it("lists every file that imports expo-sensors", () => {
    const importers = files
      .filter((p) => /from "expo-sensors"/.test(readFileSync(p, "utf8")))
      .map((p) => relative(SRC, p))
      .sort();
    expect(
      importers,
      "A new file imports expo-sensors: add it to SENSOR_IMPORTS in batteryRules.test.ts with why it cannot run behind a dark screen, and put its subscription in SENSORS (ADR 0010).",
    ).toEqual(Object.keys(SENSOR_IMPORTS).sort());
  });
});

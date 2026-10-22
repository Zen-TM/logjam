// The one thing about this module that is a decision rather than plumbing:
// which caller may BEGIN a log and which may only RESUME one. Getting it wrong
// produces a file missing its first half, and nothing downstream can tell that
// from a phone that stopped sampling.
import { beforeEach, describe, expect, it, vi } from "vitest";

const logStatus = vi.fn(() => ({
  logging: false,
  path: "",
  bytes: 0,
  samples: 0,
  dropped: 0,
}));
const startLogging = vi.fn(() => "/data/sensor-logs/t1.csv");
const stopLogging = vi.fn(() => ({
  logging: false,
  path: "",
  bytes: 0,
  samples: 0,
  dropped: 0,
}));
const mark = vi.fn((_n: number) => true);
// `null` here is a USER BUILD: the plugin excludes the native module from
// autolinking, so `requireOptionalNativeModule` hands back nothing.
let nativeModule: unknown = null;
vi.mock("../../modules/logjam-sensors/src/LogjamSensorsModule", () => ({
  get default() {
    return nativeModule;
  },
}));

const realModule = {
  capabilities: vi.fn(() => ({
    accelerometer: true,
    gyroscope: true,
    barometer: true,
    stepCounter: true,
    significantMotion: true,
    imuFifoEvents: 3000,
  })),
  logStatus: () => logStatus(),
  startLogging: (...args: unknown[]) => startLogging(...(args as [])),
  stopLogging: () => stopLogging(),
  mark: (n: number) => mark(n),
};

const getInfoAsync = vi.fn(async () => ({ exists: false }));
const deleteAsync = vi.fn(async () => {});
vi.mock("expo-file-system/legacy", () => ({
  makeDirectoryAsync: vi.fn(async () => {}),
  deleteAsync: (...args: unknown[]) => deleteAsync(...(args as [])),
  getInfoAsync: (...args: unknown[]) => getInfoAsync(...(args as [])),
}));

vi.mock("../offline/localStores", () => ({ SENSOR_LOG_DIR: "/logs/" }));

// Only the permission request is borrowed from expo-sensors; unmocked it drags
// react-native's Flow-typed entry point into the transform and the file will
// not parse at all.
const requestPermissionsAsync = vi.fn(async () => ({ granted: true }));
vi.mock("expo-sensors", () => ({
  Pedometer: { requestPermissionsAsync: () => requestPermissionsAsync() },
}));

const hasSpaceFor = vi.fn(async () => true);
vi.mock("../offline/freeSpace", () => ({
  hasSpaceFor: (...args: unknown[]) => hasSpaceFor(...(args as [])),
}));

let enabled = "1";
let marksPref: string | null = null;
vi.mock("../prefsDb", () => ({
  readPref: (key: string) =>
    key === "devSensorLogMarks" ? marksPref : enabled,
  writePref: (key: string, value: string) => {
    if (key === "devSensorLogMarks") marksPref = value;
    return true;
  },
}));

let sensorLog: typeof import("./sensorLog");

beforeEach(async () => {
  vi.clearAllMocks();
  // A fresh module per test: what a stop leaves behind is module state, and a
  // test must not inherit the previous one's stop.
  vi.resetModules();
  sensorLog = await import("./sensorLog");
  startLogging.mockImplementation(() => "/data/sensor-logs/t1.csv");
  nativeModule = realModule;
  enabled = "1";
  marksPref = null;
  mark.mockReturnValue(true);
  logStatus.mockReturnValue({
    logging: false,
    path: "",
    bytes: 0,
    samples: 0,
    dropped: 0,
  });
  getInfoAsync.mockResolvedValue({ exists: false });
  hasSpaceFor.mockResolvedValue(true);
});

describe("who may begin a log", () => {
  it("a recording start begins one", async () => {
    expect(await sensorLog.startSensorLog("t1")).toBe(true);
    expect(startLogging).toHaveBeenCalledTimes(1);
  });

  it("the per-batch re-arm does NOT begin one", async () => {
    // The toggle was flipped during a recording that started without logging.
    expect(await sensorLog.startSensorLog("t1", true)).toBe(false);
    expect(startLogging).not.toHaveBeenCalled();
  });

  it("the per-batch re-arm DOES resume an existing log", async () => {
    // A headless relaunch after a process kill: the file is already there.
    getInfoAsync.mockResolvedValue({ exists: true });
    expect(await sensorLog.startSensorLog("t1", true)).toBe(true);
    expect(startLogging).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all while the toggle is off", async () => {
    enabled = "0";
    expect(await sensorLog.startSensorLog("t1")).toBe(false);
    expect(startLogging).not.toHaveBeenCalled();
  });

  it("is idempotent while already logging", async () => {
    logStatus.mockReturnValue({
      logging: true,
      path: "/logs/t1.csv",
      bytes: 10,
      samples: 1,
      dropped: 0,
    });
    expect(await sensorLog.startSensorLog("t1")).toBe(true);
    expect(startLogging).not.toHaveBeenCalled();
  });

  it("refuses to start when the disk is nearly full", async () => {
    // The log and the offline DB share a filesystem, so a logger that fills the
    // phone takes the recording — the thing the trip cannot repeat — with it.
    hasSpaceFor.mockResolvedValue(false);
    expect(await sensorLog.startSensorLog("t1")).toBe(false);
    expect(startLogging).not.toHaveBeenCalled();
  });

  it("never throws when the native side refuses", async () => {
    startLogging.mockImplementation(() => {
      throw new Error("no such device");
    });
    await expect(sensorLog.startSensorLog("t1")).resolves.toBe(false);
  });
});

describe("a stopped recording leaves no logger running", () => {
  // Mutation: drop the `stopped` check or the `stops` re-check in
  // `startSensorLog` and the matching test goes red.
  it("a late batch after the stop does NOT re-arm the log", async () => {
    // The disarm stops the logger first and marks the row finished last, so a
    // fix batch delivered in between still sees a live recording and asks for
    // the log back. Its file exists, so only the stop itself can refuse it.
    getInfoAsync.mockResolvedValue({ exists: true });
    expect(await sensorLog.startSensorLog("t1")).toBe(true);
    sensorLog.stopSensorLog();
    expect(await sensorLog.startSensorLog("t1", true)).toBe(false);
    expect(startLogging).toHaveBeenCalledTimes(1);
  });

  it("a deliberate start after a stop does begin again, and re-arms after it", async () => {
    getInfoAsync.mockResolvedValue({ exists: true });
    sensorLog.stopSensorLog();
    expect(await sensorLog.startSensorLog("t1")).toBe(true);
    expect(await sensorLog.startSensorLog("t1", true)).toBe(true);
    expect(startLogging).toHaveBeenCalledTimes(2);
  });

  it("a start still asking the disk when the recording stops does not begin", async () => {
    let answer: (fits: boolean) => void = () => {};
    hasSpaceFor.mockReturnValue(
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
    );
    const starting = sensorLog.startSensorLog("t1");
    sensorLog.stopSensorLog();
    answer(true);
    expect(await starting).toBe(false);
    expect(startLogging).not.toHaveBeenCalled();
  });

  it("a logger left on another track's file is stopped, not joined", async () => {
    logStatus.mockReturnValueOnce({
      logging: true,
      path: "/logs/old.csv",
      bytes: 10,
      samples: 1,
      dropped: 0,
    });
    expect(await sensorLog.startSensorLog("t1")).toBe(true);
    expect(stopLogging).toHaveBeenCalledTimes(1);
    expect(startLogging).toHaveBeenCalledWith("/logs/t1.csv", 100, 30);
  });

  it("deleting a recording deletes its log", async () => {
    await sensorLog.deleteSensorLog("t1");
    expect(deleteAsync).toHaveBeenCalledWith("/logs/t1.csv", {
      idempotent: true,
    });
  });
});

describe("marking the log", () => {
  it("numbers marks from 1 and carries on from the stored count", () => {
    expect(sensorLog.markSensorLog("t1")).toBe(1);
    expect(sensorLog.markSensorLog("t1")).toBe(2);
    expect(mark).toHaveBeenLastCalledWith(2);
    // What a relaunch mid-trip reads back: the count is stored, not held.
    expect(sensorLog.sensorLogMarkCount("t1")).toBe(2);
    // Another recording's file starts again.
    expect(sensorLog.markSensorLog("t2")).toBe(1);
  });

  it("counts nothing when no row was written", () => {
    mark.mockReturnValue(false);
    expect(sensorLog.markSensorLog("t1")).toBeNull();
    expect(sensorLog.sensorLogMarkCount("t1")).toBe(0);
  });

  it("says a log is running from its start to its stop", async () => {
    const seen: boolean[] = [];
    sensorLog.onSensorLogRunningChanged(() =>
      seen.push(sensorLog.sensorLogRunning()),
    );
    expect(sensorLog.sensorLogRunning()).toBe(false);
    await sensorLog.startSensorLog("t1");
    sensorLog.stopSensorLog();
    expect(seen).toEqual([true, false]);
  });
});

describe("a user build has no logger at all", () => {
  // The module is excluded from autolinking unless LOGJAM_SENSOR_LOG=1 was set
  // at build time (plugins/withSensorLogging.js), so the native side is
  // genuinely absent and every surface has to degrade to "not available"
  // rather than throw. One JS bundle, two build shapes.
  beforeEach(() => {
    nativeModule = null;
  });

  it("reports itself unavailable", () => {
    expect(sensorLog.sensorLoggingAvailable()).toBe(false);
  });

  it("refuses to start even with the preference on", async () => {
    enabled = "1";
    expect(await sensorLog.startSensorLog("t1")).toBe(false);
    expect(startLogging).not.toHaveBeenCalled();
  });

  it("has no mark button, no mark and nothing to delete", async () => {
    // Mutation: drop a `LogjamSensors == null` return from `sensorLogRunning`,
    // `markSensorLog` or `deleteSensorLog`. The mark button draws only while
    // `sensorLogRunning()` is true.
    expect(sensorLog.sensorLogRunning()).toBe(false);
    expect(sensorLog.markSensorLog("t1")).toBeNull();
    expect(marksPref).toBeNull();
    await sensorLog.deleteSensorLog("t1");
    expect(deleteAsync).not.toHaveBeenCalled();
  });
});

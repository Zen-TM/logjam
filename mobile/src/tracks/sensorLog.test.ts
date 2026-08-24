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
};

const getInfoAsync = vi.fn(async () => ({ exists: false }));
vi.mock("expo-file-system/legacy", () => ({
  makeDirectoryAsync: vi.fn(async () => {}),
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
vi.mock("../prefsDb", () => ({
  readPref: () => enabled,
  writePref: () => true,
}));

const { sensorLoggingAvailable, startSensorLog } = await import("./sensorLog");

beforeEach(() => {
  vi.clearAllMocks();
  nativeModule = realModule;
  enabled = "1";
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
    expect(await startSensorLog("t1")).toBe(true);
    expect(startLogging).toHaveBeenCalledTimes(1);
  });

  it("the per-batch re-arm does NOT begin one", async () => {
    // The toggle was flipped during a recording that started without logging.
    expect(await startSensorLog("t1", true)).toBe(false);
    expect(startLogging).not.toHaveBeenCalled();
  });

  it("the per-batch re-arm DOES resume an existing log", async () => {
    // A headless relaunch after a process kill: the file is already there.
    getInfoAsync.mockResolvedValue({ exists: true });
    expect(await startSensorLog("t1", true)).toBe(true);
    expect(startLogging).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all while the toggle is off", async () => {
    enabled = "0";
    expect(await startSensorLog("t1")).toBe(false);
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
    expect(await startSensorLog("t1")).toBe(true);
    expect(startLogging).not.toHaveBeenCalled();
  });

  it("refuses to start when the disk is nearly full", async () => {
    // The log and the offline DB share a filesystem, so a logger that fills the
    // phone takes the recording — the thing the trip cannot repeat — with it.
    hasSpaceFor.mockResolvedValue(false);
    expect(await startSensorLog("t1")).toBe(false);
    expect(startLogging).not.toHaveBeenCalled();
  });

  it("never throws when the native side refuses", async () => {
    startLogging.mockImplementation(() => {
      throw new Error("no such device");
    });
    await expect(startSensorLog("t1")).resolves.toBe(false);
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
    expect(sensorLoggingAvailable()).toBe(false);
  });

  it("refuses to start even with the preference on", async () => {
    enabled = "1";
    expect(await startSensorLog("t1")).toBe(false);
    expect(startLogging).not.toHaveBeenCalled();
  });
});

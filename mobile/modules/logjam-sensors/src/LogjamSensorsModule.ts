import { NativeModule, requireNativeModule } from "expo";

// Research logger for the track-accuracy work (private/todo/track-accuracy.md).
// DIAGNOSTIC ONLY: nothing in the app reads what this writes, and nothing may
// start it except the developer toggle in Settings. It exists because
// `expo-sensors` stops every sensor when the activity backgrounds, so a
// recording — which is backgrounded, with the screen off, for the whole trip —
// can currently observe no sensor at all.
//
// Android only. There is no iOS half and there should not be one until the same
// questions are being asked of an iPhone.

export interface SensorCapabilities {
  accelerometer: boolean;
  gyroscope: boolean;
  barometer: boolean;
  stepCounter: boolean;
  significantMotion: boolean;
  /** Hardware FIFO depth in events — what makes batching cheap. 0 = none. */
  imuFifoEvents: number;
}

export interface SensorLogStatus {
  logging: boolean;
  path: string;
  bytes: number;
  samples: number;
  /** Writes that failed. Non-zero means the log has holes, not that it died. */
  dropped: number;
}

declare class LogjamSensorsModule extends NativeModule {
  capabilities(): SensorCapabilities;

  /**
   * Begin logging to `fileUri`, appending if it exists. Returns the path.
   *
   * @param imuHz accelerometer + gyroscope rate. **0 disables the IMU**, which
   *   is the cheap mode: barometer, step counter, significant motion and GNSS
   *   status only, for microamps. 100 is the full-fat research setting.
   * @param batchSeconds how long the hardware FIFO may hold samples before
   *   waking the CPU. THIS IS THE BATTERY KNOB — at 100 Hz, batching is the
   *   difference between ~120 wakeups an hour and 360,000. Never pass 0 outside
   *   a deliberate demonstration of that.
   */
  startLogging(fileUri: string, imuHz: number, batchSeconds: number): string;

  /** Stop, flush, close. Returns the final status. Safe to call when idle. */
  stopLogging(): SensorLogStatus;

  /** Flushes before reading, so `bytes` is meaningful mid-run. */
  logStatus(): SensorLogStatus;
}

export default requireNativeModule<LogjamSensorsModule>("LogjamSensors");

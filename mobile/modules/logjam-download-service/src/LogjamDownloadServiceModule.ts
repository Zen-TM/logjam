import { NativeModule, requireOptionalNativeModule } from "expo";
import { AppRegistry } from "react-native";

// Android foreground service that keeps the process alive while a map download
// the user started is running. What it is for and what it costs:
// android/src/main/java/expo/modules/logjamdownloadservice/DownloadService.kt.
//
// Android only. Optional, so a build without it (iOS, a test) downloads exactly
// as before: in the foreground, for as long as the process runs.

declare class LogjamDownloadServiceModule extends NativeModule {
  /**
   * Start the service, or change what its notification says. `percent` below 0
   * hides the progress bar. Neither string may carry an area name: the
   * notification is readable on the lock screen.
   */
  show(title: string, text: string, percent: number): void;
  stop(): void;
}

// React Native on Android delivers no JS timers while the activity is paused
// unless a headless task is running, and the tile loop waits on timers. The
// native module starts this task with the service and ends it with `stop`; it
// never settles by itself and does no work.
AppRegistry.registerHeadlessTask(
  "LogjamDownloadTimers",
  () => () => new Promise<void>(() => {}),
);

export default requireOptionalNativeModule<LogjamDownloadServiceModule>(
  "LogjamDownloadService",
);

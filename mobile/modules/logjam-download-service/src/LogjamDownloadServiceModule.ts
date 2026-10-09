import { NativeModule, requireOptionalNativeModule } from "expo";

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

export default requireOptionalNativeModule<LogjamDownloadServiceModule>(
  "LogjamDownloadService",
);

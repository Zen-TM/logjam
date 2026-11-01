/**
 * Whether this build can get a push token at all. The dev variant (application
 * id `….dev`, app.config.ts) is built without Firebase on Android, so asking
 * only fails, and a dev build draws that failure as a toast over the tab bar.
 * Guard: pushAvailable.test.ts.
 */
export function pushAvailable(
  platform: string,
  androidPackage: string | undefined,
): boolean {
  return !(platform === "android" && androidPackage?.endsWith(".dev"));
}

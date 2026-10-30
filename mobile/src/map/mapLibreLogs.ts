import { LogManager } from "@maplibre/maplibre-react-native";

// MapLibre Native's own log lines reach JS as console.error, which a dev build
// draws as a toast over the tab bar. These say a phone's GPU lacks an optional
// feature the Vulkan renderer asks for (the Galaxy S9's Mali-G72 has no
// samplerAnisotropy); the map draws without it, so nobody can act on them.
const HARMLESS = ["Feature not available: samplerAnisotropy"];

/** True when MapLibre should drop the line. Guard: mapLibreLogs.test.ts. */
export function isHarmlessMapLog(event: { message: string }): boolean {
  return HARMLESS.some((text) => event.message.includes(text));
}

/** Once, at start-up: every other line still reaches the console. */
export function quietHarmlessMapLogs(): void {
  LogManager.onLog(isHarmlessMapLog);
}

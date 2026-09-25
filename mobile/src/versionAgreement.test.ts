import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import appConfig from "../app.config";
import packageJson from "../package.json";

// The app version is declared once, in package.json. The x-logjam-client header
// and the Expo config both read it; if either drifts, the server's
// MIN_MOBILE_VERSION gate blocks everyone or no one, silently.
describe("app version has one declaration", () => {
  const appJson = JSON.parse(
    readFileSync(join(__dirname, "../app.json"), "utf8")
  ) as { expo: Record<string, unknown> };

  it("app.json does not declare its own version", () => {
    expect(appJson.expo).not.toHaveProperty("version");
  });

  it("the resolved Expo config uses package.json's version", () => {
    const resolved = appConfig({
      config: appJson.expo,
    } as Parameters<typeof appConfig>[0]);
    expect(resolved.version).toBe(packageJson.version);
  });

  it("the client header sends package.json's version", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "http://127.0.0.1:8080");
    const { CLIENT_SEMVER, CLIENT_VERSION } = await import("./config");
    expect(CLIENT_SEMVER).toBe(packageJson.version);
    expect(CLIENT_VERSION).toBe(`mobile/${packageJson.version}`);
  });
});

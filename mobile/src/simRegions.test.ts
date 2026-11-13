import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { simRegionsFor } from "./simRegions";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS;
});

describe("simRegionsFor", () => {
  // Mutation: test `!flag` in place of `flag !== "1"` in simRegionsFor.
  it("is off unless the flag is exactly 1", () => {
    expect(simRegionsFor(undefined, "https://api.logjam.earth")).toBe(false);
    expect(simRegionsFor("true", "http://127.0.0.1:8080")).toBe(false);
  });

  // Mutation: return false after the local-API check in simRegionsFor.
  it.each([
    "http://127.0.0.1:8080",
    "http://10.0.2.2:8080",
    "http://192.168.1.20:8080",
  ])("is on against %s", (url) => {
    expect(simRegionsFor("1", url)).toBe(true);
  });

  // Mutation: drop the isLocalApi check in simRegionsFor (a build for the prod
  // API would then take the simulated regions).
  it.each(["https://api.logjam.earth", "http://127.0.0.1.evil.com", undefined])(
    "refuses an API at %s",
    (url) => {
      expect(() => simRegionsFor("1", url)).toThrow(
        /only allowed against a local API/,
      );
    },
  );
});

describe("the entry and the builds", () => {
  const imports = (file: string) =>
    [
      ...readFileSync(join(__dirname, file), "utf8").matchAll(
        /^import\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm,
      ),
    ].map((m) => m[1]);

  // Mutation: move `import "./src/simRegions"` below another import in index.ts.
  it("index.ts imports nothing but the polyfills before the switch", () => {
    expect(imports("../index.ts").slice(0, 3)).toEqual([
      "react-native-get-random-values",
      "react-native-url-polyfill/auto",
      "./src/simRegions",
    ]);
  });

  // Mutation: import @logjam/shared (or a file that does) from simRegions.ts.
  it("the switch loads nothing that reaches @logjam/shared", () => {
    expect(imports("simRegions.ts")).toEqual(["./authMode"]);
    expect(imports("authMode.ts")).toEqual([]);
  });

  // Mutation: delete the line that sets LOGJAM_SIM_REGIONS in simRegions.ts.
  it("sets the switch before shared loads", async () => {
    vi.stubEnv("EXPO_PUBLIC_SIM_REGIONS", "1");
    vi.stubEnv("EXPO_PUBLIC_API_URL", "http://127.0.0.1:8080");
    await import("./simRegions");
    const { REGIONS } = await import("@logjam/shared");
    expect(REGIONS.map((r) => r.id)).toEqual(["nsw", "simnz", "simutah"]);
  }, 30_000);

  // Mutation: hard-code a loopback URL as the second argument of the call at
  // the foot of simRegions.ts (a build for the prod API would then take the
  // simulated regions).
  it("refuses a build for the prod API that sets the flag, and leaves the switch off", async () => {
    vi.stubEnv("EXPO_PUBLIC_SIM_REGIONS", "1");
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.logjam.earth");
    await expect(import("./simRegions")).rejects.toThrow(
      /only allowed against a local API/,
    );
    expect(
      (globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS,
    ).toBeUndefined();
  });

  // Mutation: add EXPO_PUBLIC_SIM_REGIONS to a profile's env in eas.json.
  it("no EAS profile sets it", () => {
    const eas = JSON.parse(
      readFileSync(join(__dirname, "../eas.json"), "utf8"),
    ) as {
      build: Record<string, { env?: Record<string, string> }>;
    };
    expect(Object.keys(eas.build).length).toBeGreaterThanOrEqual(3);
    for (const [name, profile] of Object.entries(eas.build)) {
      expect(Object.keys(profile.env ?? {}), name).not.toContain(
        "EXPO_PUBLIC_SIM_REGIONS",
      );
    }
  });
});

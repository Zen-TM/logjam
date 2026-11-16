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
    expect(simRegionsFor(undefined, "oidc")).toBe(false);
    expect(simRegionsFor("", "fake")).toBe(false);
    expect(simRegionsFor("true", "fake")).toBe(false);
  });

  // Mutation: return false after the fake-auth check in simRegionsFor.
  it("is on with fake auth", () => {
    expect(simRegionsFor("1", "fake")).toBe(true);
  });

  // Mutation: drop the fake-auth check in simRegionsFor (a real-auth build
  // would then take the simulated regions).
  it.each(["oidc", undefined, "Fake"])(
    "refuses a build whose auth mode is %s",
    (mode) => {
      expect(() => simRegionsFor("1", mode)).toThrow(
        /only allowed with fake auth/,
      );
    },
  );
});

describe("the module", () => {
  // Mutation: hard-code "fake" as the second argument of the call at the foot
  // of simRegions.ts (a real-auth build would then take the simulated regions).
  it("refuses a real-auth build that sets the flag, and leaves the switch off", async () => {
    vi.stubEnv("VITE_SIM_REGIONS", "1");
    vi.stubEnv("VITE_AUTH_MODE", "oidc");
    vi.resetModules();
    await expect(import("./simRegions")).rejects.toThrow(
      /only allowed with fake auth/,
    );
    expect(
      (globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS,
    ).toBeUndefined();
  });
});

describe("the module in a build that signs in through a real provider", () => {
  // Mutation: delete the `else if` branch at the foot of simRegions.ts, and a
  // page that sets LOGJAM_SIM_REGIONS before the bundle loads turns the
  // simulated regions on in any build.
  it("clears a switch the page set before the bundle loaded", async () => {
    vi.stubEnv("VITE_AUTH_MODE", "oidc");
    (globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS = true;
    vi.resetModules();
    await import("./simRegions");
    expect(
      (globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS,
    ).toBeUndefined();
  });

  // Mutation: delete the `authMode !== "fake"` test, so the module clears the
  // global in a fake-auth dev build too, where a test or a dev page may set it.
  it("leaves a switch the page set in a fake-auth build", async () => {
    vi.stubEnv("VITE_AUTH_MODE", "fake");
    (globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS = true;
    vi.resetModules();
    await import("./simRegions");
    expect((globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS).toBe(
      true,
    );
  });
});

// Mutation that turns this red: add VITE_SIM_REGIONS to the build step of
// deploy-frontend.yml.
describe("the deploy build", () => {
  it("never sets VITE_SIM_REGIONS", () => {
    const workflow = readFileSync(
      join(import.meta.dirname, "../../.github/workflows/deploy-frontend.yml"),
      "utf8",
    );
    // The floor: the step that sets the build's env is the one scanned.
    expect(workflow).toContain("VITE_AUTH_MODE: oidc");
    expect(workflow).not.toContain("SIM_REGIONS");
  });
});

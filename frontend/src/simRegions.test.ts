import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { simRegionsFor } from "./simRegions";

afterEach(() => {
  vi.unstubAllEnvs();
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

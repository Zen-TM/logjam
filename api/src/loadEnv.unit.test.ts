import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const SIM = "LOGJAM_SIM_REGIONS";
const global_ = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  delete global_[SIM];
});
afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, ORIGINAL_ENV);
  delete global_[SIM];
});

function importsOf(file: string): string[] {
  return [
    ...readFileSync(file, "utf8").matchAll(
      /^import\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm,
    ),
  ].map((m) => m[1]);
}

// shared reads the switch when it loads, so the switch has to be set before.
// Mutations that turn these red: move `import "./loadEnv"` below the shared
// import in index.ts; import @logjam/shared (or a file that does) from
// loadEnv.ts; delete the line that sets LOGJAM_SIM_REGIONS.
describe("loadEnv (the first import of index.ts)", () => {
  it("is the first import of index.ts", () => {
    expect(importsOf(join(__dirname, "index.ts"))[0]).toBe("./loadEnv");
  });

  it("loads nothing that reaches @logjam/shared", () => {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of importsOf(file)) {
        expect(
          spec,
          `${file} would load shared before the switch is set`,
        ).not.toBe("@logjam/shared");
        if (spec.startsWith(".")) walk(resolve(dirname(file), `${spec}.ts`));
      }
    };
    walk(join(__dirname, "loadEnv.ts"));
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it("refuses SIM_REGIONS=1 in a prod runtime", async () => {
    process.env.SIM_REGIONS = "1";
    process.env.LOGJAM_RUNTIME = "prod";
    await expect(import("./loadEnv")).rejects.toThrow(/SIM_REGIONS=1 refused/);
    expect(global_[SIM]).toBeUndefined();
  });

  it("refuses SIM_REGIONS=1 beside a non-local database", async () => {
    process.env.SIM_REGIONS = "1";
    process.env.DB_HOST = "db.example.com";
    await expect(import("./loadEnv")).rejects.toThrow(/SIM_REGIONS=1 refused/);
  });

  it("leaves the switch off without SIM_REGIONS", async () => {
    delete process.env.SIM_REGIONS;
    await import("./loadEnv");
    expect(global_[SIM]).toBeUndefined();
  });

  it("puts the simulated regions in shared when it loads after", async () => {
    process.env.SIM_REGIONS = "1";
    process.env.NODE_ENV = "development";
    delete process.env.LOGJAM_RUNTIME;
    await import("./loadEnv");
    const { REGIONS } = await import("@logjam/shared");
    expect(REGIONS.map((r) => r.id)).toEqual(["nsw", "simnz", "simutah"]);
  });
});

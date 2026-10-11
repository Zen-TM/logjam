import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import appConfig from "../app.config";
import packageJson from "../package.json";

type Config = Parameters<typeof appConfig>[0]["config"];

const appJson = JSON.parse(
  readFileSync(join(__dirname, "../app.json"), "utf8"),
) as { expo: Config };

const resolve = (env: Record<string, string | undefined>) => {
  vi.stubEnv("GOOGLE_SERVICES_JSON", undefined);
  vi.stubEnv("LOGJAM_APP_VARIANT", undefined);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return appConfig({ config: appJson.expo } as Parameters<typeof appConfig>[0]);
};

afterEach(() => vi.unstubAllEnvs());

// LOGJAM_APP_VARIANT=dev builds an app that installs beside the real one, on a
// phone that holds the user's real places. Anything it shares with the real app
// (the application id, a URL scheme) lets one replace or answer for the other.
describe("app variant", () => {
  // Mutation: make any dev-only field unconditional in app.config.ts.
  it("is exactly app.json plus the version when no variant is set", () => {
    expect(JSON.stringify(resolve({}))).toBe(
      JSON.stringify({ ...appJson.expo, version: packageJson.version }),
    );
  });

  // Mutation: drop any one of the dev overrides in app.config.ts.
  it("dev changes the id, the name and every scheme together", () => {
    const real = resolve({});
    const dev = resolve({ LOGJAM_APP_VARIANT: "dev" });

    expect(dev.android?.package).toBe("com.logjamnsw.mobile.dev");
    expect(dev.ios?.bundleIdentifier).toBe("com.logjamnsw.mobile.dev");
    expect(dev.name).toBe("Logjam Dev");
    expect(dev.scheme).toBe("logjamdev");
    expect(dev.plugins).toContainEqual([
      "expo-dev-client",
      { addGeneratedScheme: false },
    ]);
    expect(dev.plugins).not.toContain("expo-dev-client");

    // Nothing else moves: the same native build, under another identity.
    const identity = ({
      name,
      scheme,
      ios,
      android,
      plugins,
      ...rest
    }: Config) => ({
      ...rest,
      ios: { ...ios, bundleIdentifier: null },
      android: { ...android, package: null },
      plugins: plugins?.filter(
        (plugin) =>
          (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-dev-client",
      ),
    });
    expect(identity(dev)).toEqual(identity(real));
  });

  // The Firebase file names the real application id only; the Gradle plugin
  // fails the build for any other.
  it("dev leaves google-services.json out", () => {
    const env = { GOOGLE_SERVICES_JSON: "/somewhere/google-services.json" };
    expect(resolve(env).android?.googleServicesFile).toBe(
      env.GOOGLE_SERVICES_JSON,
    );
    expect(
      resolve({ ...env, LOGJAM_APP_VARIANT: "dev" }).android,
    ).not.toHaveProperty("googleServicesFile");
  });

  // A typo that fell back to the real id would install over the real app.
  it("refuses a variant it does not know", () => {
    expect(() => resolve({ LOGJAM_APP_VARIANT: "development" })).toThrow(
      /LOGJAM_APP_VARIANT/,
    );
  });
});

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import patched from "../maplibre/patched.json";

const { addRepository } = createRequire(__filename)(
  "../plugins/withPatchedMapLibre.js",
) as { addRepository: (buildGradle: string) => string };

const appJson = JSON.parse(
  readFileSync(join(__dirname, "../app.json"), "utf8"),
) as { expo: { plugins: unknown[] } };

const mapLibre = appJson.expo.plugins.find(
  (p): p is [string, { android: Record<string, string> }] =>
    Array.isArray(p) && p[0] === "@maplibre/maplibre-react-native",
);

// Logjam GPS builds against our patched MapLibre Android until upstream fixes
// the hillshade alignment (#587). app.json names the version Gradle resolves;
// maplibre/patched.json names the one the workflow builds and the plugin
// fetches. If they part, Gradle looks for a version nobody published.
describe("patched MapLibre Android", () => {
  // Mutation: bump nativeVersion in app.json without patched.json, or back.
  it("is the version app.json asks MapLibre for", () => {
    expect(mapLibre?.[1].android.nativeVersion).toBe(patched.version);
  });

  // Mutation: switch nativeVariant to opengl; only the Vulkan build is patched.
  it("is the Vulkan build", () => {
    expect(mapLibre?.[1].android.nativeVariant).toBe("vulkan");
  });

  // Mutation: drop the plugin from app.json, and Gradle asks Maven Central
  // for a version only our release has.
  it("is fetched by the plugin", () => {
    expect(appJson.expo.plugins).toContain("./plugins/withPatchedMapLibre.js");
  });

  // Mutation: a version that does not say which upstream it patches.
  it("names the upstream release it patches", () => {
    expect(patched.version.startsWith(`${patched.upstream}-logjam.`)).toBe(
      true,
    );
  });
});

describe("addRepository", () => {
  const generated = `allprojects {
  repositories {
    google()
    mavenCentral()
  }
}
`;

  // Mutation: append the repository anywhere but allprojects.repositories.
  it("puts our Maven folder first in allprojects.repositories", () => {
    const out = addRepository(generated);
    expect(out).toMatch(
      /repositories \{\n {4}maven \{ url "\$rootDir\/maplibre-maven";[^\n]*\n {4}google\(\)/,
    );
  });

  // Mutation: drop the includes() check; a second prebuild adds it twice.
  it("adds it once", () => {
    const once = addRepository(generated);
    expect(addRepository(once)).toBe(once);
  });

  // Mutation: return the file unchanged when the anchor is missing.
  it("fails loudly when the template moves", () => {
    expect(() => addRepository("buildscript {}\n")).toThrow(/allprojects/);
  });
});

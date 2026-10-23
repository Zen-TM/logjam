import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appConfig from "../app.config";
import patched from "../maplibre/patched.json";

const { addRepository, fetchVerified } = createRequire(__filename)(
  "../plugins/withPatchedMapLibre.js",
) as {
  addRepository: (buildGradle: string) => string;
  fetchVerified: (
    name: string,
    expected: string,
    dest: string,
  ) => Promise<void>;
};

const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const appJson = JSON.parse(
  readFileSync(join(__dirname, "../app.json"), "utf8"),
) as { expo: Record<string, unknown> & { plugins: unknown[] } };

type MapLibrePlugin = [string, { android: Record<string, string> }];
const isMapLibre = (p: unknown): p is MapLibrePlugin =>
  Array.isArray(p) && p[0] === "@maplibre/maplibre-react-native";

const resolved = appConfig({
  config: appJson.expo,
} as Parameters<typeof appConfig>[0]);

// Logjam GPS builds against our patched MapLibre Android until upstream fixes
// the hillshade alignment (#587). maplibre/patched.json is the one declaration
// of its version: the workflow builds it, the plugin fetches it and
// app.config.ts asks MapLibre for it.
describe("patched MapLibre Android", () => {
  // Mutation: drop the nativeVersion mapping in app.config.ts.
  it("is the version Logjam GPS asks MapLibre for", () => {
    expect(resolved.plugins?.find(isMapLibre)?.[1].android.nativeVersion).toBe(
      patched.version,
    );
  });

  // Mutation: put nativeVersion back in app.json, a second declaration that
  // app.config.ts silently overrides.
  it("is not also declared in app.json", () => {
    expect(
      appJson.expo.plugins.find(isMapLibre)?.[1].android,
      "maplibre/patched.json is the one declaration of the MapLibre Android version while it is patched (#587)",
    ).not.toHaveProperty("nativeVersion");
  });

  // Mutation: switch nativeVariant to opengl; only the Vulkan build is patched.
  it("is the Vulkan build", () => {
    expect(resolved.plugins?.find(isMapLibre)?.[1].android.nativeVariant).toBe(
      "vulkan",
    );
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

  // The workflow never rebuilds a released version, so a patch edited under
  // the same version would leave the old library shipping.
  // Mutation: edit the patch without bumping `version`.
  it("is built from the patches in git", () => {
    const dir = join(__dirname, "../maplibre");
    const patches = readdirSync(dir)
      .filter((f) => f.endsWith(".patch"))
      .sort()
      .map((f) => readFileSync(join(dir, f)));
    expect(
      sha256(Buffer.concat(patches)),
      "mobile/maplibre/*.patch changed: a changed patch is a new library. Bump `version` in patched.json, set sha256.patch to this hash, and after merge pin the release the workflow builds",
    ).toBe(patched.sha256.patch);
  });
});

describe("fetchVerified", () => {
  const good = Buffer.from("the reviewed library");
  let dir: string;
  let dest: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "patched-maplibre-"));
    dest = join(dir, "maven", "lib.aar");
    fetchMock = vi.fn(async () => new Response(good));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  // Mutation: drop the `actual !== expected` check.
  it("refuses bytes whose sha256 is not the pinned one, and writes nothing", async () => {
    await expect(
      fetchVerified("lib.aar", sha256("another library"), dest),
    ).rejects.toThrow(/sha256/);
    expect(existsSync(dest)).toBe(false);
  });

  // Mutation: drop the 64-hex check on the pin.
  it("refuses a missing pin before fetching anything", async () => {
    await expect(fetchVerified("lib.aar", "", dest)).rejects.toThrow(
      /no sha256/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Mutation: trust any file already at dest.
  it("fetches again over a cached file that does not match", async () => {
    await fetchVerified("lib.aar", sha256(good), dest);
    writeFileSync(dest, "a swapped library");
    await fetchVerified("lib.aar", sha256(good), dest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(dest)).toEqual(good);
  });

  // Mutation: drop the cache check, and every prebuild downloads 200 MB.
  it("keeps a cached file that matches without fetching", async () => {
    await fetchVerified("lib.aar", sha256(good), dest);
    await fetchVerified("lib.aar", sha256(good), dest);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  // Mutation: a plain repository with a content filter, which narrows what our
  // folder serves but still lets Maven Central serve the module.
  it("makes our Maven folder the only source of the module", () => {
    const out = addRepository(generated);
    expect(out).toMatch(
      /repositories \{\n {4}exclusiveContent \{ forRepository \{ maven \{ url "\$rootDir\/maplibre-maven" \} \}; filter \{ includeModule\("org\.maplibre\.gl", "android-sdk-vulkan"\) \} \}\n {4}google\(\)/,
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

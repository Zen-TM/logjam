// Build Logjam GPS against OUR MapLibre Android: upstream's, with the one line
// in `maplibre/hillshade-aligned-at-rest.patch` changed.
//
// MapLibre Native draws the hillshade pixel-aligned on every frame, so while
// the map pans it steps a whole logical pixel at a time and the basemap, slope
// and contours glide past it: the layers look out of step until the map stops.
// Upstream: https://github.com/maplibre/maplibre-native/issues/4690. This whole
// plugin goes when a release carries the fix: #587.
//
// WHERE THE LIBRARY COMES FROM. `.github/workflows/maplibre-android.yml` builds
// it from MapLibre's sources and Makefile and attaches it to the GitHub release
// `maplibre-android-v<version>`. A GitHub release, not a committed file: a
// 200 MB binary in git stays in the history of every clone forever. This plugin
// fetches it at prebuild (EAS builders have the network) into a Maven folder
// inside the generated `android/`, and the build takes it from there.
//
// WHY THE CHECKSUMS. A release asset can be replaced; the sha256 in
// `maplibre/patched.json` is committed and reviewed, so a build takes only the
// file that was. A mismatch fails the prebuild rather than shipping it.
// Guard: the `fetchVerified` tests in src/patchedMapLibre.test.ts.
//
// WHY EXCLUSIVE. Gradle orders `13.5.0-logjam.1` below `13.5.0`, so if Maven
// Central could also serve the module, a dependency asking for 13.5.0 or later
// would quietly win with the unpatched build. Only our folder may serve it, so
// any other version fails the build instead. Guard: the `addRepository` tests
// in src/patchedMapLibre.test.ts.
const {
  withDangerousMod,
  withProjectBuildGradle,
} = require("expo/config-plugins");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const patched = require("../maplibre/patched.json");

const GROUP = "org.maplibre.gl";
// Only the Vulkan build is patched: the variant app.json picks
// (guard: src/patchedMapLibre.test.ts).
const ARTIFACT = "android-sdk-vulkan";
const MAVEN_DIR = "maplibre-maven";
const RELEASE_URL = `https://github.com/Zen-TM/logjam/releases/download/maplibre-android-v${patched.version}`;

const REPOSITORY_LINE = `    exclusiveContent { forRepository { maven { url "$rootDir/${MAVEN_DIR}" } }; filter { includeModule("${GROUP}", "${ARTIFACT}") } }`;

/** `android/build.gradle` with our Maven folder the only source of the module. */
function addRepository(buildGradle) {
  if (buildGradle.includes(REPOSITORY_LINE)) return buildGradle;
  const anchor = /allprojects\s*\{\s*\n\s*repositories\s*\{\s*\n/;
  if (!anchor.test(buildGradle)) {
    throw new Error(
      "withPatchedMapLibre: no `allprojects { repositories {` in android/build.gradle",
    );
  }
  return buildGradle.replace(anchor, (head) => `${head}${REPOSITORY_LINE}\n`);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fetchVerified(name, expected, dest) {
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(
      `withPatchedMapLibre: maplibre/patched.json has no sha256 for ${name}`,
    );
  }
  // A prebuild that keeps `android/` does not fetch again.
  if (fs.existsSync(dest) && sha256(fs.readFileSync(dest)) === expected) return;
  const url = `${RELEASE_URL}/${name}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`withPatchedMapLibre: ${url} answered ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(
      `withPatchedMapLibre: ${url} has sha256 ${actual}, maplibre/patched.json says ${expected}`,
    );
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
}

function withPatchedMapLibre(config) {
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        MAVEN_DIR,
        ...GROUP.split("."),
        ARTIFACT,
        patched.version,
      );
      const base = `${ARTIFACT}-${patched.version}`;
      await fetchVerified(
        `${base}.aar`,
        patched.sha256.aar,
        path.join(dir, `${base}.aar`),
      );
      await fetchVerified(
        `${base}.pom`,
        patched.sha256.pom,
        path.join(dir, `${base}.pom`),
      );
      return cfg;
    },
  ]);
  return withProjectBuildGradle(config, (cfg) => {
    cfg.modResults.contents = addRepository(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withPatchedMapLibre;
module.exports.addRepository = addRepository;
module.exports.fetchVerified = fetchVerified;

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Sentry sourcemap and symbol upload (docs/decisions/0004-mobile-sentry-and-scrubber.md):
// on for the EAS `preview` and `production` builds and the OTA lane, off in
// every other build, because a build with no SENTRY_AUTH_TOKEN fails.
const repo = join(__dirname, "../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

describe("Sentry upload", () => {
  // Mutation: put SENTRY_DISABLE_AUTO_UPLOAD back in `preview` (or `production`),
  // which ships a release with no symbols, or drop it from `development`.
  it("is off in the development profile and on in preview and production", () => {
    const { build } = JSON.parse(read("mobile/eas.json"));
    expect(build.development.env.SENTRY_DISABLE_AUTO_UPLOAD).toBe("true");
    for (const profile of ["preview", "production"]) {
      expect(build[profile].env ?? {}, profile).not.toHaveProperty(
        "SENTRY_DISABLE_AUTO_UPLOAD",
      );
    }
  });

  // Mutation: delete the flag from one of these, then run that build with no
  // token: a local or CI Gradle build dies at the Sentry upload task.
  it.each([
    ".github/actions/build-dev-apk/action.yml",
    "mobile/scripts/dev-android.sh",
    "mobile/scripts/build-local-apk.sh",
  ])("%s disables the upload itself", (path) => {
    expect(read(path)).toMatch(/SENTRY_DISABLE_AUTO_UPLOAD[=:] ?"?true"?/);
  });

  // Mutation: move the upload after "Promote to production" (a failed upload
  // then comes too late to stop it), or before "Publish to preview" (dist/
  // holds no bundle yet).
  it("uploads an OTA update's sourcemaps after publishing and before promoting", () => {
    const hotfix = read(".github/workflows/ota-hotfix.yml");
    const at = (name: string) => {
      const i = hotfix.indexOf(`- name: ${name}\n`);
      expect(i, name).toBeGreaterThan(-1);
      return i;
    };
    expect(at("Publish to preview")).toBeLessThan(
      at("Upload the sourcemaps to Sentry"),
    );
    expect(at("Upload the sourcemaps to Sentry")).toBeLessThan(
      at("Promote to production"),
    );
  });

  // Mutation: drop the option, which opens an unauthenticated route on the
  // Metro dev server that reads any file under mobile/ (.env, keys/).
  it("keeps the dev server's source-context route off", () => {
    expect(read("mobile/metro.config.js")).toMatch(
      /getSentryExpoConfig\(projectRoot, \{\s*enableSourceContextInDevelopment: false,?\s*\}\)/,
    );
  });
});

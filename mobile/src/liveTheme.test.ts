import { ESLint } from "eslint";
import { THEME_SCHEME_ORDER, THEME_SCHEMES } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { huesFor } from "./theme";

// The scheme is state: picking one in Settings → Display repaints the running
// app. That only holds while nothing keeps a colour from before the change, so
// theme.ts exports no colour as a module constant and the names it once used
// for them may not be imported (`logjam/no-launch-theme` in eslint.config.js).
//
// Mutations that turn it red: drop a name from the rule's `importNames`; delete
// the rule's block from eslint.config.js; make it "warn".
const RULE = "logjam/no-launch-theme";
const LAUNCH_STATICS = [
  "theme",
  "textRole",
  "assetHue",
  "placeHue",
  "notificationHue",
  "themeMode",
  "activeThemeSchemeId",
];

async function lint(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === RULE);
}

describe("the launch scheme's statics", () => {
  it("may not be imported from theme.ts, at any depth", async () => {
    for (const [filePath, from] of [
      ["src/ui/Probe.tsx", "../theme"],
      ["src/screens/settings/Probe.tsx", "../../theme"],
      ["App.tsx", "./src/theme"],
    ]) {
      const messages = await lint(
        `import { ${LAUNCH_STATICS.join(", ")} } from "${from}";\n`,
        filePath,
      );
      expect(messages).toHaveLength(LAUNCH_STATICS.length);
    }
  }, 60_000);

  it("is an error, not a warning", async () => {
    const [message] = await lint(
      'import { theme } from "../theme";\n',
      "src/screens/Probe.tsx",
    );
    expect(message.severity).toBe(2);
  }, 60_000);

  it("leaves the hooks and the scheme-independent tokens alone", async () => {
    const messages = await lint(
      'import { makeStyles, spacing, useHues, useTheme } from "../theme";\n',
      "src/ui/Probe.tsx",
    );
    expect(messages).toEqual([]);
  }, 60_000);
});

describe("huesFor", () => {
  it("draws a region in each scheme's own accent", () => {
    for (const id of THEME_SCHEME_ORDER) {
      const { tokens } = THEME_SCHEMES[id];
      expect(huesFor(tokens).assetHue.region).toBe(tokens.accent);
      expect(huesFor(tokens).notificationHue.problem).toBe(tokens.warning);
    }
  });

  // A hue set is handed to memoised rows, so it must not be rebuilt per render.
  it("builds one set per scheme", () => {
    const { tokens } = THEME_SCHEMES[THEME_SCHEME_ORDER[0]];
    expect(huesFor(tokens)).toBe(huesFor(tokens));
  });
});

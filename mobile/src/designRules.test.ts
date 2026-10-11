import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { spacing } from "./theme";

// Rules of mobile/DESIGN.md that a lint rule or a scan of the source holds, so
// they are not followed by memory.
//
// Mutations that turn it red: give `cellChosen` in `places/PlaceTypesEditor.tsx`
// a `borderWidth`; write `emitToast(err.message, "error")` anywhere; put a hex
// colour in a file under `src/map`.
const SRC = __dirname;
const STATE_STYLE =
  /^\s*\w*(Chosen|Selected|Active|Checked|Focused|Pressed|Current|On)\w*:\s*\{[^}]*borderWidth/m;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
      ? [path]
      : [];
  });
}

async function lint(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: join(SRC, "..") });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("a card's border width never changes with state", () => {
  // Fabric drops the children of a rounded `overflow: hidden` card when its
  // border width changes. A style named for a state may change the colour only.
  it("holds for every style named for a state", () => {
    const offenders = sources(SRC)
      .filter((path) => STATE_STYLE.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });

  it("recognises the shape it forbids", () => {
    expect(
      STATE_STYLE.test("  cellChosen: { borderWidth: 2, borderColor: x },"),
    ).toBe(true);
  });
});

describe("words a user reads are ours", () => {
  it("bans an error's message in a toast or in JSX", async () => {
    const toast = await lint(
      "emitToast(err.message, 'error');\n",
      "src/screens/Probe.tsx",
    );
    const jsx = await lint(
      "export const A = () => <Text>{error.message}</Text>;\n",
      "src/screens/Probe.tsx",
    );
    expect(toast).toHaveLength(1);
    expect(jsx).toHaveLength(1);
  }, 60_000);

  it("leaves a style named message alone", async () => {
    const messages = await lint(
      "export const A = () => <Text style={styles.message}>x</Text>;\n",
      "src/screens/Probe.tsx",
    );
    expect(messages).toEqual([]);
  }, 60_000);
});

describe("a colour on the map is a token", () => {
  it("bans a hex literal anywhere outside the theme and the kit", async () => {
    const messages = await lint(
      'export const RING = "#ffffff";\n',
      "src/map/Probe.tsx",
    );
    expect(messages).toHaveLength(1);
  }, 60_000);
});

describe("an empty list is the kit's EmptyState", () => {
  // A screen that draws its own glyph, line and button drifts from every other
  // one. Mutation: give any screen a style named `empty` or `emptyTitle`.
  it("has no screen styled its own", () => {
    const OWN = /^\s*empty(Title)?:/m;
    const offenders = sources(SRC)
      .filter((path) => !relative(SRC, path).startsWith("ui/"))
      .filter((path) => OWN.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});

describe("space is a step of the scale", () => {
  // `spacing()` takes a `SpaceStep`, so 6dp (0.75) does not typecheck; and a
  // bare number in a space property is a lint error. Mutations: add "0.75" to
  // SPACE (the directive below is then unused and typecheck fails); drop
  // SPACING_PROPS from eslint.config.js.
  it("is the scale's steps and nothing between them", () => {
    expect(spacing(0.25)).toBe(2);
    // @ts-expect-error 6dp is not a step: inside one object take 4, between 8
    expect(spacing(0.75)).toBe(6);
  });

  it("bans a bare number or a negative in a space property", async () => {
    for (const style of [
      "{ gap: 8 }",
      "{ paddingHorizontal: 6 }",
      "{ marginLeft: -1 }",
    ]) {
      const messages = await lint(
        `export const s = ${style};\n`,
        "src/screens/Probe.tsx",
      );
      expect(messages, style).toHaveLength(1);
    }
    expect(
      await lint(
        "export const s = { gap: 0, flex: 1, width: 8 };\n",
        "src/screens/Probe.tsx",
      ),
    ).toEqual([]);
  }, 60_000);
});

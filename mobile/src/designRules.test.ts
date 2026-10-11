import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

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

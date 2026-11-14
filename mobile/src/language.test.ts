import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The language is read before `@logjam/shared` loads, because contract text is
// evaluated when shared loads (language.ts). Each test loads its own copies.
const prefs = vi.hoisted(() => new Map<string, string>());
vi.mock("./prefsDb", () => ({
  readPref: (key: string) => prefs.get(key) ?? null,
}));

const globals = globalThis as { LOGJAM_LANGUAGE?: string };

afterEach(() => {
  vi.resetModules();
  prefs.clear();
  delete globals.LOGJAM_LANGUAGE;
});

const imports = (file: string) =>
  [
    ...readFileSync(join(__dirname, file), "utf8").matchAll(
      /^import\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm,
    ),
  ].map((m) => m[1]);

describe("language.ts", () => {
  // Mutation: delete the line that sets LOGJAM_LANGUAGE in language.ts.
  it("sets the language the phone kept, before shared loads", async () => {
    prefs.set("language", "en-XA");
    await import("./language");
    expect(globals.LOGJAM_LANGUAGE).toBe("en-XA");
    const { LANGUAGE_SETTING } = await import("@logjam/shared");
    expect(LANGUAGE_SETTING.title).toMatch(/^⟦.*⟧$/);
  }, 30_000);

  // Mutation: set LOGJAM_LANGUAGE unconditionally in language.ts.
  it("leaves the source language when nothing is kept", async () => {
    await import("./language");
    expect(globals.LOGJAM_LANGUAGE).toBeUndefined();
    const { LANGUAGE_SETTING } = await import("@logjam/shared");
    expect(LANGUAGE_SETTING.title).toBe("Language");
  }, 30_000);

  // Mutation: import @logjam/shared (or a file that does) from language.ts or prefsDb.ts.
  it("loads nothing that reaches @logjam/shared", () => {
    expect(imports("language.ts")).toEqual(["./prefsDb"]);
    expect(imports("prefsDb.ts")).toEqual(["expo-sqlite"]);
  });

  // Mutation: move `import "./src/language"` below another import in index.ts
  // (or `import "./src/simRegions"` and it swap places, which the switch's own
  // guard in simRegions.test.ts also catches).
  it("index.ts imports the language right after the polyfills and the switch", () => {
    expect(imports("../index.ts").slice(0, 4)).toEqual([
      "react-native-get-random-values",
      "react-native-url-polyfill/auto",
      "./src/simRegions",
      "./src/language",
    ]);
  });
});

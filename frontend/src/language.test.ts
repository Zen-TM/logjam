import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The language is read before `@logjam/shared` loads, because contract text is
// evaluated when shared loads (language.ts). Each test loads its own copies.
const globals = globalThis as { LOGJAM_LANGUAGE?: string };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  localStorage.clear();
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
  it("sets the language the browser kept, before shared loads", async () => {
    localStorage.setItem("logjam.language", "en-XA");
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

  // Mutation: remove the try/catch round the read in language.ts.
  it("starts in the source language when the browser refuses storage", async () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
    });
    await expect(import("./language")).resolves.toBeTruthy();
    expect(globals.LOGJAM_LANGUAGE).toBeUndefined();
  });

  // Mutation: import @logjam/shared (or a file that does) from language.ts, or
  // change the scan's pattern so it finds no import (the floor catches that).
  it("loads nothing that reaches @logjam/shared", () => {
    expect(imports("main.tsx").slice(0, 2)).toEqual([
      "./simRegions",
      "./language",
    ]);
    expect(imports("language.ts")).toEqual([]);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { copySay, copyViolations, userFacingStrings } from "@logjam/shared";

// The words a user reads on Logjam GPS keep the copy rules of
// shared/DESIGN.md §12 (`COPY_RULES` in @logjam/shared): no "Retry", "the app",
// "basemap", "tiles" or "the server", and no Title Case label. The net is JSX
// text, the string props that carry words (`label`, `title`, `message`, …) and
// object properties of those names; a string reaching the user another way
// is a gap in the net, not a licence.
//
// A hit is fixed. One that is legitimate is listed with the reason.
// Mutation that turns it red: set `title` in `ui/RootErrorBoundary.tsx`'s text
// back to "…Restarting the app usually fixes it."
const SRC = join(__dirname);
const ALLOWED: { file: string; text: string; reason: string }[] = [];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
      ? [path]
      : [];
  });
}

describe("copy on Logjam GPS", () => {
  it("reads the strings of the net — a silent zero would pass forever", () => {
    const [first] = userFacingStrings(
      ts,
      "x.tsx",
      'export const a = <Row title="Open it">Hello there</Row>;',
    );
    expect(first.text).toBe("Open it");
  });

  it("breaks no copy rule", () => {
    const offenders = sources(SRC).flatMap((path) =>
      userFacingStrings(ts, path, readFileSync(path, "utf8")).flatMap(
        ({ line, text }) =>
          copyViolations(text)
            .filter(
              () =>
                !ALLOWED.some(
                  (a) =>
                    relative(SRC, path) === a.file && text.includes(a.text),
                ),
            )
            .map(
              (id) =>
                `${relative(SRC, path)}:${line} "${text}" — ${copySay(id)}`,
            ),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

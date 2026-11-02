import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { userFacingStrings } from "@logjam/shared";

// A sentence about who can see or do something is declared in
// `contracts/share.ts` and read by both clients, so the two can't promise
// different things (shared/DESIGN.md §12). Mutation that turns it red: type
// the bulk-share promise into a component again ("Recipients can copy them
// while the share is active.").
const SRC = __dirname;
const SHARE_WORDS = /can see|visible to|while the share|recipients/i;
const ALLOWED: { file: string; text: string; reason: string }[] = [
  {
    file: "screens/settings/PrivacySettingsScreen.tsx",
    text: "can see",
    reason: "other apps on the phone, not friends",
  },
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
      ? [path]
      : [];
  });
}

describe("share sentences on Logjam GPS", () => {
  it("writes none of its own", () => {
    const offenders = sources(SRC).flatMap((path) =>
      userFacingStrings(ts, path, readFileSync(path, "utf8"))
        .filter(({ text }) => SHARE_WORDS.test(text))
        .filter(
          ({ text }) =>
            !ALLOWED.some(
              (each) =>
                relative(SRC, path) === each.file && text.includes(each.text),
            ),
        )
        .map(({ line, text }) => `${relative(SRC, path)}:${line} "${text}"`),
    );
    expect(offenders).toEqual([]);
  });

  it("sees a sentence it forbids", () => {
    const [first] = userFacingStrings(
      ts,
      "x.tsx",
      "export const a = <p>Friends can see this.</p>;",
    );
    expect(SHARE_WORDS.test(first.text)).toBe(true);
  });
});

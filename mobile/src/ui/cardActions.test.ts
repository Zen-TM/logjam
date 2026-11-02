import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// BUTTONS IN A CARD'S FOOTER ARE LAID OUT BY `CardActions`, NOT BY HAND.
//
// A `Row`'s `footer` that holds `<Button`s inside its own `<View>` has its own
// row, gap and sizing, and drifts from the notification cards the rule copies
// (shared/DESIGN.md §5). Only `CardActions` may do it.
//
// Mutation that turns it red: in `plans/PlanPreview.tsx`, change the invite
// card's `<CardActions>` / `</CardActions>` back to `<View>` / `</View>`.
const SRC = join(__dirname, "..");

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.tsx$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

/** Footer expressions of `<Row` elements with a `<View>` wrapping `<Button`s. */
export function handRolledFooters(source: string): number {
  let count = 0;
  for (const m of source.matchAll(/footer=\{/g)) {
    const before = source.slice(0, m.index);
    const tag = Math.max(
      before.lastIndexOf("<Row\n"),
      before.lastIndexOf("<Row "),
      before.lastIndexOf("<BottomSheet"),
    );
    if (tag < 0 || !source.startsWith("<Row", tag)) continue;
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
    }
    const body = source.slice(start, i);
    if (/<View[^>]*>\s*(?:\{[^}]{0,200}=>\s*\(\s*)?<Button[\s>]/.test(body))
      count++;
  }
  return count;
}

describe("buttons in a card footer", () => {
  it("recognises a hand-rolled footer", () => {
    const hand = `<Row\n footer={<View style={s.a}><Button label="x" /></View>}\n/>`;
    const kit = `<Row\n footer={<CardActions><Button label="x" /></CardActions>}\n/>`;
    expect(handRolledFooters(hand)).toBe(1);
    expect(handRolledFooters(kit)).toBe(0);
  });

  it("are laid out by CardActions, never by a View on the screen", () => {
    const offenders = sourcesUnder(SRC)
      .filter((p) => handRolledFooters(readFileSync(p, "utf8")) > 0)
      .map((p) => relative(SRC, p));
    expect(offenders).toEqual([]);
  });
});

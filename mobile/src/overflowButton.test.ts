import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A ⋯ wears no box and no accent: the one look is IconButton's default (muted),
// as in Notifications. Red when an overflow IconButton gets `filled` or a `color`:
// add `filled` to the ⋯ in PlaceDetailScreen.tsx.
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : [];
  });
}

describe("the ⋯ button", () => {
  it("is never filled or tinted", () => {
    const dir = new URL(".", import.meta.url).pathname;
    const offenders = sources(dir).flatMap((file) =>
      (readFileSync(file, "utf8").match(/<IconButton\b[\s\S]*?\/>/g) ?? [])
        .filter((tag) => tag.includes('icon="overflow"'))
        .filter(
          (tag) =>
            /\bfilled\b/.test(tag) ||
            /\bcolor=(?!\{theme\.textMuted\})/.test(tag),
        )
        .map(() => file),
    );
    expect(offenders).toEqual([]);
  });
});

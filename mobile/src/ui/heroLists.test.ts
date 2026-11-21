import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

/** The opening tag of every virtualised Hero list in `source`, props included. */
function heroListTags(source: string): string[] {
  const tags: string[] = [];
  for (const start of source.matchAll(/<Hero(?:FlatList|SectionList)\b/g)) {
    let depth = 0;
    let end = start.index;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0 && source[end - 1] !== "=") break;
    }
    tags.push(source.slice(start.index, end));
  }
  return tags;
}

describe("the lists under a collapsing header", () => {
  // Mutation: delete `removeClippedSubviews={false}` from one of them. A
  // FlatList defaults it to true on Android, and its clipped rows are put back
  // on the scroll's JS events, which the native-driven scroll sends too late:
  // a fast fling flew over a blank list on a Galaxy S9, in a production bundle
  // too.
  it("keep their off-screen rows attached", () => {
    const tags = sourceFiles(SRC).flatMap((file) =>
      heroListTags(readFileSync(file, "utf8")).map((tag) => ({ file, tag })),
    );
    // Places, Trips, Plans, Friends and Notifications.
    expect(tags.length).toBeGreaterThanOrEqual(5);
    for (const { file, tag } of tags)
      expect(tag, file).toContain("removeClippedSubviews={false}");
  });
});

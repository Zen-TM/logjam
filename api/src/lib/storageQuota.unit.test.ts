import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The storage counter has ONE pair of writers, and the reason is the clamp.
 *
 * `decrementStorageUsed` subtracts with `GREATEST(0, …)`, because the byte count
 * it is handed is whatever the row recorded and the counter is whatever survives
 * a re-seed, a partial delete or a job whose bytes were counted twice. Two
 * delete paths — `DELETE /topo-exports/:id` and `DELETE /geo-pdf/:id` — wrote
 * `{ storageUsedBytes: { decrement } }` through Prisma instead, with no clamp,
 * so one of them drove the dev account to **-118 MB** and the Account page
 * reported "-118476.6 KB of 5.00 GB". A signed counter never recovers on its
 * own: every later clamped decrement clamps against a negative, and the user's
 * quota reads as free space they do not have.
 *
 * `topoJobs.ts` had already written the rule down in a comment
 * ("decrementStorageUsed clamps at 0 — keep it for that"). This is the same rule
 * with a test behind it, per the root CLAUDE.md: an invariant in a comment is a
 * comment.
 */
describe("the storage counter has one pair of writers", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) return [];
      return [full];
    });
  }

  it("nothing outside storageQuota.ts increments or decrements it directly", () => {
    // `storageUsedBytes: { increment … }` / `{ decrement … }` in a Prisma write.
    const rawWrite = /storageUsedBytes:\s*\{\s*(increment|decrement)\b/g;
    const offenders = sourceFiles(join(__dirname, "..")).flatMap((file) =>
      file.endsWith("lib/storageQuota.ts")
        ? []
        : (readFileSync(file, "utf8").match(rawWrite) ?? []).map(
            (hit) => `${file}: ${hit.replace(/\s+/g, " ")}`,
          ),
    );
    expect(offenders).toEqual([]);
  });

  it("the decrement is the clamped one", () => {
    const source = readFileSync(join(__dirname, "storageQuota.ts"), "utf8");
    expect(source).toMatch(/GREATEST\(0,\s*storage_used_bytes\s*-/);
  });
});

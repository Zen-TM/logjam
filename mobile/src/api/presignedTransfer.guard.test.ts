import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Presigned legs require a first-byte timeout because a connect() can hang
// forever. Bare `uploadAsync`/`downloadAsync` take no timeout at all and are
// banned outright: every transfer in Logjam GPS is a presigned S3 leg. Use
// uploadToPresignedUrl / downloadFromPresignedUrl (or the task API directly,
// as regionDownloads does, which gives cancellation and progress of its own).
describe("no unguarded presigned transfer", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name))
        return [];
      return [full];
    });
  }

  it("no source file calls FileSystem.uploadAsync/downloadAsync directly", () => {
    const bare = /FileSystem\.(uploadAsync|downloadAsync)\s*\(/g;
    const src = join(__dirname, "..");
    const offenders = sourceFiles(src).flatMap((file) =>
      (readFileSync(file, "utf8").match(bare) ?? []).map(
        (hit) => `${file.slice(src.length + 1)}: ${hit}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

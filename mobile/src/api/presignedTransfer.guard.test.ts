import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// mobile/CLAUDE.md: "a second caller inherits the first one's guards". MAPP-006
// gave the presigned legs a first-byte timeout because a Pixel-9 connect() can
// hang forever, but the fix landed on three call sites while three more —
// mediaUpload's PUT and mediaCache's two downloads — kept calling the bare
// expo-file-system functions, which take no timeout at all. That gap was found
// by reading a report, not by a failing test, which is the whole problem.
//
// Bare `uploadAsync`/`downloadAsync` are banned outright: every transfer in
// this app is a presigned S3 leg. Use uploadToPresignedUrl /
// downloadFromPresignedUrl (or the task API directly, as regionDownloads does,
// which gives cancellation and progress of its own).
describe("no unguarded presigned transfer", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
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

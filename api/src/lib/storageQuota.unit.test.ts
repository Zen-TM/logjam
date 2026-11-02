import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { applyStorageChanges } from "./storageQuota";

/**
 * The storage counter has ONE pair of writers, and the reason is the clamp.
 *
 * `decrementStorageUsed` subtracts with `GREATEST(0, …)`, because the byte count
 * it is handed is whatever the row recorded and the counter is whatever survives
 * a re-seed, a partial delete or a job whose bytes were counted twice.
 * Unclamped decrements drive the counter negative, after which clamped decrements
 * cannot recover and quota reads as free space the user does not have. All
 * decrements must go through `decrementStorageUsed`, per root AGENTS.md's rule that
 * a rule that must hold gets an executable check.
 */
describe("the storage counter has one pair of writers", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      if (!entry.name.endsWith(".ts") || entry.name.includes(".test."))
        return [];
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

// Mutation: apply the changes in the map's insertion order.
describe("applyStorageChanges", () => {
  it("locks each user's row in user id order", async () => {
    const order: unknown[] = [];
    const db = {
      $executeRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => {
        order.push(values[values.length - 1]);
        return 1;
      },
    } as unknown as Prisma.TransactionClient;
    await applyStorageChanges(
      new Map([
        ["c", 5n],
        ["a", -3n],
        ["b", 0n],
        ["d", -1n],
      ]),
      db,
    );
    expect(order).toEqual(["a", "c", "d"]);
  });
});

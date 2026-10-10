import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SYNC_TABLES } from "../sync/mirrorSchema";
import { SCHEMA_SQL } from "./schema";
import { signOutConfirm, type SignOutCounts } from "./signOutConfirm";
import {
  LOSSES,
  OFFLINE_TABLES,
  OFFLINE_TABLE_FATE,
  SYNC_LOCAL_TABLE_FATE,
  WIPED_DIR_FATE,
  type Loss,
  type StoreFate,
} from "./wipedStores";

// The sign-out confirmation names everything the wipe takes that the account
// cannot give back. This holds the two together: every table and directory the
// wipe clears has a fate in `wipedStores.ts`, and every kind of loss a fate
// names has a line in the confirmation, so a store cannot be added to the wipe
// without deciding whether the user is told.
//
// Mutations that turn it red: add a `CREATE TABLE` to `offline/schema.ts`, a
// `local` table to `sync/mirrorSchema.ts` or a directory to `WIPED_DIRS` in
// `offline/localStores.ts` without a fate in `wipedStores.ts`; or add a name to
// `LOSSES` that `signOutConfirm.ts` has no line for.

const OFFLINE_DIR = __dirname;

/** The constants `WIPED_DIRS` lists, read from source: `localStores.ts` needs
 *  expo-file-system, which a plain test process does not have. */
function wipedDirNames(): string[] {
  const source = readFileSync(join(OFFLINE_DIR, "localStores.ts"), "utf8");
  const list = /export const WIPED_DIRS = \[([\s\S]*?)\] as const/.exec(
    source,
  )?.[1];
  expect(list, "WIPED_DIRS in localStores.ts").toBeDefined();
  return (list as string)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function fates(): StoreFate[] {
  return [
    ...Object.values(SYNC_LOCAL_TABLE_FATE),
    ...Object.values(OFFLINE_TABLE_FATE),
    ...Object.values(WIPED_DIR_FATE),
  ];
}

describe("every store the sign-out wipe clears has a fate", () => {
  it("covers every table in logjam-offline.db", () => {
    const declared = [
      ...SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g),
    ]
      .map((match) => match[1])
      .sort();
    expect(declared.length).toBeGreaterThan(0);
    expect([...OFFLINE_TABLES].sort()).toEqual(declared);
  });

  it("covers every local table in logjam.db", () => {
    const local = SYNC_TABLES.filter((table) => table.kind === "local")
      .map((table) => table.name)
      .sort();
    expect(Object.keys(SYNC_LOCAL_TABLE_FATE).sort()).toEqual(local);
  });

  it("covers every directory the wipe deletes", () => {
    expect(Object.keys(WIPED_DIR_FATE).sort()).toEqual(wipedDirNames().sort());
  });

  it("gives every store either a loss to name or the reason it need not be", () => {
    for (const fate of fates()) {
      if ("keeps" in fate) expect(fate.keeps.trim().length).toBeGreaterThan(0);
      else {
        expect(fate.loses.length).toBeGreaterThan(0);
        for (const loss of fate.loses) expect(LOSSES).toContain(loss);
      }
    }
  });
});

describe("every kind of loss is named by the confirmation", () => {
  const none: SignOutCounts = {
    unsynced: 0,
    unresolved: 0,
    recordings: 0,
    routeDraft: 0,
    regions: 0,
    regionBytes: 0,
    geoPdfs: 0,
    topos: 0,
  };

  it("has a line for each loss, and a store that can cause it", () => {
    const named = new Set<Loss>(
      fates().flatMap((fate) => ("loses" in fate ? [...fate.loses] : [])),
    );
    for (const loss of LOSSES) {
      expect(named, `no store declares ${loss}`).toContain(loss);
      const confirm = signOutConfirm({ ...none, [loss]: 1 }, false);
      expect(confirm?.lines, `no line for ${loss}`).toHaveLength(1);
    }
  });
});

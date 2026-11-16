import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import type { Catalogue } from "./i18n.js";
import { enUS } from "./i18nCatalogues/en-US.js";
import {
  bareCopyIn,
  ceilingFailures,
  DATA_LITERALS,
  EXEMPT_FILES,
  I18N_ADR,
  messagesIn,
  missingEntries,
  orphanKeys,
  ratchetReads,
  scanSources,
} from "./i18nSource.js";

// User-facing text goes through `t`, `plural`, `rich` or `say`
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md).
// Text written the old way is counted per directory and may only fall: new
// copy in @logjam/shared goes through the catalogue, and a directory that moves its
// text lowers its number in the same change. The scanner is `i18nSource.ts` in
// @logjam/shared; what it must and must not flag is held in its own test.

const SRC = dirname(fileURLToPath(import.meta.url));

/** Bare literals a user may read, per directory under src. Lower an entry when its text moves; never raise one. */
const CEILINGS: Record<string, number> = {};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return ratchetReads(entry.name, true) ? sources(path) : [];
    return ratchetReads(entry.name, false) ? [path] : [];
  });
}

// Parsing every source file takes seconds under load, so it runs once, in a
// beforeAll with a long timeout, as `copyRules.test.ts` does.
let scan: ReturnType<typeof scanSources>;
let fileCount = 0;
beforeAll(() => {
  const files = sources(SRC).map((path) => ({
    path: relative(SRC, path),
    source: readFileSync(path, "utf8"),
  }));
  fileCount = files.length;
  scan = scanSources(ts, "shared", files);
}, 30_000);

describe("@logjam/shared i18n coverage", () => {
  // Mutation: change `sources`'s extension test to `/\.tsxx?$/`, so it finds no file.
  it("reads the source at all — a silent zero would pass forever", () => {
    expect(fileCount).toBeGreaterThan(130);
    // About 46 messages today, all `say`.
    expect(scan.messages.length).toBeGreaterThan(40);
  });

  // Mutation: add ``export const zz = t` leading`;`` to any source file.
  it("holds every message to the hygiene rules", () => {
    expect(
      scan.messages
        .filter((message) => message.problems.length)
        .map(
          ({ file, line, key, problems }) =>
            `${file}:${line} "${key}": ${problems.join("; ")} (${I18N_ADR})`,
        ),
    ).toEqual([]);
  });

  // Mutation: add `import { t as tr } from "@logjam/shared";` to any source file.
  it("imports the message functions by their own names", () => {
    expect(
      scan.imports.map(
        ({ file, line, problem }) => `${file}:${line} ${problem} (${I18N_ADR})`,
      ),
    ).toEqual([]);
  });

  // Mutation: add `export const zz = "Open the file";` to any source file, or
  // raise or lower a ceiling, or move a directory's text into `t` without lowering it.
  it("writes no new text outside the catalogue, and every ceiling is the count", () => {
    expect(ceilingFailures(scan.counts, CEILINGS, scan.bare)).toEqual([]);
  });
});

// What a US reader finds foreign in the Australian source: a spelling, or a
// word (rappel for abseil, check for tick). Each is a regular expression
// matched from the start of a word, any case. A message in source that holds
// one has an entry in `i18nCatalogues/en-US.ts`, or is in `LEFT_AS_WRITTEN`
// with its reason, so a message written later with "colour" in it fails until
// it has a US entry. A word that matches no message yet is here for the
// messages still to come: "bushwalk" is in no converted message today.
const AUSTRALIAN_WORDS: readonly string[] = [
  // -our, -re, -ce, -ae
  "colour",
  "favour",
  "honour",
  "neighbour",
  "behaviour",
  "centre",
  "centimetre",
  "kilometre",
  "millimetre",
  "metre",
  "litre",
  "licence",
  "defence",
  "offence",
  // -ise, -ised, -ising, -isation, written from the stems that are no US word
  // already (a bare "is" prefix would catch "optimistic", "exercise", "promise")
  "(?:organ|recogn|summar|custom|initial|author|synchron|personal|optim|minim|maxim|normal|real|categor|priorit|final|util|apolog)is(?:e|ed|es|ing|ation|ations)\\b",
  "analys(?:e|ed|ing)\\b",
  // a doubled consonant before -ed, -ing, -er
  "travell",
  "cancell(?:ed|ing|er)\\b",
  "modell",
  "labell",
  "signall",
  "levell",
  "fuell",
  // other spellings
  "grey",
  "programme",
  "whilst",
  "tyre",
  "kerb",
  "cheque",
  "artefact",
  "ageing",
  "judgement",
  "sceptic",
  "mould",
  "plough",
  "aluminium",
  "jewellery",
  "storey",
  "fulfil(?:ment)?\\b",
  "enrol(?:ment)?\\b",
  "practise",
  "burnt",
  "learnt",
  "ochre",
  // words
  "abseil",
  "bushwalk",
  "bushbash",
  "bushland",
  "canyoning",
  "carpark",
  "footpath",
  "level on\\b",
  "mobile (?:reception|coverage|signal|phone|network|data)",
  "mum\\b",
  "need(?:s)? a lift",
  "petrol",
  "rubbish",
  "suburb",
  "tenure",
  "tick(?:s|ed|ing)?\\b",
  "torch",
];

// A message that holds a listed word and stays as the source writes it, and why.
// Each must still exist and still hold a word, and none may also have an entry
// ("keeps nothing both translated and left as written").
const LEFT_AS_WRITTEN: Readonly<Record<string, string>> = {
  "Copernicus DEM licence":
    "the name of the licence a data source is published under, which stays as its publisher names it (ADR 0050, rule 4)",
  "Tenure unresolved":
    "a New South Wales land class, named as its data source names it",
  "Trips with a linked canyon are always tagged canyoning.":
    "names the stored trip tag `canyoning` (`CANYONING_TRIP_TYPE`, shared/src/tripName.ts), which a US reader sees as it is stored",
};

const holdsAustralianWord = (text: string) =>
  AUSTRALIAN_WORDS.some((word) => new RegExp(`\\b${word}`, "i").test(text));

describe("the en-US catalogue", () => {
  const REPO = join(SRC, "../..");
  // Every message in the four packages (about 1,900 distinct today): the catalogue is shared, so a key
  // belongs to a message in any of them.
  const keys = new Set<string>();
  beforeAll(() => {
    for (const pkg of ["shared", "frontend", "mobile", "api"]) {
      const root = join(REPO, pkg, "src");
      // Logjam GPS's root component sits beside its `src`.
      const extra = pkg === "mobile" ? [join(REPO, "mobile", "App.tsx")] : [];
      for (const path of [...sources(root), ...extra])
        for (const message of messagesIn(ts, path, readFileSync(path, "utf8")))
          keys.add(message.key);
    }
  }, 30_000);

  // Mutation: drop "api" from the package list in `beforeAll`.
  it("reads the messages of every package — a silent zero would pass forever", () => {
    expect(keys.size).toBeGreaterThan(150);
  });

  // Mutation: add `"Abseil down {0}": "Rappel down {0}"` to `enUS`, or reword
  // a message that has an entry without moving the entry.
  it("has no entry whose message is gone", () => {
    expect(
      orphanKeys(enUS, keys).map(
        (key) =>
          `"${key}" matches no message in source. A reworded message leaves its entry behind: move or delete it (${I18N_ADR}).`,
      ),
    ).toEqual([]);
  });

  // Mutation: delete the entry for "Invite cancelled." from `enUS`, or add
  // ``export const zz = say`Your colour is saved.`;`` to any source file.
  it("has an entry for every message that holds an Australian spelling", () => {
    expect(
      missingEntries(enUS, keys, AUSTRALIAN_WORDS, LEFT_AS_WRITTEN).map(
        (key) =>
          `"${key}" holds a word a US reader finds foreign and has no US entry. Add one to i18nCatalogues/en-US.ts, or name it in LEFT_AS_WRITTEN with its reason (${I18N_ADR}).`,
      ),
    ).toEqual([]);
  });

  // Mutation: empty `AUSTRALIAN_WORDS`, or write `\\bX${word}` in `holdsAustralianWord`.
  it("finds the messages with an Australian word — a list that stopped matching would pass forever", () => {
    const found = [...keys].filter(holdsAustralianWord);
    // 44 today: 41 with an entry and the 3 in `LEFT_AS_WRITTEN`.
    expect(found.length).toBeGreaterThanOrEqual(40);
    for (const word of ["colour", "abseil", "cancell", "tick", "mobile"])
      expect(
        found.some((key) => new RegExp(`\\b${word}`, "i").test(key)),
        word,
      ).toBe(true);
  });

  // Mutation: change `priorit` in the -ise stems to `prioriti`, `cancell(?:ed|ing|er)\\b`
  // to `cancell`, or `analys(?:e|ed|ing)\\b` to `analyse`, in `AUSTRALIAN_WORDS`.
  it.each([
    ["Prioritise this", true],
    ["They prioritised it", true],
    ["Prioritisation", true],
    ["Invite cancelled.", true],
    ["Still cancelling", true],
    ["Analyse the track", true],
    ["It was analysed", true],
    ["Analysing…", true],
    ["Fulfilment", true],
    ["Enrolment", true],
    ["5 centimetres", true],
    ["2 millimetres", true],
    ["Cancellation policy", false],
    ["Two analyses", false],
    ["Top priority", false],
    ["Cancel", false],
    ["Invite canceled.", false],
    ["An optimistic guess", false],
    ["Exercise caution", false],
    ["Your ticket", false],
    ["Fulfillment", false],
    ["You enrolled", false],
  ])("reads %j as a message with an Australian word: %s", (text, holds) => {
    expect(holdsAustralianWord(text)).toBe(holds);
  });

  // Mutation: add `"Open the file": "Open the file"` to `enUS`, or leave "colour" in an entry's text.
  it("has no entry that is its own message or still holds an Australian word", () => {
    const texts = (entry: Catalogue[string]) =>
      typeof entry === "string" ? [entry] : Object.values(entry);
    expect(
      Object.entries(enUS)
        .filter(([key, entry]) =>
          texts(entry).some(
            (text) => text === key || holdsAustralianWord(text),
          ),
        )
        .map(([key]) => key),
    ).toEqual([]);
  });

  // Mutation: add "No such message." to `LEFT_AS_WRITTEN`, or an entry in
  // `enUS` for "Tenure unresolved".
  it("keeps nothing both translated and left as written, or left although it holds no listed word", () => {
    expect(
      Object.keys(LEFT_AS_WRITTEN).filter(
        (key) =>
          !keys.has(key) ||
          !holdsAustralianWord(key) ||
          Object.prototype.hasOwnProperty.call(enUS, key),
      ),
    ).toEqual([]);
  });
});

describe("the literals the scan leaves out", () => {
  const held = new Set<string>();
  beforeAll(() => {
    const REPO = join(SRC, "../..");
    for (const pkg of ["shared", "frontend", "mobile", "api"])
      for (const path of sources(join(REPO, pkg, "src")))
        for (const found of bareCopyIn(ts, path, readFileSync(path, "utf8"), {
          keepData: true,
        }))
          held.add(
            `${relative(REPO, path).split("\\").join("/")}\0${found.text}`,
          );
  }, 60_000);

  // Mutation: add `"Open the file": "a test"` to the entries of
  // `shared/src/regions.ts` in `DATA_LITERALS`, or move an entry to a file that
  // does not hold it.
  it("lists only literals that exist, in the file that holds them", () => {
    expect(
      Object.entries(DATA_LITERALS).flatMap(([file, texts]) =>
        Object.keys(texts)
          .filter((literal) => !held.has(`${file}\0${literal}`))
          .map(
            (literal) =>
              `"${literal}" is in DATA_LITERALS (i18nSource.ts) under ${file}, which does not hold it: delete the entry or move it to its file (${I18N_ADR}).`,
          ),
      ),
    ).toEqual([]);
  });
});

describe("the files the scan leaves out", () => {
  // Mutation: rename `ozUltimate.ts`, or reword every string in `kit.ts` so
  // the scan finds none there.
  it("each still exists and still has something to leave out", () => {
    const stale = Object.keys(EXEMPT_FILES).filter((path) => {
      try {
        const file = join(SRC, "../..", path);
        return bareCopyIn(ts, file, readFileSync(file, "utf8")).length === 0;
      } catch {
        return true;
      }
    });
    expect(
      stale.map(
        (path) =>
          `${path} is in EXEMPT_FILES (i18nSource.ts) but is gone or has no text left to leave out: update the entry, or delete it (${I18N_ADR}).`,
      ),
    ).toEqual([]);
  });
});

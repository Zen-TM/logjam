import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PLACE_FORM } from "./contracts/placeForm.js";
import { placeSources } from "./contracts/placePage.js";
import { setFieldValues } from "./fieldValues.js";
import {
  cleanSources,
  deleteSourceLabel,
  isHttpUrl,
  sourceRows,
  sourcesPatch,
} from "./placeSources.js";
import { SOURCES_FIELD_KEY } from "./placeTypes.js";

describe("isHttpUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(isHttpUrl("https://example.com/route")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
  });

  // Mutation: accept any scheme `new URL` parses, and a stored `javascript:`
  // link becomes a clickable href.
  it("rejects javascript: and other dangerous schemes", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects unparseable or empty strings", () => {
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false);
  });
});

describe("a place page's source links", () => {
  // Mutation: set `linkable: true` in `placeSources`, or drop its `isHttpUrl`
  // call, and a stored `javascript:` source becomes a link both clients open.
  it("makes only http(s) sources linkable", () => {
    const rows = placeSources({
      [SOURCES_FIELD_KEY]: [
        ["x", "javascript:alert(1)"],
        ["d", "data:text/html,hi"],
        ["y", "https://a.example"],
      ],
    });
    expect(rows.map((row) => row.linkable)).toEqual([false, false, true]);
    expect(rows[2].host).toBe("a.example");
  });
});

describe("a place form's source rows", () => {
  it("reads the stored pairs, and nothing else, into rows", () => {
    const values = {
      [SOURCES_FIELD_KEY]: [
        ["RopeWiki", "https://ropewiki.com/x"],
        ["broken"],
        "junk",
        ["n", 3],
      ],
    };
    expect(sourceRows(values)).toEqual([
      { label: "RopeWiki", url: "https://ropewiki.com/x" },
    ]);
    expect(sourceRows({})).toEqual([]);
    expect(sourceRows(null)).toEqual([]);
    expect(sourceRows({ [SOURCES_FIELD_KEY]: "nope" })).toEqual([]);
  });

  it("trims labels and links, and drops a row with no label", () => {
    expect(
      cleanSources([
        { label: "  Guide ", url: " https://a.example/g " },
        { label: "   ", url: "https://dropped.example" },
        { label: "No link yet", url: "" },
      ]),
    ).toEqual({
      sources: [
        ["Guide", "https://a.example/g"],
        ["No link yet", ""],
      ],
    });
  });

  // Mutation: stop checking the link, and a `javascript:` source is stored
  // by the phone that Logjam Web would have refused.
  it("refuses a link that is not http(s), with the one sentence", () => {
    expect(cleanSources([{ label: "x", url: "javascript:alert(1)" }])).toEqual({
      error: PLACE_FORM.copy.sourceLinkInvalid,
      index: 0,
    });
    // Even on a row that has no label: the whole save is refused, and the
    // error names the first such row.
    expect(
      cleanSources([
        { label: "ok", url: "https://a.example" },
        { label: "", url: "ftp://x.example" },
        { label: "x", url: "javascript:1" },
      ]),
    ).toEqual({ error: PLACE_FORM.copy.sourceLinkInvalid, index: 1 });
  });

  // Mutation: return an empty list from `cleanSources` when nothing is left,
  // or make `setFieldValues` keep a null, and the key is stored, not removed.
  it("is null when nothing is left, so the key is removed", () => {
    expect(cleanSources([])).toEqual({ sources: null });
    const stored = { [SOURCES_FIELD_KEY]: [["a", "https://a.example"]] };
    const next = setFieldValues(stored, { [SOURCES_FIELD_KEY]: null });
    expect(SOURCES_FIELD_KEY in next).toBe(false);
  });

  // Mutation: have `sourcesPatch` always clean the rows (or drop the
  // unchanged check), and a name-only edit of a place whose stored sources hold
  // a scheme-less link or an unlabelled entry is refused or rewrites them.
  it("leaves sources a save did not touch alone, whatever they hold", () => {
    const stored = {
      [SOURCES_FIELD_KEY]: [
        ["RopeWiki", "ropewiki.com/x"],
        ["", "https://a.example"],
      ],
    };
    const seeded = sourceRows(stored);
    expect(sourcesPatch(seeded, seeded)).toEqual({ patch: {} });
    // Touched: the same rows now meet the rules.
    const touched = [...seeded, { label: "New", url: "" }];
    expect(sourcesPatch(touched, seeded)).toEqual({
      error: PLACE_FORM.copy.sourceLinkInvalid,
      index: 0,
    });
    const fixed = [{ label: "RopeWiki", url: "https://ropewiki.com/x" }];
    expect(sourcesPatch(fixed, seeded)).toEqual({
      patch: { [SOURCES_FIELD_KEY]: [["RopeWiki", "https://ropewiki.com/x"]] },
    });
    expect(sourcesPatch([], seeded)).toEqual({
      patch: { [SOURCES_FIELD_KEY]: null },
    });
    expect(sourcesPatch([], [])).toEqual({ patch: {} });
  });

  // Mutation: compare the rows with the place as it is at save time instead of
  // with the rows the form opened with, and a list a sync pulled in while the
  // form was open is overwritten by the stale one the form still shows.
  it("leaves a list pulled in while the form was open alone", () => {
    const opened = [{ label: "Old", url: "https://old.example" }];
    expect(sourcesPatch(opened, opened)).toEqual({ patch: {} });
  });

  it("round-trips: rows -> pairs -> rows", () => {
    const rows = [{ label: "A", url: "https://a.example" }];
    const cleaned = cleanSources(rows);
    if ("error" in cleaned) throw new Error("expected sources");
    expect(sourceRows({ [SOURCES_FIELD_KEY]: cleaned.sources })).toEqual(rows);
  });

  it("names a delete button by the label, else the row's number", () => {
    expect(deleteSourceLabel({ label: "Guide", url: "" }, 0)).toBe(
      "Delete the source Guide",
    );
    expect(deleteSourceLabel({ label: "", url: "" }, 1)).toBe(
      "Delete the source 2",
    );
  });
});

describe("both clients edit sources through the shared helpers", () => {
  const repo = join(import.meta.dirname, "..", "..");
  const clients = [
    ["Logjam Web", "frontend/src/components/dialogs/PlaceDialog.tsx"],
    ["Logjam GPS", "mobile/src/places/PlaceEditSheet.tsx"],
  ] as const;

  // Mutation: check the link with a rule typed into either client, or type
  // "Add a source" there, and the two stop agreeing on what a source takes.
  it.each(clients)(
    "%s reads, cleans and words them from here",
    (_name, file) => {
      const source = readFileSync(join(repo, file), "utf8");
      expect(source).toContain("sourceRows(");
      expect(source).toContain("sourcesPatch(sources, seeded?.sources ?? [])");
      expect(source).not.toContain("cleanSources(");
      expect(source).toContain("deleteSourceLabel(");
      for (const words of [
        PLACE_FORM.copy.addSource,
        PLACE_FORM.copy.sourceLinkInvalid,
        PLACE_FORM.copy.sourceLabel,
      ])
        expect(source, words).not.toContain(`"${words}"`);
      expect(source).not.toContain("isHttpUrl");
    },
  );

  // Mutation: compare a form with the place as it is at save time in either
  // client, and a field a sync pulled in while the form was open is
  // overwritten by the text the form opened with.
  it.each([
    ["Logjam Web", "frontend/src/components/dialogs/PlaceDialog.tsx"],
    ["Logjam GPS", "mobile/src/places/placeEditChanges.ts"],
  ] as const)(
    "%s sends only the attributes the user changed",
    (_name, file) => {
      expect(readFileSync(join(repo, file), "utf8")).toContain(
        "changedSince(seeded",
      );
    },
  );

  // Mutation: build a save from the form's sources alone and the key is
  // never merged, so an edit on the phone drops or ignores the list.
  it("merges the cleaned list under the reserved key on a save", () => {
    const sheet = readFileSync(join(repo, clients[1][1]), "utf8");
    // The create merges it; the edit hands it to `placeEditChanges`, which does.
    expect(sheet.match(/\.\.\.sourcesResult\.patch/g)).toHaveLength(1);
    expect(sheet.match(/sourcesPatch: sourcesResult\.patch/g)).toHaveLength(1);
    const edit = readFileSync(
      join(repo, "mobile/src/places/placeEditChanges.ts"),
      "utf8",
    );
    expect(edit).toContain("...args.sourcesPatch");
  });
});

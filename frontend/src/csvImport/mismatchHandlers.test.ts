import { describe, it, expect } from "vitest";
import {
  getHandlers,
  getDefaultHandlerId,
  DISCARD_COLUMN_ID,
  STORE_AS_ATTR_ID,
  LEAVE_BLANK_ID,
} from "./mismatchHandlers";

// Pure handler registry for CSV mismatch resolution. Drives the import dialog's
// "how should we fix this column?" choices — previously untested.

function apply(kind: Parameters<typeof getHandlers>[0], id: string, raw: string) {
  const handler = getHandlers(kind, false).find((h) => h.id === id);
  if (!handler) throw new Error(`no handler ${id} for ${kind}`);
  return handler.apply(raw);
}

describe("getHandlers", () => {
  it("returns kind-specific handlers followed by the universal ones", () => {
    const handlers = getHandlers("decimalInInt", false);
    const ids = handlers.map((h) => h.id);
    expect(ids.slice(0, 3)).toEqual(["round", "floor", "ceil"]);
    expect(ids).toContain(STORE_AS_ATTR_ID);
    expect(ids).toContain(DISCARD_COLUMN_ID);
    expect(ids).not.toContain(LEAVE_BLANK_ID); // not partial
  });

  it("adds leave-blank (ahead of the other universals) when the column is only partially bad", () => {
    const ids = getHandlers("decimalInInt", true).map((h) => h.id);
    expect(ids).toContain(LEAVE_BLANK_ID);
    // Specific handlers still lead; leave-blank heads the universal group.
    expect(ids.indexOf(LEAVE_BLANK_ID)).toBeLessThan(ids.indexOf(STORE_AS_ATTR_ID));
    expect(ids.indexOf(LEAVE_BLANK_ID)).toBeLessThan(ids.indexOf(DISCARD_COLUMN_ID));
  });

  it("offers only the universal handlers for the informational emptyDominant kind", () => {
    const ids = getHandlers("emptyDominant", false).map((h) => h.id);
    expect(ids).toEqual([STORE_AS_ATTR_ID, DISCARD_COLUMN_ID]);
  });
});

describe("getDefaultHandlerId", () => {
  it("is the first specific handler when one exists", () => {
    expect(getDefaultHandlerId("decimalInInt")).toBe("round");
    expect(getDefaultHandlerId("unparsableArray")).toBe("splitOnSemicolon");
  });

  it("falls back to leave-blank when the kind has no specific handlers", () => {
    expect(getDefaultHandlerId("emptyDominant")).toBe(LEAVE_BLANK_ID);
  });
});

describe("handler transforms", () => {
  it("rounds, floors, and ceils decimal-in-int values", () => {
    expect(apply("decimalInInt", "round", "3.6")).toBe(4);
    expect(apply("decimalInInt", "floor", "3.6")).toBe(3);
    expect(apply("decimalInInt", "ceil", "3.1")).toBe(4);
  });

  it("rescales scaleMismatch values", () => {
    expect(apply("scaleMismatch", "divideBy2Round", "9")).toBe(5);
    expect(apply("scaleMismatch", "divideBy10Round", "47")).toBe(5);
  });

  it("splits unparsable arrays on the chosen delimiter and drops empties", () => {
    expect(apply("unparsableArray", "splitOnSemicolon", "a; b ;;c")).toEqual(["a", "b", "c"]);
    expect(apply("unparsableArray", "splitOnPipe", "a|b||c")).toEqual(["a", "b", "c"]);
    expect(apply("unparsableArray", "treatAsRawString", "  solo  ")).toEqual(["solo"]);
  });

  it("maps boolean-ish strings to 1/0 and unknowns to null", () => {
    expect(apply("booleanish", "mapYesNoToOneZero", "Yes")).toBe(1);
    expect(apply("booleanish", "mapYesNoToOneZero", "n")).toBe(0);
    expect(apply("booleanish", "mapYesNoToOneZero", "maybe")).toBeNull();
    expect(apply("booleanish", "mapTrueFalseToOneZero", "TRUE")).toBe(1);
    expect(apply("booleanish", "mapTrueFalseToOneZero", "nope")).toBeNull();
  });

  it("parses coordinate formats (DMS and signed decimal)", () => {
    expect(apply("coordFormat", "parseSignedDecimal", "150.32° E")).toBeCloseTo(150.32, 5);
    // canyonValueParsers.parseDms expects ASCII '/" and single separators.
    const dms = apply("coordFormat", "parseDms", "33°33'3.82\"S");
    expect(typeof dms).toBe("number");
    expect(dms as number).toBeCloseTo(-33.55106, 4);
  });

  it("discard and store-as-attribute behave as documented", () => {
    expect(apply("nonNumeric", DISCARD_COLUMN_ID, "anything")).toBeNull();
    expect(apply("nonNumeric", STORE_AS_ATTR_ID, "keepme")).toBe("keepme");
  });
});

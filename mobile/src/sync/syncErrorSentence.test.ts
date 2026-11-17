import { describe, expect, it } from "vitest";
import { syncErrorSentence } from "./syncErrorSentence";

describe("syncErrorSentence", () => {
  it.each([
    ["storage_full", "Not enough storage space. Free some space and retry."],
    ["track_exists", "This place already has a track. Remove it first."],
    ["rejected", "The server rejected this upload."],
    [
      "file_missing",
      "This file is no longer on this phone. Discard this upload.",
    ],
    [
      "keeps_failing",
      "This upload keeps failing on this phone. Try again or discard it.",
    ],
  ])("writes the sentence for %s", (code, sentence) => {
    expect(syncErrorSentence(code)).toBe(sentence);
  });

  it("shows a stored value that is not a code as it is", () => {
    expect(syncErrorSentence("Some older sentence.")).toBe(
      "Some older sentence.",
    );
    expect(syncErrorSentence("")).toBe("");
  });
});

// The report. A bulk share is two legs that fail independently — 60 grants in
// one request, 8 uploads one at a time — and the sentence afterwards is the
// only thing telling the user what is actually in their friends' hands.
//
// Retry is NOT symmetric, which is why a partial run names the files: re-running
// the share half is free, re-running the copy half duplicates whatever already
// went, and there is no unsend.
import { describe, expect, it } from "vitest";

import { bulkShareButtonLabel, bulkShareOutcomeMessage } from "./bulkShareTargets";

const clean = {
  granted: 12,
  alreadyShared: 0,
  ineligible: 0,
  copiesSent: 0,
  copiesFailed: [] as string[],
  shareError: null,
};

describe("bulkShareOutcomeMessage", () => {
  it("reports both legs in one sentence", () => {
    expect(
      bulkShareOutcomeMessage({ ...clean, granted: 6, copiesSent: 2 }),
    ).toEqual({ text: "Shared 6 items and sent 2 copies.", tone: "info" });
  });

  it("says nothing about pairs that were already shared", () => {
    // A no-op the user did not ask about. The count exists so the SERVER can
    // skip the write, not so the sentence can explain it.
    const report = bulkShareOutcomeMessage({ ...clean, alreadyShared: 30 });
    expect(report.text).toBe("Shared 12 items.");
  });

  it("NAMES the files that did not go, and reads as an error", () => {
    const report = bulkShareOutcomeMessage({
      ...clean,
      granted: 6,
      copiesSent: 6,
      copiesFailed: ["Claustral.gpx", "Ranon.gpx"],
    });
    expect(report.tone).toBe("error");
    expect(report.text).toContain("Claustral.gpx, Ranon.gpx");
  });

  it("keeps what DID land when the grant leg fails after the uploads", () => {
    const report = bulkShareOutcomeMessage({
      ...clean,
      granted: 0,
      copiesSent: 3,
      shareError: "Couldn't share those items.",
    });
    expect(report.tone).toBe("error");
    // The three copies are gone for good — a message saying only "failed"
    // would have the user send them a second time.
    expect(report.text).toContain("Sent 3 copies");
    expect(report.text).toContain("Couldn't share those items.");
  });

  it("quotes the grant leg's own error when nothing at all landed", () => {
    expect(
      bulkShareOutcomeMessage({ ...clean, granted: 0, shareError: "You're offline." }),
    ).toEqual({ text: "You're offline.", tone: "error" });
  });

  it("counts a copy-only wipeout in files", () => {
    expect(
      bulkShareOutcomeMessage({
        ...clean,
        granted: 0,
        copiesFailed: ["a.gpx", "b.gpx"],
      }),
    ).toEqual({ text: "Couldn't send 2 files.", tone: "error" });
  });

  it("says copies, not copys", () => {
    expect(
      bulkShareOutcomeMessage({ ...clean, granted: 0, copiesSent: 1 }).text,
    ).toBe("Sent 1 copy.");
  });
});

describe("bulkShareButtonLabel", () => {
  const mixed = { shares: [1], copies: [1, 2] };
  const sharesOnly = { shares: [1], copies: [] as unknown[] };

  it("takes the irrevocable verb whenever one copy is in the run", () => {
    expect(bulkShareButtonLabel(mixed, 3, null)).toBe("Send with 3 friends");
    expect(bulkShareButtonLabel(sharesOnly, 3, null)).toBe("Share with 3 friends");
  });

  it("REPORTS THE QUEUE, so a two-minute upload is not a silent spinner", () => {
    expect(
      bulkShareButtonLabel(mixed, 3, {
        phase: "copies",
        done: 2,
        total: 8,
        filename: "Ranon.gpx",
      }),
    ).toBe("Sending 3 of 8 — Ranon.gpx");
  });

  it("names the grant leg too — it is not instant on a bad link", () => {
    expect(bulkShareButtonLabel(mixed, 3, { phase: "shares" })).toBe("Sharing…");
  });
});

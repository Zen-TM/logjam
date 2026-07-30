import { describe, expect, it } from "vitest";

import type { ParkedOp } from "../sync/syncIssues";
import { opCause, opTitle, previewValue } from "./syncIssueDisplay";

function parked(overrides: Partial<ParkedOp> = {}): ParkedOp {
  return {
    seq: 1,
    entity: "canyon",
    op: "update",
    entityId: "c1",
    state: "blocked",
    fields: null,
    error: null,
    attempts: 1,
    createdAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("previewValue", () => {
  it("never renders a coordinate", () => {
    // A parked canyon create carries lat/lng. This screen is the one most likely
    // to be screenshotted into a bug report (DESIGN.md §11).
    expect(previewValue("latitude", -33.7)).toBe("(hidden)");
    expect(previewValue("longitude", 150.3)).toBe("(hidden)");
  });

  it("renders the values it is allowed to", () => {
    expect(previewValue("name", "Butterbox")).toBe("Butterbox");
    expect(previewValue("hours", 6)).toBe("6");
    expect(previewValue("altNames", ["Butterbox North"])).toBe('["Butterbox North"]');
  });

  it("distinguishes empty from absent-looking values", () => {
    expect(previewValue("notes", null)).toBe("(empty)");
    expect(previewValue("notes", undefined)).toBe("(empty)");
    expect(previewValue("notes", "")).toBe("");
  });
});

describe("opTitle", () => {
  it("names the entity, the item and the verb", () => {
    expect(opTitle(parked({ fields: { name: "Claustral" } }))).toBe(
      "Canyon “Claustral” — edit",
    );
    expect(opTitle(parked({ entity: "tripLog", op: "delete", fields: null }))).toBe(
      "Trip — delete",
    );
  });

  it("falls back to the raw entity and op rather than rendering nothing", () => {
    const title = opTitle(
      parked({ entity: "somethingNew" as ParkedOp["entity"], op: "merge" as ParkedOp["op"] }),
    );
    expect(title).toBe("somethingNew — merge");
  });
});

describe("opCause", () => {
  it("explains a lost edit↔delete race in the user's terms", () => {
    expect(opCause(parked({ state: "deadRemote" }))).toMatch(/deleted elsewhere/);
  });

  it("shows the server's own domain message when there is one", () => {
    const cause = opCause(
      parked({ error: { code: 409, message: "This canyon already has a track." } }),
    );
    expect(cause).toBe("This canyon already has a track.");
  });

  it("has a sentence of its own when the server sent none", () => {
    expect(opCause(parked())).toBe("The server rejected this change.");
  });
});

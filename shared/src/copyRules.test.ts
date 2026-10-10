import { describe, expect, it } from "vitest";

import { ApiError, messageFromError } from "./apiErrors.js";
import * as contracts from "./contracts/index.js";
import { copySay, copyViolations } from "./copyRules.js";

// Every string a screen contract declares keeps the copy rules of
// shared/DESIGN.md §12: no "Retry", no "the app", no "basemap", "tiles" or "the
// server", no Title Case label. A hit is fixed; the clients' own scans
// (`copyRules.test.ts` in each) take an allow-list with a reason.
//
// Mutation that turns it red: set `tabBasemap` in `contracts/mapLayers.ts`
// back to "Basemap".

/** Keys that hold an identifier or a note for developers, not words a user reads. */
const NOT_COPY = new Set(["id", "key", "reason", "on", "question"]);

function strings(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value))
    value.forEach((item, index) => strings(item, `${path}[${index}]`, out));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value))
      if (!NOT_COPY.has(key)) strings(item, `${path}.${key}`, out);
}

/** Every string a contract's functions return for a count or a name. */
function fromFunctions(out: [string, string][]): void {
  for (const [name, value] of Object.entries(contracts)) {
    if (typeof value !== "function") continue;
    for (const arg of [0, 1, 3, "Ranon"]) {
      try {
        const result = (value as (a: unknown) => unknown)(arg);
        if (typeof result === "string") out.push([`${name}(${arg})`, result]);
      } catch {
        // Not a function of one count or one name.
      }
    }
  }
}

describe("contract copy", () => {
  const all: [string, string][] = [];
  for (const [name, value] of Object.entries(contracts)) {
    if (typeof value !== "function") strings(value, name, all);
  }
  fromFunctions(all);

  it("reads strings at all — a silent zero would pass forever", () => {
    expect(all.length).toBeGreaterThan(500);
  });

  it("recognises what it forbids", () => {
    expect(copyViolations("Retry")).toEqual(["retry"]);
    expect(copyViolations("Use the app")).toEqual(["the-app"]);
    expect(copyViolations("Mark All Read")).toEqual(["title-case"]);
    expect(copyViolations("Mark all as read")).toEqual([]);
    expect(copyViolations("Logjam GPS")).toEqual([]);
    expect(copyViolations("Finished GeoPDFs")).toEqual([]);
  });

  it("breaks no copy rule", () => {
    const offenders = all.flatMap(([path, text]) =>
      copyViolations(text).map((id) => `${path}: "${text}" — ${copySay(id)}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the words an API failure shows", () => {
  it("break no copy rule", () => {
    const messages = [400, 401, 403, 404, 409, 429, 500, 502, 503].map((s) =>
      messageFromError(new ApiError(s, "/x", "GET"), "Couldn't do that."),
    );
    messages.push(
      messageFromError(new TypeError("Failed to fetch"), "fallback"),
      messageFromError(new Error("Network Error"), "fallback"),
    );
    expect(messages.flatMap(copyViolations)).toEqual([]);
  });
});

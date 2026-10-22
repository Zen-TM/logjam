import type { TripPlanSummary } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { planPageView, plansListView } from "./planViews";

const list = [{ id: "a" }] as TripPlanSummary[];

describe("plansListView", () => {
  // Mutation: return `failed` whenever the poll failed. Offline and never
  // fetched would show an error with Try again.
  it("offline with nothing cached is a state, not an error", () => {
    expect(
      plansListView({
        plans: null,
        failure: "Couldn't load",
        settled: true,
        online: false,
      }),
    ).toEqual({ kind: "neverFetched" });
  });

  // Mutation: check `failure` before `plans`. An old error would stay over a
  // list a later poll loaded.
  it("a list read from the cache is drawn, whatever failed before", () => {
    expect(
      plansListView({
        plans: list,
        failure: "Couldn't load",
        settled: true,
        online: true,
      }),
    ).toEqual({ kind: "list", plans: list });
  });

  // Mutation: draw `list` for an empty cached list as neverFetched. Neither
  // an empty list nor an empty bucket is "open Plans with signal".
  it("an empty cached list is a list", () => {
    expect(
      plansListView({ plans: [], failure: null, settled: true, online: false }),
    ).toEqual({ kind: "list", plans: [] });
  });

  // Mutation: drop the `online` check. Try again can't help offline.
  it("fails with Try again only online", () => {
    expect(
      plansListView({
        plans: null,
        failure: "Couldn't load",
        settled: true,
        online: true,
      }),
    ).toEqual({ kind: "failed", message: "Couldn't load" });
    expect(
      plansListView({
        plans: null,
        failure: null,
        settled: false,
        online: false,
      }),
    ).toEqual({ kind: "loading" });
  });
});

describe("planPageView", () => {
  const base = {
    cached: null,
    gone: false,
    refreshing: false,
    failure: null,
    online: true,
  };

  // Mutation: drop the `gone` branch. A plan lost while open would read
  // "Not downloaded yet" with full signal.
  it("a plan the caller lost says so, even with a copy in hand", () => {
    expect(planPageView({ ...base, gone: true })).toEqual({ kind: "gone" });
    expect(planPageView({ ...base, cached: {}, gone: true })).toEqual({
      kind: "gone",
    });
  });

  it("draws the page from a copy, loading until the cache is read", () => {
    expect(planPageView({ ...base, cached: {} })).toEqual({ kind: "page" });
    expect(planPageView({ ...base, cached: undefined })).toEqual({
      kind: "loading",
    });
    expect(planPageView({ ...base, refreshing: true })).toEqual({
      kind: "loading",
    });
  });

  // Mutation: drop the `online` check. Offline and never opened would show
  // an error with Try again instead of "Not downloaded yet".
  it("never opened is not downloaded offline, and failed online", () => {
    expect(
      planPageView({ ...base, failure: "Couldn't load", online: false }),
    ).toEqual({ kind: "notDownloaded" });
    expect(planPageView({ ...base, failure: "Couldn't load" })).toEqual({
      kind: "failed",
      message: "Couldn't load",
    });
  });
});

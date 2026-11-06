import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  discardStagedMedia,
  queueStagedMedia,
  type StagedMedia,
} from "./stagedPlaceMedia";

vi.mock("expo-image-picker", () => ({}));

const photo = (name: string) => ({ uri: `file:///${name}`, fileName: name });

describe("queueStagedMedia", () => {
  it("queues every photo and the way against the new place", async () => {
    const attach = vi.fn().mockResolvedValue("id");
    const write = vi.fn().mockResolvedValue("done");
    const staged: StagedMedia = {
      files: [photo("a.jpg"), photo("b.jpg")],
      way: { label: "Creek", write },
    };

    const result = await queueStagedMedia("place-1", staged, attach);

    expect(result).toEqual({ failed: false });
    expect(attach.mock.calls.map(([file]) => file.fileName)).toEqual([
      "a.jpg",
      "b.jpg",
    ]);
    expect(write).toHaveBeenCalledExactlyOnceWith("place-1");
  });

  it("keeps going past a photo that fails and says so", async () => {
    const attach = vi
      .fn()
      .mockRejectedValueOnce(new Error("unreadable"))
      .mockResolvedValue("id");
    const write = vi.fn().mockResolvedValue("done");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await queueStagedMedia(
      "place-1",
      { files: [photo("a.jpg"), photo("b.jpg")], way: { label: "x", write } },
      attach,
    );

    expect(result).toEqual({ failed: true });
    expect(attach).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledOnce();
  });

  it("reports a way that fails without throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await queueStagedMedia(
      "place-1",
      {
        files: [],
        way: { label: "x", write: () => Promise.reject(new Error()) },
      },
      vi.fn(),
    );
    expect(result).toEqual({ failed: true });
  });
});

// CANCELLING THE FORM LEAVES NOTHING QUEUED. Picks are only held in state;
// the one call that turns them into outbox rows is `queueStagedMedia`, and it
// runs inside `save`, after `createPlaceLocal`. Mutation: call
// `attachMediaLocal` or `queueStagedMedia` from a pick handler, or before
// `createPlaceLocal`, and this goes red.
describe("PlaceEditSheet stages, never queues, on a pick", () => {
  const source = readFileSync(join(__dirname, "PlaceEditSheet.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("calls queueStagedMedia once, after the place is created", () => {
    const calls = source.match(/queueStagedMedia\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(source.indexOf("createPlaceLocal(")).toBeGreaterThan(-1);
    expect(source.indexOf("queueStagedMedia(")).toBeGreaterThan(
      source.indexOf("await createPlaceLocal("),
    );
  });

  it("writes nothing itself", () => {
    expect(source).not.toMatch(/updateRouteLocal|linkStandaloneMediaLocal/);
    expect(source.match(/attachMediaLocal\(/g) ?? []).toHaveLength(1);
  });
});

describe("discardStagedMedia", () => {
  // Mutation: drop the `way.discard` call and a file picked for a way stays in
  // the picker's cache after Cancel; drop the files loop and photos do.
  it("frees every photo's picked file and the way's", () => {
    const discardFile = vi.fn(async (_uri: string) => {});
    const discardWay = vi.fn(async () => {});

    discardStagedMedia(
      {
        files: [photo("a.jpg"), photo("b.jpg")],
        way: { label: "x", write: vi.fn(), discard: discardWay },
      },
      discardFile,
    );

    expect(discardFile.mock.calls.map(([uri]) => uri)).toEqual([
      "file:///a.jpg",
      "file:///b.jpg",
    ]);
    expect(discardWay).toHaveBeenCalledOnce();
  });

  it("copes with a way that holds nothing to free", () => {
    expect(() =>
      discardStagedMedia(
        { files: [], way: { label: "x", write: vi.fn() } },
        vi.fn(),
      ),
    ).not.toThrow();
  });
});

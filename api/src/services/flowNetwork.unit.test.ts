import { createReadStream, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  FLOW_NETWORK_SNAP_M,
  NSW_5M,
  type FlowNetworkLookup,
} from "@logjam/shared";

vi.mock("./awsClients", () => ({ s3: { send: vi.fn() } }));

import { s3 } from "./awsClients";
import { logger } from "../lib/logger";
import { FLOW_NETWORK_KEY } from "../lib/flowNetwork/objectKey";
import {
  forgetFlowNetwork,
  lookupFlowNetwork,
  lookupIn,
  openFlowNetwork,
} from "./flowNetwork";

// The lookup against the real build output for the Govetts Creek sub-basin of
// the Grose (topo/build_flow_network.py): 1,590 segments, one basin polygon.
// The points below were read out of that file.
const FIXTURE = join(__dirname, "../__tests__/__fixtures__/flow-network.gpkg");

/** ~11 m north of a vertex of the outlet segment (fid 103, order 6). */
const ON_GOVETTS: [number, number] = [150.35782562886266, -33.61343695594992];
/** Inside the basin and 577 m from the nearest creek line. */
const RIDGE: [number, number] = [150.362, -33.6245];
/** Sydney CBD: outside every basin in the fixture. */
const SYDNEY: [number, number] = [151.21, -33.87];

/** Layer files and half-written ones in the temp dir, anyone's. */
const layerFiles = () =>
  readdirSync(tmpdir()).filter((name) =>
    name.startsWith("logjam-flow-network-"),
  );

const send = vi.mocked(s3.send) as unknown as ReturnType<typeof vi.fn>;

describe("lookupIn, against the fixture", () => {
  const layer = openFlowNetwork(FIXTURE);
  afterAll(() => layer.db.close());

  it("snaps to the creek and reads the area between its ends", () => {
    const result = lookupIn(layer, ON_GOVETTS, false);
    expect(result.status).toBe("found");
    const found = result as Extract<FlowNetworkLookup, { status: "found" }>;
    // The outlet segment drains 70.3933 km² at its top, 70.425025 at its foot.
    expect(found.catchmentKm2).toBeGreaterThan(70.3933);
    expect(found.catchmentKm2).toBeLessThan(70.425025);
    expect(found.streamOrder).toBe(6);
    expect(found.distanceM).toBeGreaterThan(5);
    expect(found.distanceM).toBeLessThan(15);
    expect(found.upstream).toBeUndefined();
    expect(found.biggerNearby).toBeUndefined();
    expect(found.attribution).toBe(NSW_5M.credit);
  });

  // Mutation: return "not-covered" whenever no creek is in range (skip the
  // basin test) and the ridge reads as outside the layer.
  it("tells a ridge in the basin from a place outside it", () => {
    expect(lookupIn(layer, RIDGE, true)).toEqual({
      status: "no-creek",
      attribution: NSW_5M.credit,
    });
    expect(lookupIn(layer, SYDNEY, true)).toEqual({
      status: "not-covered",
      attribution: NSW_5M.credit,
    });
  });

  // Mutation: walk `flows_into` the wrong way (downstream) and the outlet's
  // upstream is one segment.
  it("returns everything upstream of the outlet, cut at the click", () => {
    const found = lookupIn(layer, ON_GOVETTS, true) as Extract<
      FlowNetworkLookup,
      { status: "found" }
    >;
    const { features } = found.upstream!.lines;
    // Every segment in the fixture that drains to the outlet.
    expect(features).toHaveLength(1546);
    expect(found.upstream!.trimmedBelowOrder).toBeUndefined();
    const [west, south, east, north] = found.upstream!.bbox;
    for (const { geometry } of features) {
      for (const [lon, lat] of geometry.coordinates) {
        expect(lon).toBeGreaterThanOrEqual(west);
        expect(lon).toBeLessThanOrEqual(east);
        expect(lat).toBeGreaterThanOrEqual(south);
        expect(lat).toBeLessThanOrEqual(north);
      }
    }
    // The snapped segment ends at the snapped point, with the snapped area.
    const head = features.find((f) => {
      const last = f.geometry.coordinates.at(-1)!;
      return (
        last[0] === found.snapped.longitude &&
        last[1] === found.snapped.latitude
      );
    });
    expect(head?.properties.catchmentKm2).toBe(found.catchmentKm2);
  });
});

describe("loading the layer from S3", () => {
  beforeEach(() => {
    forgetFlowNetwork();
    send.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    forgetFlowNetwork();
  });

  const fixtureObject = (etag: string) => ({
    Body: createReadStream(FIXTURE),
    ETag: etag,
  });

  it("downloads once, however many lookups arrive while it does", async () => {
    send.mockImplementation(async () => fixtureObject('"a"'));
    const results = await Promise.all([
      lookupFlowNetwork(ON_GOVETTS, false),
      lookupFlowNetwork(RIDGE, false),
      lookupFlowNetwork(SYDNEY, false),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      "found",
      "no-creek",
      "not-covered",
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]![0] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({
      Bucket: process.env.S3_BUCKET_TOPO,
      Key: FLOW_NETWORK_KEY,
    });
  });

  // Mutation: drop the failedAt check and every click in the five minutes
  // asks S3 again.
  it("is a 503 when missing, and is not asked for again for five minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const warn = vi.spyOn(logger, "warn");
    send.mockRejectedValue(
      Object.assign(new Error("The specified key does not exist."), {
        name: "NoSuchKey",
      }),
    );
    await expect(lookupFlowNetwork(ON_GOVETTS, false)).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(lookupFlowNetwork(ON_GOVETTS, false)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(send).toHaveBeenCalledTimes(1);
    // What was logged says the layer is missing, not where anyone looked.
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("unavailable");
    expect(logged).not.toContain("150.357");
    expect(logged).not.toContain("33.613");

    vi.setSystemTime(Date.now() + 5 * 60_000);
    send.mockImplementation(async () => fixtureObject('"a"'));
    expect((await lookupFlowNetwork(ON_GOVETTS, false)).status).toBe("found");
    expect(send).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  // Mutation: compare nothing on recheck (never swap) and the second lookup
  // after the rebuild still reads the old layer: the new GetObject never runs.
  it("checks for a rebuild at most every five minutes, and swaps it in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    send.mockImplementation(async () => fixtureObject('"a"'));
    await lookupFlowNetwork(ON_GOVETTS, false);
    await lookupFlowNetwork(ON_GOVETTS, false);
    expect(send).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 5 * 60_000);
    send.mockImplementation(async (command: unknown) =>
      command instanceof HeadObjectCommand
        ? { ETag: '"b"' }
        : fixtureObject('"b"'),
    );
    // Served from the old layer while the new one downloads.
    expect((await lookupFlowNetwork(ON_GOVETTS, false)).status).toBe("found");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[1]![0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[2]![0]).toBeInstanceOf(GetObjectCommand);
    // Let the swap and the old layer's close run.
    await new Promise((resolve) => setImmediate(resolve));
    expect((await lookupFlowNetwork(ON_GOVETTS, false)).status).toBe("found");
    expect(send).toHaveBeenCalledTimes(3);
  });

  // A download can outlast the five minutes between checks. Mutation: drop
  // both the single in-flight `refreshing` check and the `next !== layer`
  // check in refresh, and the second check retires the layer the first has
  // just swapped in: every lookup after is "database is not open".
  it("survives a second rebuild check while the first is still downloading", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    send.mockImplementation(async () => fixtureObject('"a"'));
    await lookupFlowNetwork(ON_GOVETTS, false);

    let finish!: () => void;
    const download = new Promise<void>((resolve) => (finish = resolve));
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) return { ETag: '"b"' };
      await download;
      return fixtureObject('"b"');
    });
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await lookupFlowNetwork(ON_GOVETTS, false);
    await vi.waitFor(() =>
      expect(send.mock.calls.at(-1)![0]).toBeInstanceOf(GetObjectCommand),
    );
    vi.setSystemTime(Date.now() + 5 * 60_000);
    expect((await lookupFlowNetwork(ON_GOVETTS, false)).status).toBe("found");

    finish();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    // Past the swap, the retire it schedules, and any second one.
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect((await lookupFlowNetwork(ON_GOVETTS, false)).status).toBe("found");
    expect((await lookupFlowNetwork(RIDGE, false)).status).toBe("no-creek");
  });

  // nodemon restarts the API on every save in dev. Mutation: name each copy
  // afresh (randomUUID) and the restart downloads a second file beside the
  // first, which nothing ever deletes.
  it("opens the copy a restart left behind instead of downloading another", async () => {
    // A running dev API may have its own copies in the same directory.
    const others = new Set(layerFiles());
    const ours = () => layerFiles().filter((name) => !others.has(name));
    send.mockImplementation(async () => fixtureObject('"a"'));
    await lookupFlowNetwork(ON_GOVETTS, false);
    const before = ours();
    expect(before).toHaveLength(1);

    forgetFlowNetwork({ keepFile: true });
    let read = false;
    const body = new Readable({
      read() {
        read = true;
        this.push(null);
      },
    });
    send.mockImplementation(async () => ({ Body: body, ETag: '"a"' }));
    expect((await lookupFlowNetwork(ON_GOVETTS, false)).status).toBe("found");
    expect(read).toBe(false);
    expect(body.destroyed).toBe(true);
    expect(ours()).toEqual(before);
  });

  it("keeps the layer when the rebuild check finds the same file", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    send.mockImplementation(async () => fixtureObject('"a"'));
    await lookupFlowNetwork(ON_GOVETTS, false);
    vi.setSystemTime(Date.now() + 5 * 60_000);
    send.mockImplementation(async () => ({ ETag: '"a"' }));
    await lookupFlowNetwork(ON_GOVETTS, false);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]![0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("keeps the ridge point out of snapping range", () => {
    // The ridge point is only a no-creek test while it is out of range.
    expect(FLOW_NETWORK_SNAP_M).toBeLessThan(577);
  });
});

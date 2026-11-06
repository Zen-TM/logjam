import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MapArtifact } from "../map/sourceResolver";
import { settleUpdate } from "./artifactGroups";
import type { RegionJob } from "./regionDownloadQueue";

// The real queue, with the disk and the registry faked: an update is stopped
// at every step of a file's life, and at every step each map must still be
// on disk, old or new. Stop is answered from a screen drawn before the step,
// as the confirm dialog is.

const disk = vi.hoisted(() => ({
  files: new Set<string>(),
  registry: [] as unknown[],
  swapGate: null as Promise<void> | null,
}));
const runner = vi.hoisted(() => ({
  release: new Map<string, () => void>(),
  started: [] as string[],
}));

vi.mock("react-native", () => ({
  AppState: {
    addEventListener: () => ({ remove: () => {} }),
    currentState: "active",
  },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => () => {} },
}));
vi.mock(
  "../../modules/logjam-download-service/src/LogjamDownloadServiceModule",
  () => ({ default: { show: vi.fn(), stop: vi.fn(), addListener: vi.fn() } }),
);
vi.mock("./networkPolicy", () => ({ connectionWorthResuming: () => false }));
vi.mock("./registryDb", () => ({ renameArtifactGroup: vi.fn() }));
vi.mock("./regionMbtiles", () => ({
  deleteRegionFile: async (id: string) => void disk.files.delete(id),
}));
vi.mock("./regionDownloads", () => {
  const deleteDownloadedArtifact = async (id: string) => {
    disk.registry = (disk.registry as MapArtifact[]).filter((a) => a.id !== id);
    disk.files.delete(id);
  };
  return {
    deleteClipFile: async (id: string) => void disk.files.delete(id),
    deleteDownloadedArtifact,
    swapSuperseded: async (fresh: MapArtifact, failed: number) => {
      await disk.swapGate;
      const { accepted, drop } = settleUpdate(
        fresh,
        failed,
        disk.registry as MapArtifact[],
      );
      for (const old of drop) await deleteDownloadedArtifact(old.id);
      return accepted;
    },
  };
});
// A download that finishes when the test says so, and registers its file the
// way the runner does before it returns.
vi.mock("./regionTileDownload", () => ({
  connectionAllows: () => Promise.resolve(true),
  runRegionDownload: (
    spec: { id: string; basemapId: string; groupId: string },
    _report: unknown,
    token: { stop: string | null },
  ) =>
    new Promise((resolve) => {
      runner.started.push(spec.id);
      runner.release.set(spec.id, () => {
        if (token.stop === "cancel") return resolve({ status: "cancelled" });
        const artifact = saved(spec.id, spec.basemapId);
        disk.files.add(spec.id);
        disk.registry = [...(disk.registry as MapArtifact[]), artifact];
        resolve({ status: "ready", artifact, gaps: 0, failed: 0 });
      });
    }),
}));

const saved = (id: string, logicalKey: string): MapArtifact => ({
  id,
  kind: "basemap-region",
  logicalKey,
  format: "mbtiles",
  sourceType: "raster",
  path: `/x/${id}`,
  bbox: [150.2, -33.7, 150.3, -33.6],
  minzoom: 4,
  maxzoom: 15,
  sizeBytes: 1,
  downloadedAt: "2026-10-03T00:00:00.000Z",
  groupId: "card",
  groupLabel: "Card",
});

const { cancelAllRegionDownloads, enqueueRegionDownloads, stopRegionGroup } =
  await import("./regionDownloadQueue");

const MAPS = ["six-topo", "six-imagery", "six-vector"] as const;
const spec = (basemapId: string) => ({
  taskKind: "tile-pyramid" as const,
  id: `new-${basemapId}`,
  basemapId: basemapId as never,
  label: basemapId,
  update: true as const,
  groupId: "card",
  groupLabel: "Card",
  bbox: { west: 150.2, south: -33.7, east: 150.3, north: -33.6 },
  zMax: 15,
  allowCellular: false,
});

// What the screen drew when its confirm opened: every job still in flight.
const drawn = (): { groupId: string; update: boolean; jobs: RegionJob[] } => ({
  groupId: "card",
  update: true,
  jobs: MAPS.map((m) => ({
    spec: spec(m),
    state: { kind: "downloading" as const },
    progress: {} as never,
  })),
});

const settle = () => vi.advanceTimersByTimeAsync(0);

/** Every map is on disk, as the old file or the new one. */
function expectEveryMapOnDisk() {
  for (const key of MAPS) {
    const files = (disk.registry as MapArtifact[]).filter(
      (a) => a.logicalKey === key && disk.files.has(a.id),
    );
    expect(files, key).toHaveLength(1);
  }
  for (const a of disk.registry as MapArtifact[]) {
    expect(disk.files.has(a.id), `${a.id} is registered but gone`).toBe(true);
  }
}

beforeEach(async () => {
  vi.useFakeTimers();
  await cancelAllRegionDownloads();
  runner.release.clear();
  runner.started.length = 0;
  disk.swapGate = null;
  disk.files = new Set();
  disk.registry = MAPS.map((m) => saved(`old-${m}`, m));
  for (const a of disk.registry as MapArtifact[]) disk.files.add(a.id);
  enqueueRegionDownloads(MAPS.map(spec));
  await settle();
});

describe("an update that is stopped at every step of its run", () => {
  // Mutation: let Stop cancel a job answered from a stale screen, or delete on
  // a flagged token, and the new file goes with the old one already swapped.
  it("while its first file is downloading", async () => {
    stopRegionGroup(drawn());
    runner.release.get("new-six-topo")?.();
    await settle();
    expectEveryMapOnDisk();
    expect((disk.registry as MapArtifact[]).map((a) => a.id)).toEqual(
      MAPS.map((m) => `old-${m}`),
    );
  });

  // Mutation: delete the token before the swap, and this Stop deletes the
  // file the swap is about to make the only copy.
  it("after the file is registered and before it is swapped in", async () => {
    let open!: () => void;
    disk.swapGate = new Promise((resolve) => (open = resolve));
    runner.release.get("new-six-topo")?.();
    await settle();
    stopRegionGroup(drawn());
    await settle();
    open();
    await settle();
    expectEveryMapOnDisk();
    expect(disk.files.has("new-six-topo")).toBe(true);
    expect(disk.files.has("old-six-topo")).toBe(false);
  });

  // Mutation: filter jobs by the screen's states instead of the queue's.
  it("after the first file is saved, from a screen drawn before it was", async () => {
    runner.release.get("new-six-topo")?.();
    await settle();
    stopRegionGroup(drawn());
    runner.release.get("new-six-imagery")?.();
    await settle();
    expectEveryMapOnDisk();
    expect(disk.files.has("new-six-topo")).toBe(true);
    expect(disk.files.has("new-six-imagery")).toBe(false);
    expect(disk.files.has("old-six-imagery")).toBe(true);
    expect(disk.files.has("old-six-vector")).toBe(true);
  });

  it("with every file saved but one", async () => {
    for (const m of ["six-topo", "six-imagery"]) {
      runner.release.get(`new-${m}`)?.();
      await settle();
    }
    stopRegionGroup(drawn());
    runner.release.get("new-six-vector")?.();
    await settle();
    expectEveryMapOnDisk();
    expect(disk.files.has("new-six-topo")).toBe(true);
    expect(disk.files.has("new-six-imagery")).toBe(true);
    expect(disk.files.has("old-six-vector")).toBe(true);
  });
});

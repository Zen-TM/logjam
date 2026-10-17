import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { createCanvas } from "canvas";
import {
  GEOPDF_BASE_LAYER_CONFIG,
  extentFromCentreAndSize,
  getMapDimensions,
  getPaperDimensions,
  type ExtentState,
  type GeoPdfConfig,
} from "@logjam/shared";
// Deliberate subpath imports: geoPdfImport is kept OUT of the shared barrel so
// pdf-lib never rides into the web frontend bundle.
import {
  parseGeoPdfGeoref,
  chooseMainViewport,
} from "@logjam/shared/dist/geoPdfImport/parseGeoref.js";
import { buildGeoTransform } from "@logjam/shared/dist/geoPdfImport/transform.js";
import { API_URL, ALICE_ID } from "./_actors";
import prisma from "../services/prisma";
import { processGeoPdfJob } from "../worker/geoPdfWorker";
import { sendEmail } from "../services/email";
import { sendPushToUser } from "../services/push";

// Requires `make dev` or the api-integration job: Postgres, MiniStack S3, the
// API on :8080 (AUTH_MODE=fake, no ECS_SUBNETS in CI so POST /geo-pdf leaves
// the job queued) and the topo bucket. No auth header = alice.
//
// A real job end to end: POST /geo-pdf exactly as Logjam Web sends it, the
// worker (api/src/worker/geoPdfWorker.ts, the entry the ECS task and `make
// geo-pdf-run` use) run in this process, the PDF read back through the
// presigned URL the job view hands out, then through the import parser Logjam
// GPS uses.
//
// What is stubbed, and why: the base layer is fetched over HTTP from a public
// tile server (the topo bucket holds overlay archives only), so tile requests
// are answered here with a flat PNG and any other host is refused: the suite
// needs no internet, and a request the worker should not make fails the test.
// The email and push sends are mocked so a developer's real Resend key or a
// seeded device token can never be reached from here.
vi.mock("../services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("../services/push", () => ({ sendPushToUser: vi.fn() }));

const AUTH = { Authorization: "Bearer fake-token" } as const;
const MM_TO_PT = 72 / 25.4;

// Katoomba's town centre (a published place); A5 landscape at 1:25,000, the
// extent Logjam Web computes for that paper and scale around a centre.
const PAPER: ExtentState = {
  paperSize: "A5",
  orientation: "landscape",
  north: 0,
  south: 0,
  east: 0,
  west: 0,
  scale: 25000,
  coordMode: "latlon",
  lockMode: "scale",
  pivot: "mc",
};
const map = getMapDimensions(PAPER);
const EXTENT = extentFromCentreAndSize(
  -33.7126,
  150.3119,
  (map.w / 1000) * PAPER.scale,
  (map.h / 1000) * PAPER.scale,
);

const BASE_LAYER = "osm";
const CONFIG: GeoPdfConfig = {
  paperSize: PAPER.paperSize,
  orientation: PAPER.orientation,
  extent: EXTENT,
  scale: PAPER.scale,
  baseLayer: BASE_LAYER,
  overlays: [],
  elements: {
    title: "Render e2e",
    compass: true,
    scaleText: true,
    scaleBar: true,
  },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer base-layer tile requests with a flat PNG; refuse every other host. */
function stubTileServer(): string[] {
  const tileHost = new URL(
    GEOPDF_BASE_LAYER_CONFIG[BASE_LAYER].urlTemplate.replace(/\{[zxy]\}/g, "0"),
  ).host;
  const tile = createCanvas(256, 256);
  const ctx = tile.getContext("2d");
  ctx.fillStyle = "#9bc48a";
  ctx.fillRect(0, 0, 256, 256);
  const png = tile.toBuffer("image/png");
  const asked: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL
        ? input
        : (input as Request).url,
    );
    if (url.host === tileHost) {
      asked.push(url.host);
      return new Response(new Uint8Array(png), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    // The S3 and API calls of this test go to localhost; nothing else may.
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`unexpected request to ${url.host}`);
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return asked;
}

describe("GeoPDF render, API request to PDF (fake auth = alice)", () => {
  it("renders a requested extent into a georeferenced PDF on the requested page", async () => {
    const tileRequests = stubTileServer();

    const created = await request(API_URL)
      .post("/geo-pdf")
      .set(AUTH)
      .send(CONFIG);
    expect(created.status).toBe(202);
    const jobId: string = created.body.id;

    try {
      // Locally MiniStack may already have launched the worker container; the
      // claim is atomic, so whichever runs second exits 0 and this waits.
      expect(await processGeoPdfJob(jobId)).toBe(0);
      let view = created.body;
      for (let i = 0; i < 120 && view.status !== "completed"; i++) {
        if (view.status === "failed") break;
        await new Promise((r) => setTimeout(r, 1000));
        view = (await request(API_URL).get(`/geo-pdf/${jobId}`).set(AUTH)).body;
      }
      expect(view.status).toBe("completed");
      expect(view.errorMessage).toBeNull();
      expect(view.resultBytes).toBeGreaterThan(0);
      expect(view.downloadUrl).toBeTruthy();

      // The job's own notification, as Logjam Web and GPS list it.
      const notifications = await request(API_URL)
        .get("/notifications")
        .set(AUTH);
      expect(
        notifications.body.some(
          (n: { type: string; payload: { geoPdfJobId?: string } }) =>
            n.type === "geo_pdf_complete" && n.payload.geoPdfJobId === jobId,
        ),
      ).toBe(true);
      expect(sendPushToUser).toHaveBeenCalledWith(ALICE_ID, {
        type: "geo_pdf_complete",
        geoPdfJobId: jobId,
      });
      expect(sendEmail).toHaveBeenCalled();

      // The PDF is in S3: fetch it the way a user's download does.
      const download = await realFetch(view.downloadUrl);
      expect(download.status).toBe(200);
      const pdf = new Uint8Array(await download.arrayBuffer());
      expect(pdf.length).toBe(view.resultBytes);
      expect(tileRequests.length).toBeGreaterThan(0);

      // Parsed back by the import parser: the requested extent and page.
      const parsed = await parseGeoPdfGeoref(pdf);
      expect(parsed.producer).toBe("Logjam GeoPDF Generator");
      const page = parsed.pages[0];
      const paper = getPaperDimensions(PAPER);
      expect(Math.abs(page.pageWidthPt - paper.w * MM_TO_PT)).toBeLessThan(1);
      expect(Math.abs(page.pageHeightPt - paper.h * MM_TO_PT)).toBeLessThan(1);

      const transform = buildGeoTransform(
        page.viewports[chooseMainViewport(page)],
      );
      // 1e-6 degrees is about 0.1 m; the writer is exact to 1e-9 (the unit
      // round trip), so this only has to survive the real render path.
      const bounds = transform.wgs84Bounds;
      expect(Math.abs(bounds.north - EXTENT.north)).toBeLessThan(1e-6);
      expect(Math.abs(bounds.south - EXTENT.south)).toBeLessThan(1e-6);
      expect(Math.abs(bounds.east - EXTENT.east)).toBeLessThan(1e-6);
      expect(Math.abs(bounds.west - EXTENT.west)).toBeLessThan(1e-6);
    } finally {
      // The route's own delete: removes the row and the PDF and gives back the
      // storage the worker charged, which the seed baseline would otherwise
      // have to write back. The notification row is left to the sweep.
      await request(API_URL).delete(`/geo-pdf/${jobId}`).set(AUTH);
    }
    expect(await prisma.geoPdfJob.count({ where: { id: jobId } })).toBe(0);
  }, 150_000);
});

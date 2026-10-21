import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import {
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
import { AUTH, realFetch, renderGeoPdf, stubTileServer } from "./_geoPdfRun";
import prisma from "../services/prisma";
import { sendEmail } from "../services/email";
import { sendPushToUser } from "../services/push";

// Requires `make dev` or the api-integration job: Postgres, MiniStack S3, the
// API on :8080 (AUTH_MODE=fake; CI sets no ECS_SUBNETS so POST /geo-pdf leaves
// the job queued, while `make dev` sets a dummy one and launches a container)
// and the topo bucket. No auth header = alice.
//
// A real job end to end: POST /geo-pdf exactly as Logjam Web sends it, the
// worker (api/src/worker/geoPdfWorker.ts, the entry the ECS task and `make
// geo-pdf-run` use) run in this process, the PDF read back through the
// presigned URL the job view hands out, then through the import parser Logjam
// GPS uses.
//
// What is stubbed, and why: the base layer is fetched over HTTP from a public
// tile server (the renderer fetches raster XYZ tiles only; the protomaps
// archive in the topo bucket is vector, for Logjam GPS), so
// tile requests are answered here with a flat PNG and any other host is
// refused: the suite needs no internet, and a request the worker should not
// make fails the test. The email and push sends are mocked in THIS process;
// a worker container that wins the claim under `make dev` sends for real, so
// the send and tile assertions run only when this process rendered.
vi.mock("../services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("../services/push", () => ({ sendPushToUser: vi.fn() }));

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

const BASE_LAYER = "six-topo";
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

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("GeoPDF render, API request to PDF (fake auth = alice)", () => {
  it("renders a requested extent into a georeferenced PDF on the requested page", async () => {
    const tileRequests = stubTileServer(BASE_LAYER);

    const { jobId, view, pdf, launched } = await renderGeoPdf(
      CONFIG,
      async (r) => {
        expect(r.view.errorMessage).toBeNull();
        expect(r.pdf.length).toBe(r.view.resultBytes);
        // The job's own notification, as Logjam Web and GPS list it.
        const notifications = await request(API_URL)
          .get("/notifications")
          .set(AUTH);
        expect(
          notifications.body.some(
            (n: { type: string; payload: { geoPdfJobId?: string } }) =>
              n.type === "geo_pdf_complete" &&
              n.payload.geoPdfJobId === r.jobId,
          ),
        ).toBe(true);
        if (!r.launched) {
          expect(sendPushToUser).toHaveBeenCalledWith(ALICE_ID, {
            type: "geo_pdf_complete",
            geoPdfJobId: r.jobId,
          });
          expect(sendEmail).toHaveBeenCalled();
        }
      },
    );
    expect(view.resultBytes).toBeGreaterThan(0);
    if (!launched) expect(tileRequests.length).toBeGreaterThan(0);

    // Parsed back by the import parser: the requested extent and page.
    // Mutation that turns it red: stop the worker writing the extent (or
    // point the tile stub at another host): the parsed page bounds then
    // differ.
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
    // renderGeoPdf deleted the job through the API.
    expect(await prisma.geoPdfJob.count({ where: { id: jobId } })).toBe(0);
  }, 150_000);
});

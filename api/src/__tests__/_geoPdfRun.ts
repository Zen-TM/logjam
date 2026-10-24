// Shared by the GeoPDF render tests: make a job through the API as alice, run
// the worker on it in this process, hand back the PDF. The test file must
// vi.mock("../services/email") and ("../services/push") itself: vi.mock is per
// file, and it keeps a real Resend send or a device token out of reach.
import request from "supertest";
import { createCanvas, loadImage, type Canvas } from "canvas";
import { GEOPDF_BASE_LAYER_CONFIG, type GeoPdfConfig } from "@logjam/shared";
import { API_URL } from "./_actors";
import prisma from "../services/prisma";
import { processGeoPdfJob } from "../worker/geoPdfWorker";

export const AUTH = { Authorization: "Bearer fake-token" } as const;
export const realFetch = globalThis.fetch;
export const TILE_GREEN = [0x9b, 0xc4, 0x8a] as const;

/**
 * The base layer is fetched over HTTP from a public tile server (the topo
 * bucket holds overlay archives only). Answer that host with a flat green PNG
 * and refuse every other non-localhost host, so the suite needs no internet
 * and a request the worker should not make fails the test. Call
 * `globalThis.fetch = realFetch` afterwards.
 */
export function stubTileServer(baseLayer: string): string[] {
  const tileHost = new URL(
    GEOPDF_BASE_LAYER_CONFIG[baseLayer].urlTemplate.replace(/\{[zxy]\}/g, "0"),
  ).host;
  const tile = createCanvas(256, 256);
  const ctx = tile.getContext("2d");
  ctx.fillStyle = `rgb(${TILE_GREEN.join(",")})`;
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
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`unexpected request to ${url.host}`);
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return asked;
}

export interface RenderedGeoPdf {
  jobId: string;
  view: Record<string, unknown> & { resultBytes: number };
  pdf: Uint8Array;
  /** A worker container was launched, so it may have rendered, not this process. */
  launched: boolean;
}

/**
 * POST the config, run the worker, wait for the job, download the PDF, then
 * delete the job through the API (row, object and storage charge go together)
 * and return what was read.
 */
export async function renderGeoPdf(
  config: GeoPdfConfig,
  inspect?: (r: RenderedGeoPdf) => Promise<void>,
): Promise<RenderedGeoPdf> {
  const created = await request(API_URL)
    .post("/geo-pdf")
    .set(AUTH)
    .send(config);
  if (created.status !== 202) {
    throw new Error(`POST /geo-pdf answered ${created.status}`);
  }
  const jobId: string = created.body.id;
  // Under `make dev` the POST launched a worker container, which may claim the
  // job first; then this process renders nothing.
  const launched = !!(
    await prisma.geoPdfJob.findUnique({ where: { id: jobId } })
  )?.ecsTaskArn;
  try {
    if (!launched) await processGeoPdfJob(jobId);
    let view = created.body;
    for (let i = 0; i < 120 && view.status !== "completed"; i++) {
      if (view.status === "failed") break;
      await new Promise((r) => setTimeout(r, 1000));
      view = (await request(API_URL).get(`/geo-pdf/${jobId}`).set(AUTH)).body;
    }
    if (view.status !== "completed") {
      throw new Error(`the job ended ${view.status}: ${view.errorMessage}`);
    }
    const download = await realFetch(view.downloadUrl);
    const pdf = new Uint8Array(await download.arrayBuffer());
    const rendered = { jobId, view, pdf, launched };
    await inspect?.(rendered);
    return rendered;
  } finally {
    await request(API_URL).delete(`/geo-pdf/${jobId}`).set(AUTH);
  }
}

/** The page's map image: the JPEG pdfkit embeds, found by its filter. */
export async function mapImage(pdf: Uint8Array): Promise<Canvas> {
  const bytes = Buffer.from(pdf);
  const filter = bytes.indexOf("/DCTDecode");
  const start = bytes.indexOf("stream", filter) + "stream".length;
  const from = bytes.indexOf(Buffer.from([0xff, 0xd8]), start);
  const to = bytes.indexOf("endstream", from);
  const img = await loadImage(bytes.subarray(from, to));
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas;
}

/** Mean colour of a block, centred at a fraction of the image. */
export function colourAt(canvas: Canvas, fx: number, fy: number) {
  const { data } = canvas
    .getContext("2d")
    .getImageData(fx * canvas.width - 5, fy * canvas.height - 5, 10, 10);
  const mean = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) mean[c] += data[i + c] / (data.length / 4);
  }
  return mean;
}

import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/flowNetwork", () => ({
  lookupFlowNetwork: vi.fn(async () => ({
    status: "no-creek",
    attribution: "",
  })),
}));

import { lookupFlowNetwork } from "../services/flowNetwork";
import { requireAuth } from "../middleware/auth";
import { errorHandler } from "../middleware/errorHandler";
import { flowNetworkLimiter } from "../middleware/rateLimit";
import flowNetwork from "./flowNetwork";

function app(log: { warn: unknown; error: unknown }) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = log;
    next();
  });
  server.use("/flow-network", flowNetwork);
  server.use(errorHandler);
  return server;
}

// Values no validator lets through, written so each is easy to find again in
// a response or a log line.
const BAD_BODIES = [
  { longitude: 1234.5678, latitude: -33.6135 },
  { longitude: 150.3578, latitude: -98.7654 },
  { longitude: "150.3578", latitude: -33.6135 },
  { longitude: 150.3578, latitude: -33.6135, upstream: "yes" },
];

describe("POST /flow-network/lookup", () => {
  afterEach(() => vi.mocked(lookupFlowNetwork).mockClear());

  // A refusal's detail is logged and sent back. Mutation: put the value in a
  // malformed() detail (`longitude ${longitude} is out of range`) and this
  // goes red.
  it.each(BAD_BODIES)(
    "refuses %j without repeating the point",
    async (body) => {
      const log = { warn: vi.fn(), error: vi.fn() };
      const res = await request(app(log))
        .post("/flow-network/lookup")
        .send(body);
      expect(res.status).toBe(400);
      expect(lookupFlowNetwork).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledOnce();
      const said =
        JSON.stringify(res.body) + JSON.stringify(log.warn.mock.calls);
      for (const value of ["1234.5678", "98.7654", "150.3578", "33.6135"]) {
        expect(said).not.toContain(value);
      }
    },
  );

  it("passes a good point on, and upstream only when asked", async () => {
    const log = { warn: vi.fn(), error: vi.fn() };
    await request(app(log))
      .post("/flow-network/lookup")
      .send({ longitude: 150.3578, latitude: -33.6135 })
      .expect(200);
    await request(app(log))
      .post("/flow-network/lookup")
      .send({ longitude: 150.3578, latitude: -33.6135, upstream: true })
      .expect(200);
    expect(vi.mocked(lookupFlowNetwork).mock.calls).toEqual([
      [[150.3578, -33.6135], false],
      [[150.3578, -33.6135], true],
    ]);
  });

  // The integration suite runs on fake auth, which signs every request in, so
  // the 401 is shown here with fake auth off. Mutation: drop requireAuth from
  // the route.
  it("refuses a request that is not signed in", async () => {
    const mode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "cognito";
    try {
      const log = { warn: vi.fn(), error: vi.fn() };
      const res = await request(app(log))
        .post("/flow-network/lookup")
        .send({ longitude: 150.3578, latitude: -33.6135 });
      expect(res.status).toBe(401);
      expect(lookupFlowNetwork).not.toHaveBeenCalled();
    } finally {
      process.env.AUTH_MODE = mode;
    }
  });

  // Mutation: drop flowNetworkLimiter from the route, or put it before
  // requireAuth, where it buckets by IP.
  it("is rate limited per user", () => {
    const layer = (
      flowNetwork as unknown as {
        stack: { route?: { path: string; stack: { handle: unknown }[] } }[];
      }
    ).stack.find((l) => l.route?.path === "/lookup")!;
    const chain = layer.route!.stack.map((h) => h.handle);
    expect(chain.indexOf(flowNetworkLimiter)).toBe(
      chain.indexOf(requireAuth) + 1,
    );
  });
});

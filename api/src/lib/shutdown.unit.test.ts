import express from "express";
import http, { type Server } from "http";
import net, { type AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { createShutdown } from "./shutdown";

// A real http server on an ephemeral port: the behaviour under test is how
// Node's keep-alive connections end, which a mocked server cannot show.
// Mutations, each seen red:
//  - drop `res.set("Connection", "close")` in createShutdown: the keep-alive
//    and "carries Connection: close" tests fail.
//  - drop the `closeIdleConnections` sweep: "in flight when shutdown begins"
//    fails (its connection idles until the keep-alive timeout).
//  - drop `clearTimeout(force)` after `finish`: "a clean shutdown is not
//    reported again as a forced one" fails (exit is called a second time).
//  - drop `opts.stop()`: "forces an exit" and "exits 1 when finish rejects"
//    fail (stop was never called).
//  - drop the deadline's timer or its `opts.exit(1)`: "forces an exit" fails
//    (nothing exits while the request hangs).
//  - drop the `opts.exit(1)` after a failed `finish`: "exits 1 when finish
//    rejects" fails.

const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
let server: Server;

afterEach(() => {
  agent.destroy();
  server?.closeAllConnections();
});

function setup(
  route?: express.RequestHandler,
  before?: express.RequestHandler,
) {
  let finished: () => void;
  const done = new Promise<void>((r) => (finished = r));
  const lifecycle = createShutdown({
    timeoutMs: 20_000,
    stop: () => {},
    finish: async () => finished(),
    exit: () => {},
  });
  const app = express();
  if (before) app.use(before);
  app.use(lifecycle.closeConnections);
  app.get("/ping", route ?? ((_req, res) => void res.json({ ok: true })));
  server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const get = () =>
    new Promise<{ status: number; connection?: string; body: string }>(
      (resolve, reject) => {
        http
          .get({ port, path: "/ping", agent }, (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () =>
              resolve({
                status: res.statusCode!,
                connection: res.headers.connection,
                body,
              }),
            );
          })
          .on("error", reject);
      },
    );
  return { lifecycle, done, get };
}

const within = (ms: number, p: Promise<unknown>) =>
  Promise.race([
    p.then(() => "done"),
    new Promise((r) => setTimeout(() => r("timeout"), ms)),
  ]);

describe("graceful shutdown", () => {
  it("a clean shutdown is not reported again as a forced one", async () => {
    const exits: number[] = [];
    const lifecycle = createShutdown({
      timeoutMs: 150,
      stop: () => {},
      finish: async () => {},
      exit: (code) => void exits.push(code),
    });
    server = express().listen(0);
    lifecycle.begin(server, "SIGTERM");
    await new Promise((r) => setTimeout(r, 400)); // well past the deadline
    expect(exits).toEqual([0]);
  });

  it("forces an exit when a request outlasts the deadline", async () => {
    const exits: number[] = [];
    let stops = 0;
    const lifecycle = createShutdown({
      timeoutMs: 100,
      stop: () => void stops++,
      finish: async () => {},
      exit: (code) => void exits.push(code),
    });
    // A request whose handler never answers, so the server never closes.
    let entered = () => {};
    const held = new Promise<void>((r) => {
      entered = r;
    });
    server = express()
      .get("/hang", () => entered())
      .listen(0);
    const socket = net.connect((server.address() as AddressInfo).port, () =>
      socket.write("GET /hang HTTP/1.1\r\nHost: x\r\n\r\n"),
    );
    socket.on("error", () => {});
    await held;
    lifecycle.begin(server, "test");
    await new Promise((r) => setTimeout(r, 400)); // well past the deadline
    socket.destroy();
    expect(exits).toEqual([1]);
    expect(stops).toBe(1);
  });

  it("exits 1 when finish rejects", async () => {
    const exits: number[] = [];
    let stops = 0;
    const lifecycle = createShutdown({
      timeoutMs: 20_000,
      stop: () => void stops++,
      finish: async () => {
        throw new Error("disconnect failed");
      },
      exit: (code) => void exits.push(code),
    });
    server = express().listen(0);
    lifecycle.begin(server, "test");
    await new Promise((r) => setTimeout(r, 200));
    expect(exits).toEqual([1]);
    expect(stops).toBe(1);
  });

  it("completes quickly while keep-alive clients keep sending", async () => {
    // A handler that takes a moment keeps requests in flight on every
    // connection when shutdown begins, as a loaded API would have.
    const { lifecycle, done } = setup((_req, res) => {
      setTimeout(() => res.json({ ok: true }), 10);
    });
    const port = (server.address() as AddressInfo).port;
    const req = "GET /ping HTTP/1.1\r\nHost: x\r\n\r\n";
    // Pipelining clients: a new request is written before the last answer
    // finishes, so no connection is ever idle for the server to drop.
    const sockets = Array.from({ length: 4 }, () => {
      const socket = net.connect(port, () => socket.write(req + req));
      socket.on("data", () => socket.write(req));
      socket.on("error", () => {});
      return socket;
    });
    await new Promise((r) => setTimeout(r, 200));
    const start = Date.now();
    lifecycle.begin(server, "test");
    expect(await within(2000, done)).toBe("done");
    expect(Date.now() - start).toBeLessThan(2000);
    sockets.forEach((s) => s.destroy());
  });

  it("marks a response sent after shutdown began Connection: close", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const held = new Promise<void>((r) => (entered = r));
    // The request reaches the app before shutdown but is held ahead of the
    // middleware, so its response is produced after shutdown began.
    const { lifecycle, done, get } = setup(
      undefined,
      async (_req, _res, next) => {
        entered();
        await gate;
        next();
      },
    );
    const pending = get();
    await held;
    lifecycle.begin(server, "test");
    release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.connection).toBe("close");
    expect(await within(2000, done)).toBe("done");
  });

  it("answers a request in flight when shutdown begins, then completes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inHandler = new Promise<void>((r) => (entered = r));
    const { lifecycle, done, get } = setup(async (_req, res) => {
      entered();
      await gate;
      res.json({ ok: true });
    });
    const pending = get();
    await inHandler;
    lifecycle.begin(server, "test");
    expect(await within(300, done)).toBe("timeout"); // still waiting on it
    release();
    const res = await pending;
    expect(res).toMatchObject({ status: 200, body: '{"ok":true}' });
    const start = Date.now();
    expect(await within(2000, done)).toBe("done");
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

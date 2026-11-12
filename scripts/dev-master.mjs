#!/usr/bin/env node
// Serves master/* to a dev client: what's in MiniStack's topo bucket wins,
// everything else comes from the prod CDN, so one new file can be tried on the
// real basemap. Setup: README.md, Local Development.
import http from "node:http";
import https from "node:https";

const LOCAL = "http://127.0.0.1:4566/logjam-topo-local";
const CDN = "https://logjamnsw.com";
const PORT = 4567;

http
  .createServer((req, res) => {
    const ask = (base, onMissing) => {
      const url = new URL(base + req.url);
      const request = url.protocol === "https:" ? https.request : http.request;
      const headers = { "user-agent": "logjam-dev-master" }; // no UA: CDN 403
      if (req.headers.range) headers.range = req.headers.range;
      const upstream = request(
        url,
        { method: req.method, headers },
        (found) => {
          if (found.statusCode === 404 && onMissing) {
            found.resume();
            onMissing();
            return;
          }
          // Closed: on a reused connection through `adb reverse`, the phone's
          // PMTiles reader got a garbled status line.
          res.writeHead(found.statusCode, {
            ...found.headers,
            connection: "close",
          });
          found.pipe(res);
        },
      );
      upstream.on("error", () => res.destroy());
      upstream.end();
    };
    ask(LOCAL, () => ask(CDN));
  })
  .listen(PORT, "127.0.0.1");

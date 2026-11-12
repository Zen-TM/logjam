// Stands in for Expo's push service in CI (EXPO_PUSH_URL): answers every
// POST with one OK ticket per message, so no run reaches Expo.
import { createServer } from "node:http";

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let n = 0;
    try {
      n = JSON.parse(body).length;
    } catch {}
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: Array.from({ length: n }, () => ({ status: "ok" })),
      }),
    );
  });
}).listen(9099);

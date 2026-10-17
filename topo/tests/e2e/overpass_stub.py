"""Answers every Overpass query with one committed response, for CI's topo-e2e
job: `python3 overpass_stub.py <response.json> [port]`.

The response is real OpenStreetMap data (© OpenStreetMap contributors, ODbL)
for the sample ELVIS tile, fetched once with pipeline.py's own query.
"""

import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BODY = open(sys.argv[1], "rb").read()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(BODY)))
        self.end_headers()
        self.wfile.write(BODY)


ThreadingHTTPServer(
    ("", int(sys.argv[2]) if len(sys.argv) > 2 else 8000), Handler
).serve_forever()

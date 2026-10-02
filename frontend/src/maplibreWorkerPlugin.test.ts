// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { maplibreWorkerPlugin } from "../vite.config";

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

function fixture(shared: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maplibre-"));
  fs.writeFileSync(
    path.join(dir, FILES[0]),
    'import"./maplibre-gl-shared.mjs"',
  );
  fs.writeFileSync(path.join(dir, FILES[1]), shared);
  return dir;
}

function build(distDir?: string) {
  const plugin = maplibreWorkerPlugin(distDir) as unknown as {
    configResolved(c: { base: string; command: string }): void;
    load(id: string): string;
    generateBundle(this: { emitFile(f: { fileName: string }): void }): void;
  };
  plugin.configResolved({ base: "/", command: "build" });
  const emitted: string[] = [];
  plugin.generateBundle.call({ emitFile: (f) => emitted.push(f.fileName) });
  const url = plugin.load("\0virtual:maplibre-worker-url");
  return { emitted, url };
}

// Guards the cache-busting of maplibre's worker pair: deploy-frontend.yml
// serves assets `immutable`. Mutations that turn it red: emitting the shared
// chunk under a fixed name (assets/maplibre-gl-shared.mjs); hashing only the
// worker, so a shared-chunk change keeps the directory; pointing the URL
// somewhere other than the emitted worker.
describe("maplibreWorkerPlugin", () => {
  it("emits worker and shared chunk together under a content-hashed directory", () => {
    const { emitted } = build();
    expect(emitted).toHaveLength(2);
    for (const file of emitted) {
      expect(file).toMatch(
        /^assets\/maplibre-[0-9a-f]{10}\/maplibre-gl-(worker|shared)\.mjs$/,
      );
    }
    expect(new Set(emitted.map((f) => path.dirname(f))).size).toBe(1);
  });

  it("points the worker URL at the emitted worker", () => {
    const { emitted, url } = build();
    expect(url).toBe(
      `export default ${JSON.stringify(`/${emitted.find((f) => f.endsWith("worker.mjs"))}`)};`,
    );
  });

  it("changes the directory when only the shared chunk changes", () => {
    const a = build(fixture("export const a = 1;"));
    const b = build(fixture("export const a = 2;"));
    expect(path.dirname(a.emitted[0])).not.toBe(path.dirname(b.emitted[0]));
  });
});

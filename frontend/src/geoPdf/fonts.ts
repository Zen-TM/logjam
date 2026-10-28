// Source Sans 3 (SIL OFL, fonts/OFL.txt), two static weights in one family so
// the `bold ...` font strings of the drawing code pick SemiBold, as on the
// server. Vite hashes the files; they live next to this module and never in
// public/, which deploy-frontend.yml serves immutable under a fixed name.
import { MAP_FONT } from "./draw/common";

const REGULAR = new URL("./fonts/SourceSans3-Regular.ttf", import.meta.url)
  .href;
const SEMIBOLD = new URL("./fonts/SourceSans3-SemiBold.ttf", import.meta.url)
  .href;

let loaded: Promise<void> | null = null;

/** Registers the map font in this worker (once); rejects if a file will not load. */
export function loadMapFonts(signal: AbortSignal): Promise<void> {
  loaded ??= (async () => {
    const family = MAP_FONT.replace(/"/g, "");
    const load = async (url: string, weight: string) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error("font did not load");
      const face = new FontFace(family, await res.arrayBuffer(), { weight });
      await face.load();
      return face;
    };
    const faces = await Promise.all([
      load(REGULAR, "normal"),
      load(SEMIBOLD, "bold"),
    ]);
    const set = (self as unknown as { fonts: FontFaceSet }).fonts;
    for (const face of faces) set.add(face);
  })();
  // A failed or aborted load is tried again by the next render.
  loaded.catch(() => {
    loaded = null;
  });
  return loaded;
}

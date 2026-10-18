// Every file in __fixtures__/vector-corpus goes through parseVectorImport and
// its result (or the error a user would read) is compared with the neighbouring
// `.golden` file. `refuse-*` files are ones the importer should turn away with
// a plain sentence. Geometry is made up in every file: no recorded track and
// no user's file is committed. Where a file's dialect comes from:
//
// - garmin-instinct-strava.gpx: layout of a Strava export of a Garmin Instinct
//   recording (root attributes, gpxtpx cadence); geometry made up.
// - gaia-gps.{gpx,kml,geojson}: layout of a Gaia GPS export of one public hike
//   in the three formats; names, colour and geometry made up.
// - google-earth-desktop.kml: layout of a route drawn in Google Earth (desktop):
//   CascadingStyle, StyleMap, LookAt; geometry made up.
// - google-earth-gx-track.kml: Google's gx:Track sample, copied from
//   https://developers.google.com/kml/documentation/kmlreference (Google, CC BY
//   4.0 with the page's code samples under Apache 2.0). google-earth-gx-track-with-pin.kml is
//   that sample plus a Point placemark added here.
// - google-earth-gx-multitrack.kml: made up, to the kmlreference's gx:MultiTrack
//   layout (one timed leg, one untimed).
// - osmand.gpx, gpx10-legacy.gpx, gpx-routes-only.gpx, google-earth-multigeometry.kml:
//   hand-written to the format spec / the producer's documented tags, with no
//   reference export to check against.
// - CalTopo and Avenza have no fixture: no reference export of either was
//   available, so a hand-written one would only guess at their dialect.
//
// A parser change that alters any of these shows up as a diff in the golden.
// Mutation that turns it red: drop the rte loop in parseGpx; gpx-routes-only.gpx.golden
// becomes the no-features error.
// After an intended change: `npx vitest run src/vectorImport.corpus.test.ts -u`
// and read the golden diff.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseVectorImport } from "./vectorImport";

const dir = join(__dirname, "__fixtures__", "vector-corpus");
const inputs = readdirSync(dir).filter((f) =>
  /\.(gpx|kml|tcx|geojson|json)$/i.test(f),
);

function outcome(file: string): unknown {
  try {
    return parseVectorImport(file, readFileSync(join(dir, file), "utf8"));
  } catch (err) {
    return { error: (err as Error).message };
  }
}

describe("vector import corpus", () => {
  it("has inputs", () => {
    expect(inputs.length).toBeGreaterThan(10);
  });

  it.each(inputs)("%s", async (file) => {
    await expect(
      JSON.stringify(outcome(file), null, 2) + "\n",
    ).toMatchFileSnapshot(join(dir, `${file}.golden`));
  });
});

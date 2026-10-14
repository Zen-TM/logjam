import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  FLOW_NETWORK_SNAP_M,
  FLOW_NETWORK_UPSTREAM_CAP,
  NSW_5M,
} from "@logjam/shared";

import { s3 } from "../services/awsClients";
import { FLOW_NETWORK_KEY } from "../lib/flowNetwork/objectKey";
import { ALICE_SUB, API_URL, as } from "./_actors";

// POST /flow-network/lookup, end to end against the running API.
//
// Requires `make dev`. The API reads the flow network layer from the topo
// bucket, which locally is MiniStack, so this file puts the fixture there
// first: the real build output for the Govetts Creek sub-basin of the Grose
// (1,590 segments). The points were read out of that file.
//
// The API remembers for five minutes that the layer would not load. If a
// lookup was made on this stack before the fixture was first uploaded, this
// file fails until that passes or the API restarts.
//
// No unauthenticated-401 case: fake auth treats a missing header as alice.
// routes/flowNetwork.unit.test.ts shows the 401 with fake auth off.

/** ~11 m north of a vertex of the outlet segment (order 6). */
const ON_GOVETTS = {
  longitude: 150.35782562886266,
  latitude: -33.61343695594992,
};
/** Inside the basin and 577 m from the nearest creek line. */
const RIDGE = { longitude: 150.362, latitude: -33.6245 };
/** Sydney CBD: outside every basin in the fixture. */
const SYDNEY = { longitude: 151.21, latitude: -33.87 };

beforeAll(async () => {
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_TOPO,
      Key: FLOW_NETWORK_KEY,
      Body: readFileSync(join(__dirname, "__fixtures__/flow-network.gpkg")),
    }),
  );
});

function lookup(body: unknown) {
  return request(API_URL)
    .post("/flow-network/lookup")
    .set(as(ALICE_SUB))
    .send(body as object);
}

describe("POST /flow-network/lookup", () => {
  it("snaps to the creek and reads the area there", async () => {
    const res = await lookup(ON_GOVETTS);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("found");
    // The outlet segment drains 70.3933 km² at its top, 70.425025 at its foot.
    expect(res.body.catchmentKm2).toBeGreaterThan(70.3933);
    expect(res.body.catchmentKm2).toBeLessThan(70.425025);
    expect(res.body.streamOrder).toBe(6);
    expect(res.body.distanceM).toBeGreaterThan(5);
    expect(res.body.distanceM).toBeLessThan(15);
    expect(
      Math.abs(res.body.snapped.longitude - ON_GOVETTS.longitude),
    ).toBeLessThan(0.0002);
    expect(
      Math.abs(res.body.snapped.latitude - ON_GOVETTS.latitude),
    ).toBeLessThan(0.0002);
    expect(res.body.upstream).toBeUndefined();
    expect(res.body.attribution).toBe(NSW_5M.credit);
  });

  it("says when no creek is near, and when the layer does not reach", async () => {
    expect(FLOW_NETWORK_SNAP_M).toBeLessThan(577);
    const ridge = await lookup(RIDGE);
    expect(ridge.status).toBe(200);
    expect(ridge.body).toEqual({
      status: "no-creek",
      attribution: NSW_5M.credit,
    });
    const sydney = await lookup(SYDNEY);
    expect(sydney.status).toBe(200);
    expect(sydney.body).toEqual({
      status: "not-covered",
      attribution: NSW_5M.credit,
    });
  });

  it("returns every creek upstream when asked", async () => {
    const res = await lookup({ ...ON_GOVETTS, upstream: true });
    expect(res.status).toBe(200);
    const { lines, bbox, trimmedBelowOrder } = res.body.upstream;
    // Not an exact count: the API checks S3 for a new layer only every five
    // minutes, so on a dev stack it may still be serving a bigger build that
    // takes in Govetts Creek. services/flowNetwork.unit.test.ts counts the
    // fixture's 1,546 exactly.
    expect(lines.type).toBe("FeatureCollection");
    expect(lines.features.length).toBeGreaterThan(1000);
    expect(lines.features.length).toBeLessThanOrEqual(
      FLOW_NETWORK_UPSTREAM_CAP,
    );
    const [west, south, east, north] = bbox;
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
    for (const feature of lines.features) {
      expect(feature.geometry.type).toBe("LineString");
      expect(feature.properties.streamOrder).toBeGreaterThanOrEqual(
        trimmedBelowOrder ?? 1,
      );
      expect(feature.properties.catchmentKm2).toBeGreaterThan(0);
      for (const [lon, lat] of feature.geometry.coordinates) {
        expect(lon).toBeGreaterThanOrEqual(west);
        expect(lon).toBeLessThanOrEqual(east);
        expect(lat).toBeGreaterThanOrEqual(south);
        expect(lat).toBeLessThanOrEqual(north);
      }
    }
  });

  it("refuses a body that is not a point", async () => {
    for (const body of [
      {},
      { longitude: 150.36 },
      { longitude: 181, latitude: -33.6 },
      { longitude: 150.36, latitude: -91 },
      { longitude: "150.36", latitude: -33.6 },
      { ...ON_GOVETTS, upstream: "yes" },
    ]) {
      const res = await lookup(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain("150.36");
    }
  });
});

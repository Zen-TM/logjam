import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  ELEVATION_PROFILE_MAX_SAMPLES,
  ELEVATION_TRACK_MAX_SAMPLES,
  NSW_5M,
} from "@logjam/shared";

import { s3 } from "../services/awsClients";
import { ALICE_SUB, API_URL, as } from "./_actors";

// POST /elevation/profile, end to end against the running API.
//
// Requires `make dev`. The API reads the NSW DEM archive from
// TOPO_CDN_BASE_URL, which locally is the topo bucket in MiniStack, so this
// file puts a three-tile fixture archive there first. Nothing here leaves the
// machine: the line stays inside those tiles, so the worldwide source (public
// tiles on the internet) is never asked.
//
// The API remembers for five minutes that an archive would not open. If a
// profile was requested on this stack before the fixture was first uploaded,
// this file fails until that passes or the API restarts.

const FIXTURES = join(__dirname, "../../../shared/src/__fixtures__");

/** Inside the fixture archive from end to end. */
const LINE: [number, number][] = [
  [150.3105, -33.7005],
  [150.3187, -33.7052],
];

beforeAll(async () => {
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_TOPO,
      Key: NSW_5M.archivePath,
      Body: readFileSync(join(FIXTURES, "nsw-5m-z15-katoomba.pmtiles")),
    }),
  );
});

describe("POST /elevation/profile", () => {
  it("reads a line from the NSW archive and credits it", async () => {
    const res = await request(API_URL)
      .post("/elevation/profile")
      .set(as(ALICE_SUB))
      .send({ points: LINE });
    expect(res.status).toBe(200);
    expect(res.body.demSourceIds).toEqual([NSW_5M.id]);
    expect(res.body.attribution).toBe(NSW_5M.credit);
    expect(res.body.samples.length).toBeGreaterThan(2);
    // The ends are in shared/src/__fixtures__/dem-parity-nsw.json: 983.42 m
    // and 999.54 m, worked out by an independent decoder.
    expect(res.body.samples[0].elevationM).toBeCloseTo(983.42, 1);
    expect(res.body.samples.at(-1).elevationM).toBeCloseTo(999.54, 1);
  });

  // 60 legs of the fixture line: about 54 km without leaving its tiles.
  const LONG = Array.from({ length: 61 }, (_, i) => LINE[i % 2]!);

  it("samples a long line at the default ceiling unless a track asks for more", async () => {
    const plain = await request(API_URL)
      .post("/elevation/profile")
      .set(as(ALICE_SUB))
      .send({ segments: [LONG] });
    expect(plain.status).toBe(200);
    expect(plain.body.samples).toHaveLength(ELEVATION_PROFILE_MAX_SAMPLES);

    const track = await request(API_URL)
      .post("/elevation/profile")
      .set(as(ALICE_SUB))
      .send({ segments: [LONG], maxSamples: ELEVATION_TRACK_MAX_SAMPLES });
    expect(track.status).toBe(200);
    expect(track.body.samples).toHaveLength(ELEVATION_TRACK_MAX_SAMPLES);
  });

  // Mutation: pass `maxSamples` straight through and one request can make the
  // API read as many positions as the caller cares to name.
  it("clamps a ceiling above a track's, and ignores one that is not a count", async () => {
    const greedy = await request(API_URL)
      .post("/elevation/profile")
      .set(as(ALICE_SUB))
      .send({ segments: [LONG], maxSamples: 1_000_000 });
    expect(greedy.body.samples).toHaveLength(ELEVATION_TRACK_MAX_SAMPLES);

    const nonsense = await request(API_URL)
      .post("/elevation/profile")
      .set(as(ALICE_SUB))
      .send({ segments: [LONG], maxSamples: "all" });
    expect(nonsense.status).toBe(200);
    expect(nonsense.body.samples).toHaveLength(ELEVATION_PROFILE_MAX_SAMPLES);
  });

  it("refuses a body with no line", async () => {
    const res = await request(API_URL)
      .post("/elevation/profile")
      .set(as(ALICE_SUB))
      .send({ points: [] });
    expect(res.status).toBe(400);
  });
});

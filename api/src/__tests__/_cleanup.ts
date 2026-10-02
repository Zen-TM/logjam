// Per-file hook (vitest setupFiles): leave the database as the seed left it.
// See _seedBaseline.ts for why this sweeps instead of tracking.
import { afterAll, inject } from "vitest";
import {
  describeDrift,
  extraRows,
  restoreSeeded,
  seededDrift,
  sweepToBaseline,
  takeSnapshot,
} from "./_seedBaseline";

afterAll(async () => {
  const base = inject("seedBaseline");
  await sweepToBaseline(base);
  const touched = seededDrift(base, await takeSnapshot());
  if (touched.length) {
    console.warn(
      `Restored ${touched.length} seeded row(s) this file changed; prefer rows the test creates:\n${describeDrift(touched)}`,
    );
    await restoreSeeded(base, touched);
  }
  const now = await takeSnapshot();
  const left = [...seededDrift(base, now), ...extraRows(base, now)];
  if (left.length) {
    throw new Error(
      "The database differs from the seed after this file's cleanup. Usually " +
        "something the test started was still writing after the sweep (a " +
        "worker or async job: await it), or a seeded row changed in a way " +
        "the writeback can't restore. How the sweep works and what it " +
        `skips: src/__tests__/_seedBaseline.ts.\n${describeDrift(left)}`,
    );
  }
}, 60_000);

import prisma from "../services/prisma";

/**
 * Resolves once some database backend is blocked on a row lock, which is the
 * moment a request fired while a test holds a row has reached its wait. Polls
 * rather than sleeps: a fixed pause is too short on a loaded runner, and the
 * outcome of the race the test stages then depends on who got the lock first.
 * Fails after 10 s with a message naming what it waited for.
 */
export async function waitForLockWaiter(): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (waiting > 0n) return;
    if (Date.now() > deadline)
      throw new Error(
        "No request reached the row lock within 10 s: the request under test finished without waiting for it, or never started.",
      );
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

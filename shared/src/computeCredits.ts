/**
 * The one cost model for every Fargate worker Logjam runs.
 *
 * Three workers with wildly different sizes (8 / 4 / 1 vCPU) were previously
 * limited by three unrelated rules — a monthly TILE quota on topo generation
 * and nothing but a concurrency cap on the other two. Tiles are not a cost
 * unit: they only exist for one of the three workers, and they say nothing
 * about how long a task actually ran. This module replaces all of that with a
 * single unit that every worker can be measured in.
 *
 * CREDIT = one vCPU-minute of worker time.
 *
 * That is close to directly proportional to the Fargate bill (memory is
 * provisioned at a fixed ratio per task def, so vCPU alone tracks cost within a
 * few percent) and it is a number a person can hold in their head — a monthly
 * allowance lands in the low thousands rather than the low millions.
 */

/**
 * Per-worker Fargate sizing. These MUST match the `cpu` / `memory` on the task
 * definitions in infra/terraform/envs/prod/ecs.tf — that is a hand-kept
 * parallel list, so `computeCredits.terraform.test.ts` parses the Terraform and
 * fails if the two ever drift. Change one, change the other.
 */
export const WORKER_SPECS = {
  /** logjam-topo-worker — LiDAR topo generation. The expensive one. */
  topo: { vcpus: 8, memoryGiB: 16, label: "Topo generation" },
  /** logjam-topo-export-worker — on-demand export rendering. */
  topoExport: { vcpus: 4, memoryGiB: 8, label: "Topo export" },
  /** logjam-geo-pdf-worker — GeoPDF render. */
  geoPdf: { vcpus: 1, memoryGiB: 4, label: "GeoPDF" },
} as const;

export type WorkerKind = keyof typeof WORKER_SPECS;

export const WORKER_KINDS = Object.keys(WORKER_SPECS) as WorkerKind[];

/**
 * Default monthly allowance, in credits (vCPU-minutes).
 *
 * 1200 = 20 vCPU-hours ≈ USD $1/month of Fargate at ap-southeast-2 on-demand
 * rates. Sized to be invisible to a real user — a heavy trip-planning month
 * that generates a full topo run plus a dozen exports and PDFs lands well
 * under it — while capping a runaway loop at roughly a dollar before it stops.
 * Per-user overridable via User.monthlyComputeCredits.
 */
export const DEFAULT_MONTHLY_COMPUTE_CREDITS = 1200;

/**
 * Default monthly egress allowance, in bytes.
 *
 * 50 GiB. An order of magnitude above what syncing a season of trip photos to
 * a phone costs, and ~USD $5.70 of S3 internet egress at the cap — so a user
 * who somehow reaches it has cost real money but not a surprising amount. The
 * point is the ceiling existing at all, not the exact figure.
 */
export const DEFAULT_MONTHLY_EGRESS_BYTES = 50n * 1024n * 1024n * 1024n;

/** Fraction of an allowance at which the user gets a heads-up notification. */
export const QUOTA_WARNING_FRACTION = 0.8;

/**
 * Credits consumed by `seconds` of wall time on `kind`.
 *
 * Rounded UP so a run can never be free: a flood of sub-minute GeoPDF jobs
 * still draws down the allowance, which is precisely the abuse shape a
 * per-job-count limit would miss.
 */
export function creditsForRun(kind: WorkerKind, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil((WORKER_SPECS[kind].vcpus * seconds) / 60);
}

/**
 * Credits a run is expected to cost, from the API's adaptive runtime estimate.
 *
 * Returns null when the estimator has no opinion (too few completed jobs to fit
 * a rate, or no size signal for this submission). Callers must treat null as
 * "unknown", never as "free" — the UI shows the allowance without a projection
 * and the server still charges the real elapsed time afterwards.
 */
export function estimateCredits(
  kind: WorkerKind,
  estimatedSeconds: number | null | undefined,
): number | null {
  if (estimatedSeconds === null || estimatedSeconds === undefined) return null;
  if (!Number.isFinite(estimatedSeconds) || estimatedSeconds <= 0) return null;
  return creditsForRun(kind, estimatedSeconds);
}

export type QuotaState = {
  used: number;
  quota: number;
  /** Never negative — a quota lowered below current usage reads as 0 left. */
  remaining: number;
  /** 0..1, clamped. 1 means at or over the allowance. */
  fraction: number;
  exhausted: boolean;
  warning: boolean;
};

/** Shared shape for rendering any of the three meters consistently. */
export function quotaState(used: number, quota: number): QuotaState {
  const safeQuota = quota > 0 ? quota : 0;
  const remaining = Math.max(0, safeQuota - used);
  const fraction = safeQuota === 0 ? 1 : Math.min(1, used / safeQuota);
  return {
    used,
    quota: safeQuota,
    remaining,
    fraction,
    exhausted: used >= safeQuota,
    warning: fraction >= QUOTA_WARNING_FRACTION,
  };
}

/**
 * Human-readable credit count. Credits are vCPU-minutes, so past an hour or so
 * the raw number stops meaning anything to a person — show hours instead.
 */
export function formatCredits(credits: number): string {
  const rounded = Math.max(0, Math.round(credits));
  if (rounded < 90) return `${rounded} credit${rounded === 1 ? "" : "s"}`;
  const hours = rounded / 60;
  return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} credit-hours`;
}

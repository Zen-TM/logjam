// What a push received while Logjam GPS is open asks of the plans cache,
// decided without React Native, so it can be unit-tested (as `tapTarget.ts`).
import { capabilityStatus, type AccountState } from "../auth/capabilities";

/**
 * A `plan_*` push re-polls the list and refetches the plan it names, if any;
 * anything else, or a guest (who has no plans), asks for nothing. Whether the
 * connection allows it is the caller's `canRunNow("sync")`.
 */
export function planPushRefresh(
  data: unknown,
  accountState: AccountState,
): { planId: string | null } | null {
  // Online is the caller's check, so only the account decides here.
  if (capabilityStatus("plans", accountState, true).status !== "available")
    return null;
  const { type, planId } = (data ?? {}) as { type?: unknown; planId?: unknown };
  if (typeof type !== "string" || !type.startsWith("plan_")) return null;
  return { planId: typeof planId === "string" ? planId : null };
}

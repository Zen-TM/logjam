// Expo push notifications — mirrors the Resend email pattern (services/
// email.ts): best-effort fan-out at Notification-creation sites; the
// in-app Notification row stays the source of truth. No SDK — the Expo push
// API is one HTTPS POST.
//
// PRIVACY (hard rule, root CLAUDE.md + mobile plan Stage 3): push payloads
// transit Apple/Google/Expo servers in plaintext. NEVER put canyon names,
// coordinates, usernames, or any free text in a push. The payload is a
// generic per-type title, the notification type, and opaque IDs only — the
// app fetches details over the authed API on tap. buildPushMessages is the
// single choke-point and takes NO free-text parameters by construction;
// its unit tests assert the title map is static and the data keys are
// whitelisted.
import prisma from "./prisma";
import { logger } from "../lib/logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo accepts up to 100 messages per request.
const EXPO_PUSH_BATCH_LIMIT = 100;

// Static, generic titles — no interpolation, ever.
const PUSH_TITLES: Record<string, string> = {
  friend_request: "New friend request",
  friend_request_accepted: "Friend request accepted",
  canyon_shared: "A canyon was shared with you",
  topo_complete: "Topo processing complete",
  topo_failed: "Topo processing failed",
  topo_export_complete: "Topo export finished",
  topo_export_skipped: "Auto-export skipped",
  geo_pdf_complete: "GeoPDF finished",
};

const GENERIC_TITLE = "Logjam notification";

/** Opaque reference IDs a push may carry — nothing else gets through. */
export type PushData = {
  type: string;
  notificationId?: string;
  friendshipId?: string;
  canyonId?: string;
  jobId?: string;
  exportId?: string;
  geoPdfJobId?: string;
};

const ALLOWED_DATA_KEYS = new Set([
  "type",
  "notificationId",
  "friendshipId",
  "canyonId",
  "jobId",
  "exportId",
  "geoPdfJobId",
]);

export type ExpoPushMessage = {
  to: string;
  title: string;
  data: PushData;
  sound: "default";
  priority: "default";
};

export function pushTitleFor(type: string): string {
  return PUSH_TITLES[type] ?? GENERIC_TITLE;
}

/**
 * Build Expo push messages for a set of device tokens. Pure — unit-tested
 * for the privacy invariant. Throws on a non-whitelisted data key so a
 * future call site can't smuggle free text through `data`.
 */
export function buildPushMessages(
  tokens: string[],
  data: PushData,
): ExpoPushMessage[] {
  for (const key of Object.keys(data)) {
    if (!ALLOWED_DATA_KEYS.has(key)) {
      throw new Error(`Push data key not allowed: ${key}`);
    }
  }
  const title = pushTitleFor(data.type);
  return tokens.map((token) => ({
    to: token,
    title,
    data,
    sound: "default",
    priority: "default",
  }));
}

type ExpoPushTicket = {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

/**
 * Tokens whose ticket says the device is gone — prune these rows. Pure.
 * Tickets come back in request order, matching the message order.
 */
export function tokensToPrune(
  tokens: string[],
  tickets: ExpoPushTicket[],
): string[] {
  return tokens.filter(
    (_, i) => tickets[i]?.details?.error === "DeviceNotRegistered",
  );
}

/**
 * Send a push to every registered device of a user. Best-effort like email:
 * failures are logged (scrubbed) and swallowed — a push must never fail the
 * request that triggered it.
 */
export async function sendPushToUser(
  userId: string,
  data: PushData,
): Promise<void> {
  try {
    const devices = await prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (devices.length === 0) return;
    const tokens = devices.map((d) => d.token);
    const messages = buildPushMessages(tokens, data);

    for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH_LIMIT) {
      const batchTokens = tokens.slice(i, i + EXPO_PUSH_BATCH_LIMIT);
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages.slice(i, i + EXPO_PUSH_BATCH_LIMIT)),
      });
      if (!response.ok) {
        logger.warn(
          { status: response.status, type: data.type },
          "push_send_failed",
        );
        continue;
      }
      const body = (await response.json()) as { data?: ExpoPushTicket[] };
      const stale = tokensToPrune(batchTokens, body.data ?? []);
      if (stale.length > 0) {
        await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } });
        logger.info({ count: stale.length }, "push_tokens_pruned");
      }
    }
  } catch (err) {
    // Never let a push failure surface; log the class only (no free text
    // that could carry payload fragments).
    logger.warn(
      { name: err instanceof Error ? err.name : "NonError", type: data.type },
      "push_send_error",
    );
  }
}

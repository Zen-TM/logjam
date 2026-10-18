// The maintainer's announcement script: the only way an Announcement is made
// or removed. There is deliberately no HTTP surface for it.
//
//   node dist/scripts/announce.js send <file.md>          # checks, counts, sends nothing
//   node dist/scripts/announce.js send <file.md> --yes    # sends
//   node dist/scripts/announce.js retract <announcementId>
//
// How to run it against prod: docs/operations/announcements.md.
//
// Every existing user gets one Notification naming the announcement; whoever
// signs up later gets none. Never email (privacy.html promises account codes
// and finished jobs only); the push is a fixed title (services/push.ts).
import { readFileSync } from "node:fs";
import { parseMessageMarkdown } from "@logjam/shared";
import prisma from "../services/prisma";
import { sendPushToUser } from "../services/push";
import { logger, safeErrorForLog } from "../lib/logger";

/**
 * A message file's title and body, or why it cannot be sent. The title is the
 * first line's `# ` heading, plain text; the body is the rest, and must use
 * nothing outside the subset the clients draw.
 */
export function prepareAnnouncement(
  markdown: string,
): { title: string; body: string } | { refused: string[] } {
  const [first, ...rest] = markdown.replace(/^\s*\n/, "").split("\n");
  const title = /^# (.+)$/.exec(first ?? "")?.[1].trim() ?? "";
  const body = rest.join("\n").trim();
  if (!title) return { refused: ["the file must start with a `# ` title"] };
  if (!body) return { refused: ["the message has no body"] };

  const refused = parseMessageMarkdown(body).dropped;
  // The title is drawn as plain text, so Markdown in it would show literally.
  const titleTree = parseMessageMarkdown(title).blocks;
  const plainTitle =
    titleTree.length === 1 &&
    titleTree[0].type === "paragraph" &&
    titleTree[0].children.every((c) => c.type === "text");
  if (!plainTitle) refused.push("Markdown in the title");
  return refused.length > 0 ? { refused } : { title, body };
}

async function send(path: string, confirmed: boolean): Promise<number> {
  const prepared = prepareAnnouncement(readFileSync(path, "utf8"));
  if ("refused" in prepared) {
    logger.error({ refused: prepared.refused }, "announcement_refused");
    return 1;
  }
  const recipients = await prisma.user.count();
  if (!confirmed) {
    logger.info({ title: prepared.title, recipients }, "announcement_checked");
    return 0;
  }

  const { announcement, userIds } = await prisma.$transaction(async (tx) => {
    const announcement = await tx.announcement.create({ data: prepared });
    const userIds = (await tx.user.findMany({ select: { id: true } })).map(
      (u) => u.id,
    );
    await tx.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: "announcement",
        payload: { announcementId: announcement.id },
      })),
    });
    return { announcement, userIds };
  });
  logger.info(
    { announcementId: announcement.id, recipients: userIds.length },
    "announcement_sent",
  );

  // Best-effort after the commit, like every other push: the inbox row is
  // the message, the push only points at it.
  for (const userId of userIds) {
    await sendPushToUser(userId, {
      type: "announcement",
      announcementId: announcement.id,
    });
  }
  logger.info({ announcementId: announcement.id }, "announcement_pushed");
  return 0;
}

async function retract(id: string): Promise<number> {
  const [notifications, announcements] = await prisma.$transaction([
    prisma.notification.deleteMany({
      where: {
        type: "announcement",
        payload: { path: ["announcementId"], equals: id },
      },
    }),
    prisma.announcement.deleteMany({ where: { id } }),
  ]);
  if (announcements.count === 0) {
    logger.error({ announcementId: id }, "announcement_not_found");
    return 1;
  }
  logger.info(
    { announcementId: id, notifications: notifications.count },
    "announcement_retracted",
  );
  return 0;
}

async function main(args: string[]): Promise<number> {
  const [command, target] = args;
  if (command === "send" && target) return send(target, args.includes("--yes"));
  if (command === "retract" && target) return retract(target);
  logger.error(
    "usage: announce.js send <file.md> [--yes] | retract <announcementId>",
  );
  return 1;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (err) => {
      logger.error({ err: safeErrorForLog(err) }, "announcement_failed");
      await prisma.$disconnect();
      process.exit(1);
    });
}

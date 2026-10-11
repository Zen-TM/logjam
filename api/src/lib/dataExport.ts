// What "Download my data" (GET /users/me/export) carries: the copy of a user's
// personal information that privacy.html's "Your controls" section describes.
//
// Each section names the schema models it covers, so the guard
// (dataExport.unit.test.ts) can hold every model in schema.prisma to a section
// here, to the `user` object, or to a reason in NOT_EXPORTED_MODELS. A new table
// of user data then fails the build until someone decides which it is; before
// this, routes, links, direct shares, friendships, file sends, GeoPDF jobs and
// device registrations had all been added without reaching the export.
//
// Another user appears only as id and username, never email (api/AGENTS.md).
import prisma from "../services/prisma";

type ExportSection = {
  models: readonly string[];
  load: (userId: string) => Promise<unknown>;
};

const otherUser = { select: { id: true, username: true } } as const;

export const EXPORT_SECTIONS = {
  places: {
    models: ["Place"],
    load: (userId) => prisma.place.findMany({ where: { ownerId: userId } }),
  },
  placeTypes: {
    models: ["PlaceType"],
    load: (userId) => prisma.placeType.findMany({ where: { ownerId: userId } }),
  },
  // The user object carries the definitions in the shape the clients read;
  // this is the stored form, with the place types each one is scoped to.
  customFieldDefs: {
    models: ["CustomFieldDef", "CustomFieldDefPlaceType"],
    load: (userId) =>
      prisma.customFieldDef.findMany({
        where: { ownerId: userId },
        include: { placeTypes: true },
      }),
  },
  placeLinks: {
    models: ["PlaceLink"],
    load: (userId) => prisma.placeLink.findMany({ where: { ownerId: userId } }),
  },
  routes: {
    models: ["Route"],
    load: (userId) => prisma.route.findMany({ where: { ownerId: userId } }),
  },
  tripLogs: {
    models: ["TripLog", "TripLogPlace"],
    load: (userId) =>
      prisma.tripLog.findMany({
        where: { userId },
        include: { places: true },
      }),
  },
  // Media metadata only: file contents are not in the JSON.
  media: {
    models: ["Media"],
    load: (userId) => prisma.media.findMany({ where: { ownerId: userId } }),
  },
  friendships: {
    models: ["Friendship"],
    load: (userId) =>
      prisma.friendship.findMany({
        where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
        include: { requester: otherUser, addressee: otherUser },
      }),
  },
  // Unspent invite links: when each was made and ends. The link itself is
  // not kept, only its hash, which is left out as it is no use to its owner.
  friendInvites: {
    models: ["FriendInvite"],
    load: (userId) =>
      prisma.friendInvite.findMany({
        where: { inviterId: userId },
        select: { id: true, createdAt: true, expiresAt: true },
      }),
  },
  sharesGiven: {
    models: ["PlaceShare"],
    load: (userId) =>
      prisma.placeShare.findMany({
        where: { sharedById: userId },
        include: { sharedWith: otherUser },
      }),
  },
  sharesReceived: {
    models: ["PlaceShare"],
    load: (userId) =>
      prisma.placeShare.findMany({
        where: { sharedWithId: userId },
        include: { sharedBy: otherUser },
      }),
  },
  // Routes, topo maps and GeoPDFs shared one at a time.
  itemSharesGiven: {
    models: ["Share"],
    load: (userId) =>
      prisma.share.findMany({
        where: { sharedById: userId },
        include: { sharedWith: otherUser },
      }),
  },
  itemSharesReceived: {
    models: ["Share"],
    load: (userId) =>
      prisma.share.findMany({
        where: { sharedWithId: userId },
        include: { sharedBy: otherUser },
      }),
  },
  fileSendsSent: {
    models: ["FileSend", "FileSendRecipient"],
    load: (userId) =>
      prisma.fileSend.findMany({
        where: { senderId: userId },
        include: { recipients: { include: { user: otherUser } } },
      }),
  },
  fileSendsReceived: {
    models: ["FileSendRecipient"],
    load: (userId) =>
      prisma.fileSendRecipient.findMany({
        where: { userId },
        include: {
          fileSend: {
            select: {
              id: true,
              sourceKind: true,
              filename: true,
              sizeBytes: true,
              createdAt: true,
              expiresAt: true,
              sender: otherUser,
            },
          },
        },
      }),
  },
  // Job records identify their outputs; tile files and PDFs are not included.
  topoJobs: {
    models: ["TopoJob"],
    load: (userId) => prisma.topoJob.findMany({ where: { userId } }),
  },
  topoExportJobs: {
    models: ["TopoExportJob"],
    load: (userId) => prisma.topoExportJob.findMany({ where: { userId } }),
  },
  topoTemplates: {
    models: ["TopoTemplate"],
    load: (userId) => prisma.topoTemplate.findMany({ where: { userId } }),
  },
  geoPdfJobs: {
    models: ["GeoPdfJob"],
    load: (userId) => prisma.geoPdfJob.findMany({ where: { userId } }),
  },
  geoPdfTemplates: {
    models: ["GeoPdfTemplate"],
    load: (userId) => prisma.geoPdfTemplate.findMany({ where: { userId } }),
  },
  notifications: {
    models: ["Notification"],
    load: (userId) => prisma.notification.findMany({ where: { userId } }),
  },
  // Logjam GPS installs registered for push notifications.
  devices: {
    models: ["DeviceToken"],
    load: (userId) => prisma.deviceToken.findMany({ where: { userId } }),
  },
} satisfies Record<string, ExportSection>;

/** Models the export carries as the top-level `user` object. */
export const EXPORTED_AS_USER = ["User"] as const;

/** Models deliberately left out, and why. */
export const NOT_EXPORTED_MODELS: Record<string, string> = {
  SyncTombstone:
    "sync bookkeeping: the ids of records already deleted or unshared, which say nothing the rest of the export does not",
  EgressLogCursor:
    "not per user: how far the egress meter has read the storage access logs",
};

/** v3 adds every section beyond v2's places, trip logs, templates, shares,
 * media, topo jobs and notifications. */
export const EXPORT_SCHEMA_VERSION = 3;

export async function loadExportSections(
  userId: string,
): Promise<Record<keyof typeof EXPORT_SECTIONS, unknown>> {
  const names = Object.keys(
    EXPORT_SECTIONS,
  ) as (keyof typeof EXPORT_SECTIONS)[];
  const loaded = await Promise.all(
    names.map((name) => EXPORT_SECTIONS[name].load(userId)),
  );
  return Object.fromEntries(
    names.map((name, i) => [name, loaded[i]]),
  ) as Record<keyof typeof EXPORT_SECTIONS, unknown>;
}

import { describe, expect, it } from "vitest";
import { SYSTEM_FIELD_DEFS } from "../placeTypes.js";
import { BULK_SHARE_ITEM_TYPES } from "../sharing.js";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../themeSchemes.js";
import {
  attributeFilterShape,
  ACCOUNT_DELETE_BODY,
  noFriendsMatch,
  noFriendsMessage,
  sendCopyLabel,
  sharePromise,
  STATS,
  statsEmptyActivityBody,
  statsHeroTitle,
  statsMostReturnedLine,
  statsTruncatedNote,
  statsUnderActivitiesNote,
  WAY_VERBS,
  wayVerbLabel,
  MAP_LAYERS,
  attributeDeleteConfirm,
  contractSectionKeys,
  deleteAccountPhrase,
  deleteAccountPhraseMatches,
  contractSectionsFor,
  drawsYoursHeading,
  notificationGroupLead,
  NOTIFICATION_PREFERENCES,
  ownAttributeCountLabel,
  ownTypeCountLabel,
  placeTypeDeleteConfirm,
  FRIEND_SHARE_VERBS,
  friendRemoveConfirm,
  friendsRemoveConfirm,
  friendSharesEmptyTitle,
  friendSharesNote,
  friendsEmptyKind,
  friendsHeroTitle,
  inboxHeroTitle,
  inboxTruncatedNote,
  notificationDeleteConfirm,
  NOTIFICATION_VERBS,
  PLACE_PAGE,
  PLACE_PAGE_PRIMARY_VERBS,
  placeAttributesTitle,
  placeStatusLabel,
  PLACE_VERBS,
  placeDeleteConfirm,
  PLACES_ADD,
  PLACES_FILTER_SHEET,
  placesEmptyKind,
  placesEmptyState,
  placesFilterNote,
  placesHeroTitle,
  placeVerbIds,
  placeVerbs,
  SCREEN_CONTRACTS,
  listSelectionLabel,
  tripDeleteConfirm,
  tripsEmptyKind,
  tripsEmptyState,
  tripsFilterNote,
  tripsHeroTitle,
  tripVerbs,
} from "./index.js";

describe("every screen contract", () => {
  it("has an id of its own", () => {
    const ids = SCREEN_CONTRACTS.map((contract) => contract.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SCREEN_CONTRACTS.map((contract) => [contract.id, contract] as const))(
    "%s names each section once and has no empty copy",
    (_id, contract) => {
      const keys = contract.sections.map((section) => section.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const [key, words] of Object.entries(contract.copy))
        expect(words.trim(), `copy.${key}`).not.toBe("");
    },
  );

  // Red when a section is marked `on` one client with no `reason`: a
  // platform-only section is a divergence, and it has to say what about the
  // medium forces it.
  it.each(SCREEN_CONTRACTS.map((contract) => [contract.id, contract] as const))(
    "%s gives a reason for each section only one client draws, and for no other",
    (_id, contract) => {
      for (const section of contract.sections) {
        if (section.on) expect(section.reason, section.key).toBeTruthy();
        else expect(section.reason, section.key).toBeUndefined();
      }
    },
  );

  it("hands a client its own sections, in order, and never the other's", () => {
    expect(contractSectionKeys(PLACES_FILTER_SHEET, "web")).toEqual([
      "sort",
      "attributes",
      "location",
      "source",
      "dates",
    ]);
    expect(contractSectionKeys(PLACES_FILTER_SHEET, "gps")).toEqual([
      "sort",
      "attributes",
      "location",
      "source",
      "dates",
      "onMap",
    ]);
    expect(contractSectionKeys(PLACES_ADD, "gps")).toEqual(["add"]);
  });
});

describe("the places filter sheet", () => {
  it("titles every section", () => {
    const copy: Record<string, string> = PLACES_FILTER_SHEET.copy;
    for (const section of PLACES_FILTER_SHEET.sections)
      expect(copy[section.key], section.key).toBeTruthy();
  });

  const system = (key: string) =>
    SYSTEM_FIELD_DEFS.find((def) => def.key === key)!;

  // Red when a shape is chosen by key: a canyon's grades must get exactly what
  // a user's own definition of the same shape gets.
  it("picks a control by the definition's shape, never its key", () => {
    expect(attributeFilterShape(system("v_grade"))).toBe("pills");
    expect(attributeFilterShape({ type: "integer", min: 1, max: 7 })).toBe(
      "pills",
    );
    expect(attributeFilterShape(system("quality"))).toBe("pills");
    expect(attributeFilterShape(system("hours"))).toBe("threshold");
    expect(attributeFilterShape({ type: "float", min: 0, max: null })).toBe(
      "threshold",
    );
    expect(attributeFilterShape({ type: "integer", min: 0, max: 100 })).toBe(
      "minMax",
    );
    expect(attributeFilterShape({ type: "float", min: 0.5, max: 3 })).toBe(
      "minMax",
    );
    expect(
      attributeFilterShape({ type: "boolean", min: null, max: null }),
    ).toBe("boolean");
    expect(attributeFilterShape({ type: "string", min: null, max: null })).toBe(
      "text",
    );
    expect(attributeFilterShape({ type: "date", min: null, max: null })).toBe(
      "date",
    );
  });
});

describe("the places list", () => {
  it("answers the hero's question with the collection's size", () => {
    expect(placesHeroTitle(0)).toBe("No places yet");
    expect(placesHeroTitle(1)).toBe("1 place");
    expect(placesHeroTitle(37)).toBe("37 places");
  });

  it("announces hidden filters, then a sort that is not the default", () => {
    expect(placesFilterNote(0, "name")).toBeNull();
    expect(placesFilterNote(1, "name")).toBe("1 filter active");
    expect(placesFilterNote(3, "quality")).toBe(
      "3 filters active · Best rated",
    );
    expect(placesFilterNote(0, "recent")).toBe("Recently added");
  });

  it("tells an empty collection, a tight filter and an empty bucket apart", () => {
    expect(placesEmptyKind({ total: 0, filtering: true, bucket: "done" })).toBe(
      "firstRun",
    );
    expect(placesEmptyKind({ total: 5, filtering: true, bucket: "done" })).toBe(
      "filtered",
    );
    expect(
      placesEmptyKind({ total: 5, filtering: false, bucket: "done" }),
    ).toBe("done");
    // Only a type tab narrows: still "nothing matches", never "no places yet".
    expect(placesEmptyKind({ total: 5, filtering: false, bucket: "all" })).toBe(
      "filtered",
    );
  });

  it("never promises a guest an import or a sync", () => {
    const guest = placesEmptyState("firstRun", {
      platform: "gps",
      guest: true,
    });
    expect(guest.body).not.toMatch(/import|sync/i);
    expect(placesEmptyState("firstRun", { platform: "web" }).body).toContain(
      "Logjam GPS",
    );
    expect(placesEmptyState("filtered", { platform: "web" }).action).toBe(
      "clear",
    );
  });
});

describe("a place's verbs", () => {
  const ids = (
    platform: "web" | "gps",
    surface: "row" | "page" | "pin",
    owned: boolean,
  ) => placeVerbs(platform, surface, owned).map((verb) => verb.id);

  // Red when a surface withholds a verb: a place reached from its row or its
  // pin is not a lesser object than one reached from its page.
  it("gives every surface the same verbs, bar Open on the page and Show on the map", () => {
    for (const platform of ["web", "gps"] as const)
      for (const owned of [true, false]) {
        const row = ids(platform, "row", owned);
        expect(row[0]).toBe("open");
        expect(ids(platform, "page", owned)).toEqual(
          row.filter((id) => id !== "open"),
        );
        expect(ids(platform, "pin", owned)).toEqual(
          row.filter((id) => id !== "show"),
        );
      }
  });

  // Red when "show" loses its `on: "gps"`: on Logjam Web opening a place
  // already flies the map there, so a button for it is a second way to do one
  // thing.
  it("offers Show on map on Logjam GPS only, where the map is another screen", () => {
    for (const owned of [true, false]) {
      expect(ids("web", "row", owned)).not.toContain("show");
      expect(ids("web", "page", owned)).not.toContain("show");
      expect(ids("gps", "row", owned)).toContain("show");
      expect(ids("gps", "page", owned)).toContain("show");
    }
  });

  it("never offers to edit, share, delete or log a trip at a place someone shared with you", () => {
    for (const platform of ["web", "gps"] as const) {
      const shared = ids(platform, "row", false);
      for (const id of ["edit", "share", "delete", "logTrip"])
        expect(shared).not.toContain(id);
      expect(shared).toEqual(
        expect.arrayContaining(["copy", "copyAndRemove", "remove"]),
      );
    }
  });

  it("puts the parting verbs below the rule, and marks only Delete destructive", () => {
    const shared = placeVerbs("gps", "row", false);
    expect(
      shared.filter((verb) => verb.separated).map((verb) => verb.id),
    ).toEqual(["copyAndRemove", "remove"]);
    expect(shared.some((verb) => verb.danger)).toBe(false);
    expect(
      placeVerbs("web", "page", true)
        .filter((verb) => verb.danger)
        .map((verb) => verb.id),
    ).toEqual(["delete"]);
  });

  it("gives a reason for each verb only one client has", () => {
    for (const verb of PLACE_VERBS)
      if ("on" in verb) expect(verb.reason).toBeTruthy();
    expect(placeVerbIds("gps")).not.toContain("makeTopo");
    expect(placeVerbIds("web")).toContain("makeTopo");
  });
});

describe("placeDeleteConfirm", () => {
  it("names the one place in a confirm opened for it", () => {
    expect(placeDeleteConfirm({ name: "Claustral" }, 0).confirmTitle).toBe(
      "Delete Claustral?",
    );
  });

  it("counts a selection without naming it", () => {
    expect(placeDeleteConfirm({ count: 1 }).confirmTitle).toBe(
      "Delete this place?",
    );
    expect(placeDeleteConfirm({ count: 4 }).confirmTitle).toBe(
      "Delete 4 places?",
    );
  });

  it("says what goes and what stays", () => {
    expect(placeDeleteConfirm({ name: "Claustral" }, 0).confirmBody).toBe(
      "Its notes, photos, tracks and shares go too. This can't be undone.",
    );
    expect(placeDeleteConfirm({ name: "Claustral" }, 1).confirmBody).toContain(
      "1 logged trip stays in your logbook, unlinked.",
    );
    expect(placeDeleteConfirm({ name: "Claustral" }, 4).confirmBody).toContain(
      "4 logged trips stay in your logbook, unlinked.",
    );
    expect(placeDeleteConfirm({ count: 3 }).confirmBody).toBe(
      "Their notes, photos, tracks and shares go too. Trips that link to them stay in your logbook, unlinked. This can't be undone.",
    );
  });
});

describe("a place's page", () => {
  it("keeps the owner's sections off a place someone shared", () => {
    const shared = contractSectionsFor(PLACE_PAGE, "web", false);
    for (const key of ["doesntFit", "linkedPlaces", "sharedWith"])
      expect(shared).not.toContain(key);
    expect(contractSectionsFor(PLACE_PAGE, "web", true)).toContain(
      "sharedWith",
    );
    expect(contractSectionsFor(PLACE_PAGE, "web", true)).not.toContain(
      "navigate",
    );
    expect(contractSectionsFor(PLACE_PAGE, "gps", true)).toContain("navigate");
  });

  // Red when a primary verb is dropped from the page's verbs: the buttons and
  // the ⋯ must never disagree about what a place can do.
  it("draws as buttons only verbs the page offers", () => {
    const page = placeVerbs("gps", "page", true).map((verb) => verb.id);
    for (const id of PLACE_PAGE_PRIMARY_VERBS) expect(page).toContain(id);
  });

  it("names the attributes for the kind, and the status with its tally", () => {
    expect(placeAttributesTitle("Canyon")).toBe("Canyon attributes");
    expect(placeAttributesTitle(null)).toBe("Place attributes");
    expect(placeStatusLabel("todo", 0)).toBe("Not visited");
    expect(placeStatusLabel("done", 1)).toBe("Visited · 1 trip");
    expect(placeStatusLabel("done", 3)).toBe("Visited · 3 trips");
    expect(placeStatusLabel("shared", 0)).toBe("Shared");
  });
});

describe("a trip's verbs", () => {
  // Red when a surface withholds a verb: a trip in the logbook is not a lesser
  // object than one opened on its page.
  it("gives the row and the page the same verbs, bar Open", () => {
    const row = tripVerbs("row").map((verb) => verb.id);
    expect(row[0]).toBe("open");
    expect(tripVerbs("page").map((verb) => verb.id)).toEqual(row.slice(1));
  });

  it("marks only Delete destructive, below the rule", () => {
    const verbs = tripVerbs("row");
    expect(verbs.filter((verb) => verb.danger).map((verb) => verb.id)).toEqual([
      "delete",
    ]);
    expect(verbs.find((verb) => verb.id === "delete")?.separated).toBe(true);
  });

  it("says what goes and what stays, for one trip or many", () => {
    expect(tripDeleteConfirm(1)).toEqual({
      confirmTitle: "Delete this trip?",
      confirmBody:
        "Its photos, videos and tracks go too. The places it links to stay. This can't be undone.",
    });
    expect(tripDeleteConfirm(3)).toEqual({
      confirmTitle: "Delete 3 trips?",
      confirmBody:
        "Their photos, videos and tracks go too. The places they link to stay. This can't be undone.",
    });
  });
});

describe("the logbook", () => {
  it("answers the hero's question with the logbook's size", () => {
    expect(tripsHeroTitle(0)).toBe("No trips yet");
    expect(tripsHeroTitle(1)).toBe("1 trip");
    expect(tripsHeroTitle(127)).toBe("127 trips");
  });

  it("announces a range, other hidden filters, then a sort that is not the default", () => {
    const note = (
      rangeLabel: string | null,
      sheetFilterCount: number,
      sort: "newest" | "oldest",
    ) => tripsFilterNote({ rangeLabel, sheetFilterCount, sort });
    expect(note(null, 0, "newest")).toBeNull();
    expect(note("This year", 1, "newest")).toBe("This year");
    expect(note("This year", 3, "newest")).toBe("This year · 2 filters active");
    expect(note(null, 1, "oldest")).toBe("1 filter active · Oldest first");
    expect(note(null, 0, "oldest")).toBe("Oldest first");
  });

  it("tells an empty logbook from a tight filter, and never promises a guest an import", () => {
    expect(tripsEmptyKind({ total: 0 })).toBe("firstRun");
    expect(tripsEmptyKind({ total: 5 })).toBe("filtered");
    const guest = tripsEmptyState("firstRun", { platform: "gps", guest: true });
    expect(guest.body).not.toMatch(/import|sync/i);
    expect(tripsEmptyState("firstRun", { platform: "web" }).body).toContain(
      "Logjam GPS",
    );
    expect(tripsEmptyState("filtered", { platform: "gps" }).action).toBe(
      "clear",
    );
  });

  it("counts a selection the same on every list", () => {
    expect(listSelectionLabel(3)).toBe("3 selected");
  });
});

describe("the inbox", () => {
  it("answers the hero's question with what is unread", () => {
    expect(inboxHeroTitle(3, 10)).toBe("3 unread");
    expect(inboxHeroTitle(0, 10)).toBe("All caught up");
    expect(inboxHeroTitle(0, 0)).toBe("Nothing yet");
  });

  it("says a capped list is capped", () => {
    expect(inboxTruncatedNote(500, 612)).toBe(
      "Showing the 500 most recent of 612. Older ones aren't listed.",
    );
  });

  it("says where a deleted notification goes, for one or many", () => {
    expect(notificationDeleteConfirm(1)).toEqual({
      confirmTitle: "Delete this notification?",
      confirmBody:
        "It goes from every device on your account. This can't be undone.",
    });
    expect(notificationDeleteConfirm(3).confirmTitle).toBe(
      "Delete 3 notifications?",
    );
    expect(notificationDeleteConfirm(3).confirmBody).toMatch(/^They go/);
  });

  it("marks only Delete destructive, below the rule", () => {
    const danger = NOTIFICATION_VERBS.filter(
      (verb) => "danger" in verb && verb.danger,
    );
    expect(danger.map((verb) => verb.id)).toEqual(["delete"]);
  });
});

describe("friends", () => {
  it("leads with a request, then the count of friends", () => {
    expect(friendsHeroTitle(2, 5)).toBe("2 requests");
    expect(friendsHeroTitle(1, 5)).toBe("1 request");
    expect(friendsHeroTitle(0, 0)).toBe("No friends yet");
    expect(friendsHeroTitle(0, 1)).toBe("1 friend");
  });

  it("tells an empty page from an empty bucket", () => {
    const kind = (
      friends: number,
      requests: number,
      bucket: "all" | "friends" | "requests",
    ) => friendsEmptyKind({ friends, requests, bucket });
    expect(kind(0, 0, "all")).toBe("firstRun");
    expect(kind(2, 0, "requests")).toBe("noRequests");
    expect(kind(0, 1, "friends")).toBe("firstRun");
    expect(kind(2, 1, "all")).toBeNull();
  });

  it("says removing a friend ends sharing both ways", () => {
    expect(friendRemoveConfirm("abel").confirmTitle).toBe("Remove abel?");
    expect(friendRemoveConfirm("abel").confirmBody).toContain("both ways");
    expect(friendsRemoveConfirm(3).confirmTitle).toBe("Remove 3 friends?");
    expect(friendsRemoveConfirm(3).confirmBody).toContain("both ways");
  });

  it("gives a reason for each share verb only one client has", () => {
    for (const verb of FRIEND_SHARE_VERBS)
      if ("on" in verb) expect(verb.reason).toBeTruthy();
  });

  it("names the direction a friend's list runs", () => {
    expect(friendSharesNote("theySee", "abel")).toBe(
      "Items you have shared with abel.",
    );
    expect(friendSharesEmptyTitle("youSee", "abel")).toBe(
      "abel hasn't shared anything with you",
    );
  });
});

describe("settings", () => {
  // Red when a notification preference is added to the API's defaults and not
  // to the list both clients draw its switch from: it would have no switch.
  it("has a switch for every notification preference, and no other", () => {
    expect(NOTIFICATION_PREFERENCES.map((row) => row.key).sort()).toEqual(
      Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).sort(),
    );
  });

  it("names the surface a notification is shown in", () => {
    expect(notificationGroupLead("email", "Logjam Web")).toBe("Email me when");
    expect(notificationGroupLead("inApp", "Logjam GPS")).toBe(
      "Notify me in Logjam GPS when",
    );
  });

  it("counts only what the user made", () => {
    expect(ownTypeCountLabel(0)).toBe("Built-ins only");
    expect(ownTypeCountLabel(2)).toBe("2 of your own");
    expect(ownAttributeCountLabel(0)).toBe("None yet");
    expect(ownAttributeCountLabel(1)).toBe("1 attribute");
    expect(ownAttributeCountLabel(4)).toBe("4 attributes");
  });

  it("draws a Yours heading only against a Built in", () => {
    expect(drawsYoursHeading(2, 3)).toBe(true);
    expect(drawsYoursHeading(0, 3)).toBe(false);
    expect(drawsYoursHeading(2, 0)).toBe(false);
  });

  it("says what deleting a type or an attribute costs", () => {
    expect(placeTypeDeleteConfirm("Cave").confirmTitle).toBe("Delete Cave?");
    const rows = { one: "trip", many: "trips" };
    expect(attributeDeleteConfirm("Water level", 0, rows).confirmBody).toBe(
      "This removes the attribute from every trip. No trips have a value for it. This can't be undone.",
    );
    expect(
      attributeDeleteConfirm("Water level", 1, rows).confirmBody,
    ).toContain("1 trip has a value for it, and that value goes too.");
    expect(
      attributeDeleteConfirm("Water level", 12, rows).confirmBody,
    ).toContain("12 trips have a value for it, and those values go too.");
    expect(
      attributeDeleteConfirm("Water level", "unknown", rows).confirmBody,
    ).toBe("This removes the attribute from every trip. This can't be undone.");
  });
});

describe("the account", () => {
  // Red when the phrase to type is relaxed to the bare username: a paste of
  // the name on screen must not be enough to delete an account.
  it("asks for more than the username to delete an account", () => {
    expect(deleteAccountPhrase("alice")).toBe("delete alice");
    expect(deleteAccountPhraseMatches("  Delete Alice ", "alice")).toBe(true);
    expect(deleteAccountPhraseMatches("alice", "alice")).toBe(false);
  });

  it("says what stays as well as what goes", () => {
    expect(ACCOUNT_DELETE_BODY).toContain("stay theirs");
  });
});

describe("the map's layers", () => {
  it("draws Offline on Logjam GPS only, and says why", () => {
    expect(contractSectionKeys(MAP_LAYERS, "web")).toEqual([
      "basemap",
      "overlays",
    ]);
    expect(contractSectionKeys(MAP_LAYERS, "gps")).toEqual([
      "basemap",
      "overlays",
      "offline",
    ]);
  });
});

describe("sharing", () => {
  // Red when a kind is added to what can be shared and its promise is not
  // written: a screen would have nothing to tell the friend it grants.
  it("promises something for every kind that can be shared", () => {
    for (const kind of BULK_SHARE_ITEM_TYPES)
      expect(sharePromise(kind), kind).toMatch(/^Friends you pick/);
    expect(sharePromise("selection")).toContain("these");
  });

  it("says a place share leaves copies alone, and a route's can be stopped", () => {
    expect(sharePromise("place")).toContain("copies they've already made");
    expect(sharePromise("route")).toContain("stop sharing anytime");
  });

  it("names the way out of an empty friend picker", () => {
    expect(noFriendsMessage("copy").body).toContain("Copies go to friends");
    expect(noFriendsMessage("share").body).toContain("Add one in Friends");
    expect(noFriendsMatch("  ab ")).toBe("No friends match “ab”.");
  });

  it("counts a send", () => {
    expect(sendCopyLabel(0)).toBe("Send a copy");
    expect(sendCopyLabel(1)).toBe("Send a copy");
    expect(sendCopyLabel(3)).toBe("Send 3 copies");
  });
});

describe("a way's verbs", () => {
  // Red when a way's copy verb drifts from the place's: Logjam Web said "Save
  // to my Ways" where a place said "Save a copy".
  it("keeps a copy with the words places use", () => {
    expect(wayVerbLabel("copy", "web")).toBe(
      placeVerbs("web", "row", false).find((verb) => verb.id === "copy")!.label,
    );
    expect(wayVerbLabel("copyAndRemove", "gps")).toBe(
      placeVerbs("gps", "row", false).find(
        (verb) => verb.id === "copyAndRemove",
      )!.label,
    );
  });

  it("marks a dialog with an ellipsis on Logjam Web only", () => {
    expect(wayVerbLabel("share", "web")).toBe("Share…");
    expect(wayVerbLabel("share", "gps")).toBe("Share");
    expect(WAY_VERBS.length).toBeGreaterThan(0);
  });
});

describe("the logbook's stats", () => {
  it("leads with days out", () => {
    expect(statsHeroTitle(1)).toBe("1 day out");
    expect(statsHeroTitle(12)).toBe("12 days out");
  });

  it("says what an empty window holds, and says a capped count is capped", () => {
    expect(statsEmptyActivityBody("Canyoning")).toBe(
      "No canyoning trips in this window. Try a wider one.",
    );
    expect(statsMostReturnedLine("Claustral", 4)).toBe(
      "most returned to · Claustral ×4",
    );
    expect(statsUnderActivitiesNote(1)).toContain("1 more attribute belongs");
    expect(statsUnderActivitiesNote(3)).toContain("3 more attributes belong");
    expect(statsTruncatedNote(500, 612)).toContain(
      "500 most recent trips of 612",
    );
  });

  it("draws On foot on Logjam GPS only, and the capped note on Logjam Web only", () => {
    expect(contractSectionKeys(STATS, "gps")).toContain("onFoot");
    expect(contractSectionKeys(STATS, "web")).not.toContain("onFoot");
    expect(contractSectionKeys(STATS, "web")).toContain("truncated");
    expect(contractSectionKeys(STATS, "gps")).not.toContain("truncated");
  });
});

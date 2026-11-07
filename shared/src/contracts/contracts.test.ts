import { describe, expect, it } from "vitest";
import * as contracts from "./index.js";
import { SYSTEM_FIELD_DEFS } from "../placeTypes.js";
import { formatFieldValue, type AttributeRow } from "../logbook.js";
import { validatePlacePayload } from "../placeValidation.js";
import { PLACE_STATUS_ORDER } from "../placeStatus.js";
import { BULK_SHARE_ITEM_TYPES } from "../sharing.js";
import { TERRAIN_SWITCH_KEYS } from "../terrain.js";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../themeSchemes.js";
import {
  abandonConfirm,
  attributeFilterShape,
  leaderboardHeroTitle,
  leaderboardNudge,
  leaderboardPodiumLine,
  leaderboardBadge,
  leaderboardButtonLabel,
  leaderboardSeasonLine,
  ACCOUNT_DELETE_BODY,
  ACCOUNT_PHONE_ONLY,
  COPY_MEDIA_SETTING,
  SETTINGS,
  SETTINGS_PHONE_ONLY,
  SELECTION_GESTURES,
  noFriendsMatch,
  noFriendsMessage,
  sendCopyLabel,
  sharePromise,
  lidarJobSharePromise,
  STATS,
  statsEmptyActivityBody,
  statsHeroTitle,
  statsMostReturnedLine,
  statsTruncatedNote,
  statsUnderActivitiesNote,
  WAY_VERBS,
  wayVerbLabel,
  wayVerbIcon,
  mapMeasureFacts,
  mapMeasurePointsLabel,
  mapMeasureRange,
  mapMeasureVerbs,
  MAP_MEASURE,
  MAP_TOOLS,
  mapTools,
  MAP_MEASURE_START_NOTE,
  MAP_MEASURE_VERBS,
  MAP_SNAP_OPTIONS,
  mapPointFacts,
  mapHoldVerbs,
  mapPointStepBack,
  mapPointVerbs,
  fixAgeLabel,
  MAP_SEARCH_PLACEHOLDER,
  MAP_POINT,
  MAP_POINT_NO_FIX_NOTE,
  MAP_POINT_VERBS,
  MAP_LAYERS,
  MAP_OVERLAYS,
  MAP_OVERLAY_DEFAULTS,
  MAP_OVERLAY_REFINEMENTS,
  MAP_TERRAIN,
  attributeDeleteConfirm,
  SETTINGS_LIST,
  contractSectionKeys,
  deleteAccountPhrase,
  deleteAccountPhraseMatches,
  contractSectionsFor,
  drawsYoursHeading,
  notificationGroupLead,
  NOTIFICATION_PREFERENCES,
  ownAttributeCountLabel,
  ownTypeCountLabel,
  placeCountLabel,
  placeTypeDeleteConfirm,
  placeTypeInUseNote,
  FRIEND_SHARE_VERBS,
  PLAN_VERB_LISTS,
  friendRemoveConfirm,
  friendRequestMadeFriend,
  friendsRemoveConfirm,
  friendSharesEmptyTitle,
  friendSharesNote,
  friendsEmptyKind,
  friendsHeroSubtitle,
  INBOX,
  INBOX_VERBS,
  inboxHeroTitle,
  inboxVerb,
  inboxTruncatedNote,
  notificationDeleteConfirm,
  NOTIFICATION_VERBS,
  PLACE_PAGE,
  PLACE_PAGE_PRIMARY_VERBS,
  placeSectionTitle,
  formatPlacePosition,
  placeAttributesTitle,
  placeStatusLabel,
  withFieldUnit,
  withRowUnit,
  ACCOUNT_FOOTER_LINKS,
  BUG_REPORT_URL,
  PLACE_VERBS,
  placeDeleteConfirm,
  placeDeleteDone,
  PLACES_ADD,
  PLACES_ONBOARDING,
  PLACES_FILTER_SHEET,
  PLACE_STATUS_FILTER_OPTIONS,
  placesEmptyKind,
  placesEmptyState,
  placesFilterNote,
  placesHeroTitle,
  placeTypeHasTab,
  placeVerbIds,
  placeVerbs,
  SCREEN_CONTRACTS,
  PLACE_FORM,
  TRIP_FORM,
  listSelectionLabel,
  tripDeleteConfirm,
  tripDeleteDone,
  planDeleteConfirm,
  planFormDeleteConfirm,
  planItemDeleteConfirm,
  planSectionDeleteConfirm,
  tripsEmptyKind,
  tripsEmptyState,
  tripsFilterNote,
  tripsHeroTitle,
  tripVerbs,
  NEW_TYPE_ATTRIBUTES,
  stepAfterPlaceTypeSave,
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

  // Red when a section is marked `on` one client with neither a `reason` nor a
  // `gap`, or with both: a platform-only section is a divergence, and it has
  // to say what about the medium forces it, or that it is not built yet.
  it.each(SCREEN_CONTRACTS.map((contract) => [contract.id, contract] as const))(
    "%s gives exactly one of reason or gap for each section only one client draws, and neither for any other",
    (_id, contract) => {
      for (const section of contract.sections) {
        if (section.on)
          expect(
            [section.reason, section.gap].filter(Boolean),
            section.key,
          ).toHaveLength(1);
        else {
          expect(section.reason, section.key).toBeUndefined();
          expect(section.gap, section.key).toBeUndefined();
        }
      }
    },
  );

  // Mutation: delete `onlyWhenAdding` from a PLACE_FORM section and Logjam GPS's
  // edit sheet is handed (and must draw) a picker it cannot run; add one with no
  // gap sentence and the divergence is off the record.
  it("leaves a section a client draws only while adding out of its edit form, and says why", () => {
    for (const section of PLACE_FORM.sections)
      if ("onlyWhenAdding" in section)
        expect(section.onlyWhenAdding.gap.length).toBeGreaterThan(0);
    expect(contractSectionKeys(PLACE_FORM, "gps", "edit")).not.toContain(
      "photos",
    );
    expect(contractSectionKeys(PLACE_FORM, "gps", "edit")).not.toContain(
      "route",
    );
    expect(contractSectionKeys(PLACE_FORM, "gps", "add")).toEqual(
      expect.arrayContaining(["photos", "route"]),
    );
    // Logjam Web draws both in either mode.
    expect(contractSectionKeys(PLACE_FORM, "web", "edit")).toEqual(
      expect.arrayContaining(["photos", "route"]),
    );
  });

  // Mutation: delete `onlyWhenAdding` from a TRIP_FORM section and Logjam GPS's
  // edit sheet is handed a picker it cannot run; mark one `on: "web"` and Logjam
  // GPS's add form loses it.
  it("gives the trip form its photos and routes on both clients while adding, and Logjam Web's while editing", () => {
    for (const key of ["photos", "routes"] as const) {
      const section = TRIP_FORM.sections.find((s) => s.key === key);
      expect(section && "onlyWhenAdding" in section, key).toBe(true);
      expect(contractSectionKeys(TRIP_FORM, "gps", "add")).toContain(key);
      expect(contractSectionKeys(TRIP_FORM, "gps", "edit")).not.toContain(key);
      expect(contractSectionKeys(TRIP_FORM, "web", "add")).toContain(key);
      expect(contractSectionKeys(TRIP_FORM, "web", "edit")).toContain(key);
    }
  });

  it("hands a client its own sections, in order, and never the other's", () => {
    expect(contractSectionKeys(PLACES_FILTER_SHEET, "web")).toEqual([
      "sort",
      "status",
      "attributes",
      "location",
      "source",
      "dates",
    ]);
    expect(contractSectionKeys(PLACES_FILTER_SHEET, "gps")).toEqual([
      "sort",
      "status",
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
  // Mutation: drop a status from the list, and that filter cannot be set.
  it("offers All, then every status in order", () => {
    expect(PLACE_STATUS_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      "all",
      ...PLACE_STATUS_ORDER,
    ]);
    for (const option of PLACE_STATUS_FILTER_OPTIONS)
      expect(option.label, option.value).toBeTruthy();
  });

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
    // Mutation: returning the first-run title for 0 repeats it under the hero.
    expect(placesHeroTitle(0)).toBe("0 places");
    expect(placesHeroTitle(1)).toBe("1 place");
    expect(placesHeroTitle(37)).toBe("37 places");
  });

  // "I added a type and no tab appeared": a type the user made is on the rail
  // from the moment it exists. Mutation: `places > 0` alone.
  it("gives a type the user made a tab before it holds a place", () => {
    expect(placeTypeHasTab({ builtIn: false, places: 0 })).toBe(true);
    expect(placeTypeHasTab({ builtIn: false, places: 4 })).toBe(true);
    expect(placeTypeHasTab({ builtIn: true, places: 0 })).toBe(false);
    expect(placeTypeHasTab({ builtIn: true, places: 1 })).toBe(true);
  });

  it("announces hidden filters, then a sort that is not the default", () => {
    expect(placesFilterNote(0, "name")).toBeNull();
    expect(placesFilterNote(1, "name")).toBe("1 filter active");
    expect(placesFilterNote(3, "quality")).toBe(
      "3 filters active · Best rated",
    );
    expect(placesFilterNote(0, "recent")).toBe("Recently added");
  });

  it("tells an empty collection from a tight filter", () => {
    expect(placesEmptyKind({ total: 0 })).toBe("firstRun");
    expect(placesEmptyKind({ total: 5 })).toBe("filtered");
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

// Red when a link is dropped from the account footer: Terms and Privacy are the
// documents a signed-in user agreed to, so they stay one tap from Account.
describe("the account footer", () => {
  it("names the Terms, the Privacy policy and where to report a bug", () => {
    expect(ACCOUNT_FOOTER_LINKS.map((link) => link.label)).toEqual([
      "Terms",
      "Privacy",
      "Report a bug",
    ]);
    expect(BUG_REPORT_URL).toMatch(/\/issues\/new\?template=bug\.yml$/);
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

  // Red when "exportPlace" is owner-only or leaves Logjam GPS: sharePromise
  // tells a friend they can export the place, so their phone must be able to.
  // Red when either client loses "Export…" (the share promise says friends can
  // export a place), for a place that is yours or shared with you.
  it("lets both clients export a place, owned or shared with you", () => {
    for (const platform of ["web", "gps"] as const)
      for (const owned of [true, false])
        for (const surface of ["row", "page", "pin"] as const)
          expect(ids(platform, surface, owned)).toContain("exportPlace");
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
      if ("on" in verb) expect(verb.reason ?? verb.gap).toBeTruthy();
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
      "1 logged trip stays, unlinked.",
    );
    expect(placeDeleteConfirm({ name: "Claustral" }, 4).confirmBody).toContain(
      "4 logged trips stay, unlinked.",
    );
    expect(placeDeleteConfirm({ count: 3 }).confirmBody).toBe(
      "Their notes, photos, tracks and shares go too. Trips that link to them stay, unlinked. This can't be undone.",
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
  });

  // Mutation: swap two keys in `PLACE_PAGE.sections` (say "weather" above
  // "attributes") and both clients draw them in the new order, so this list is
  // the only thing that notices the page stopped leading with its facts.
  it("leads with the place's facts and puts the forecast and gauge after them", () => {
    const order = [
      "hero",
      "verbs",
      "position",
      "navigate",
      "attributes",
      "doesntFit",
      "notes",
      "sources",
      "photos",
      "route",
      "weather",
      "gauge",
      "linkedPlaces",
      "trips",
      "sharedWith",
    ];
    const ownerOnly = ["doesntFit", "linkedPlaces", "sharedWith"];
    expect(contractSectionsFor(PLACE_PAGE, "gps", true)).toEqual(order);
    expect(contractSectionsFor(PLACE_PAGE, "web", true)).toEqual(
      order.filter((key) => key !== "navigate"),
    );
    expect(contractSectionsFor(PLACE_PAGE, "gps", false)).toEqual(
      order.filter((key) => !ownerOnly.includes(key)),
    );
  });

  it("writes a position and a built-in's unit the same on both clients", () => {
    expect(formatPlacePosition(-33.559541, 150.3995)).toBe(
      "-33.55954, 150.39950",
    );
    expect(withFieldUnit("longest_abseil", "15")).toBe("15 m");
    expect(withFieldUnit("num_abseils", "6")).toBe("6");
    expect(withFieldUnit("my_own_field", "6")).toBe("6");
  });

  // Mutation: format every row in `withRowUnit` (not only one with a unit): the
  // table formats it again and a date attribute reads a day early, so it
  // runs in a zone east of UTC.
  it("adds a unit to a row without formatting it a second time", () => {
    const zone = process.env.TZ;
    process.env.TZ = "Australia/Sydney";
    try {
      const date: AttributeRow = [
        "first_visit",
        "First visit",
        "2026-10-03",
        "date",
      ];
      const shown = (row: AttributeRow) => formatFieldValue(row[2], row[3]);
      expect(shown(withRowUnit(date))).toBe(shown(date));
      expect(shown(date)).toMatch(/\b3\b/);
      const longest: AttributeRow = [
        "longest_abseil",
        "Longest pitch",
        15,
        "float",
      ];
      expect(shown(withRowUnit(longest))).toBe("15 m");
      expect(
        withRowUnit(["longest_abseil", "Longest pitch", null, "float"])[2],
      ).toBeNull();
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  // Mutation: mark "gauge" ownerOnly, and a sharee loses the owner's pick.
  it("gives both clients and a sharee the gauge section", () => {
    for (const client of ["web", "gps"] as const)
      for (const owned of [true, false])
        expect(contractSectionsFor(PLACE_PAGE, client, owned)).toContain(
          "gauge",
        );
  });

  // Mutation: drop `shareeSees` from "photos", and the owner's page stops
  // saying a friend sees the photos; drop `view.shared` from the condition,
  // and a place nobody has says its photos are visible to friends.
  it("marks, on the owner's page only and once it is shared, each section a friend sees", () => {
    const title = (owned: boolean, filled: boolean, shared = true) =>
      placeSectionTitle("photos", "Photos & videos", { owned, filled, shared });
    expect(title(true, true)).toBe(
      "Photos & videos · visible to friends you share with",
    );
    expect(title(true, true, false)).toBe("Photos & videos");
    expect(title(false, true)).toBe("Photos & videos");
    expect(title(true, false)).toBe("Photos & videos");
    // What a friend never sees is never marked, and is never also shown to them.
    for (const section of PLACE_PAGE.sections) {
      if ("ownerOnly" in section) expect("shareeSees" in section).toBe(false);
    }
    expect(
      placeSectionTitle("trips", "Your trips", {
        owned: true,
        filled: true,
        shared: true,
      }),
    ).toBe("Your trips");
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
    expect(placeStatusLabel("shared", 0, "bob")).toBe("From bob");
    expect(placeStatusLabel("shared", 0)).toBe("Shared with you");
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
    expect(tripDeleteConfirm({ title: "Claustral" })).toEqual({
      confirmTitle: "Delete Claustral?",
      confirmBody:
        "Its photos, videos and tracks go too. The places it links to stay. This can't be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    expect(tripDeleteConfirm({ count: 1 }).confirmTitle).toBe(
      "Delete this trip?",
    );
    expect(tripDeleteConfirm({ count: 3 })).toEqual({
      confirmTitle: "Delete 3 trips?",
      confirmBody:
        "Their photos, videos and tracks go too. The places they link to stay. This can't be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
  });
});

describe("the logbook", () => {
  it("answers the hero's question with the logbook's size", () => {
    expect(tripsHeroTitle(0)).toBe("0 trips");
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

  // Red when the hero's ⋯ verbs and the copy's "Mark all as read" drift: the
  // two clients read both.
  it("words the hero's mark-all verb as its copy does, and marks only Clear destructive", () => {
    expect(inboxVerb("markAllRead").label).toBe(INBOX.copy.markAllRead);
    expect(
      INBOX_VERBS.filter((verb) => "danger" in verb).map((v) => v.id),
    ).toEqual(["clearRead"]);
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
    expect(friendsHeroSubtitle(2, 5)).toBe("2 requests");
    expect(friendsHeroSubtitle(1, 5)).toBe("1 request");
    expect(friendsHeroSubtitle(0, 0)).toBe("No friends yet");
    expect(friendsHeroSubtitle(0, 1)).toBe("1 friend");
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

  it("knows a sent request that made a friend from one still waiting", () => {
    expect(friendRequestMadeFriend({ id: "f", status: "accepted" })).toBe(true);
    expect(friendRequestMadeFriend({ id: "f", status: "pending" })).toBe(false);
    // An older API answers the same row; anything else is not a friend.
    expect(friendRequestMadeFriend(undefined)).toBe(false);
    expect(friendRequestMadeFriend(null)).toBe(false);
  });

  it("says removing a friend ends sharing both ways", () => {
    expect(friendRemoveConfirm("abel").confirmTitle).toBe("Remove abel?");
    expect(friendRemoveConfirm("abel").confirmBody).toContain("both ways");
    expect(friendsRemoveConfirm(3).confirmTitle).toBe("Remove 3 friends?");
    expect(friendsRemoveConfirm(3).confirmBody).toContain("both ways");
  });

  it("gives a reason for each share verb only one client has", () => {
    for (const verb of FRIEND_SHARE_VERBS)
      if ("on" in verb) expect(verb.reason ?? verb.gap).toBeTruthy();
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
    expect(notificationGroupLead("email", "Logjam Web")).toBe("Email me about");
    expect(notificationGroupLead("inApp", "Logjam GPS")).toBe(
      "Notify me in Logjam GPS about",
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

  // Red when adding a type goes back to the list (`return "list"` for both):
  // the new type's attributes are then a separate trip through Settings.
  it("leads a new place type into its attributes, and a changed one back", () => {
    expect(stepAfterPlaceTypeSave(true)).toBe("attributes");
    expect(stepAfterPlaceTypeSave(false)).toBe("list");
    expect(NEW_TYPE_ATTRIBUTES.done).toBe("Done");
  });

  // Red when the note stops naming Logjam Web: a user with 40 places on a type
  // has no merge on the phone and must be told where it is.
  it("counts a type's places and says where to merge one", () => {
    expect(placeCountLabel(1)).toBe("1 place");
    expect(placeCountLabel(40)).toBe("40 places");
    expect(placeTypeInUseNote(1)).toContain("Change it");
    expect(placeTypeInUseNote(40)).toContain("merge it on Logjam Web");
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
      "terrain",
      "overlays",
    ]);
    expect(contractSectionKeys(MAP_LAYERS, "gps")).toEqual([
      "basemap",
      "terrain",
      "overlays",
      "offline",
    ]);
  });

  // Mutation: reorder the contract's rows or TERRAIN_SWITCH_KEYS alone, and a
  // client lists the layers in one order and stacks them in another.
  it("lists the Terrain group in the order it is stacked", () => {
    const rows = TERRAIN_SWITCH_KEYS.filter((key) => key !== "land");
    // The bands sit under the Slope switch they colour.
    const slope = rows.indexOf("slope") + 1;
    const withBands = [
      ...rows.slice(0, slope),
      "slopeBands",
      ...rows.slice(slope),
    ];
    expect(contractSectionKeys(MAP_TERRAIN, "gps")).toEqual(withBands);
    expect(contractSectionKeys(MAP_TERRAIN, "web")).toEqual([
      ...withBands,
      "sharpenedAreas",
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

  // Mutation: the LiDAR topo's promise for a sharpened area, which a friend
  // can't download or export.
  it("promises no download or export for a sharpened area", () => {
    for (const kind of ["sharpenedArea", "lidarJob"] as const) {
      expect(sharePromise(kind), kind).toMatch(/^Friends you pick/);
      expect(sharePromise(kind), kind).not.toMatch(/download|export/);
    }
  });

  // Mutations: drop the syncRole check, and a row rebuilt from what a phone
  // saved, a sharpened area perhaps, is promised an older topo's download
  // and export; or read a sharpened job as an older one.
  it("promises a LiDAR job by its kind, and only what is true of both when unknown", () => {
    expect(lidarJobSharePromise({ syncRole: "owner", sharpened: {} })).toBe(
      "sharpenedArea",
    );
    expect(lidarJobSharePromise({ syncRole: "shared" })).toBe("topoJob");
    expect(lidarJobSharePromise({ sharpened: undefined })).toBe("lidarJob");
    expect(lidarJobSharePromise(undefined)).toBe("lidarJob");
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

  // Mutation: word the delete item per client again.
  it("words Delete once for both clients", () => {
    expect(wayVerbLabel("delete", "web")).toBe("Delete way");
    expect(wayVerbLabel("delete", "gps")).toBe("Delete way");
  });

  // One verb, one word and one glyph on both clients, and the same word and
  // glyph a place's own "log a trip" wears (shared/DESIGN.md §6).
  it("declares Log a trip once, with the trip glyph", () => {
    expect(wayVerbLabel("logTrip", "web")).toBe("Log a trip");
    expect(wayVerbLabel("logTrip", "gps")).toBe("Log a trip");
    expect(wayVerbIcon("logTrip")).toBe(
      placeVerbs("web", "row", true).find((verb) => verb.id === "logTrip")!
        .icon,
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

describe("the map's overlays list", () => {
  // Red when Logjam GPS's list drifts from Logjam Web's: the web's rows are the
  // list, and each client differs only by what a row declares (`on`).
  it("is Logjam Web's rows plus the phone's GeoPDF row", () => {
    expect(contractSectionKeys(MAP_OVERLAYS, "web")).toEqual([
      "places",
      "ways",
      "land",
      "gauges",
      "mgaGrid",
      "importFile",
    ]);
    expect(contractSectionKeys(MAP_OVERLAYS, "gps")).toEqual([
      "places",
      "ways",
      "geoPdfs",
      "land",
      "gauges",
      "mgaGrid",
      "importFile",
    ]);
  });

  // Mutation: default gauges or the grid on, and a fresh install fetches a
  // public file, or draws lines over every map, nobody asked for.
  it("starts with only the user's own places drawn, on rows both clients have", () => {
    expect(MAP_OVERLAY_DEFAULTS).toEqual({
      places: true,
      gauges: false,
      mgaGrid: false,
    });
    for (const row of Object.keys(MAP_OVERLAY_DEFAULTS)) {
      expect(contractSectionKeys(MAP_OVERLAYS, "web")).toContain(row);
      expect(contractSectionKeys(MAP_OVERLAYS, "gps")).toContain(row);
    }
  });

  it("refines only rows that exist", () => {
    for (const row of Object.keys(MAP_OVERLAY_REFINEMENTS))
      expect(contractSectionKeys(MAP_OVERLAYS, "gps")).toContain(row);
  });
});

// What a press on empty map answers, on both clients (shared/DESIGN.md §3).
describe("the map point panel", () => {
  // Mutation: mark the slope section `on: "gps"` again and the contract says
  // Logjam Web shows no slope, though MapPointPopover draws one from the point
  // route.
  it("declares Slope for both clients", () => {
    for (const platform of ["web", "gps"] as const)
      expect(contractSectionsFor(MAP_POINT, platform, false)).toContain(
        "slope",
      );
  });

  const point = { latitude: -33.65, longitude: 150.35 };

  it("shows where it is and how high, and nothing from a fix it lacks", () => {
    const facts = mapPointFacts({
      point,
      elevation: { state: "known", metres: 412.4 },
      from: null,
    });
    expect(facts.map((fact) => [fact.key, fact.value])).toEqual([
      ["position", "-33.65000, 150.35000"],
      ["elevation", "412 m"],
    ]);
    // The position takes the line and copies where it is pressed; the rest do
    // not. Mutation: drop `copyable` and both clients lose the press.
    expect(facts[0]).toMatchObject({ span: true, copyable: true });
    expect(facts.slice(1).some((fact) => fact.copyable)).toBe(false);
  });

  it("adds distance and bearing only from a fix the device already has", () => {
    const facts = mapPointFacts({
      point,
      elevation: { state: "checking" },
      from: { latitude: -33.66, longitude: 150.35 },
    });
    expect(facts.map((fact) => fact.key)).toEqual([
      "position",
      "elevation",
      "distance",
      "bearing",
    ]);
    expect(facts[1].value).toBe("Checking…");
    expect(facts[2].value).toMatch(/^1\.1 km$|^1,?1\d\d m$/);
    expect(facts[3].value).toMatch(/^N 0°$|^N 360°$|^N \d+°$/);
  });

  // Mutation: show a dash or a zero for an unknown slope, and a point outside
  // the fine DEM reads as flat ground.
  it("shows a slope only when one is known, after the other figures", () => {
    const base = {
      point,
      elevation: { state: "known", metres: 412.4 },
      from: { latitude: -33.66, longitude: 150.35 },
    } as const;
    expect(mapPointFacts({ ...base, slopeDegrees: 37.6 }).at(-1)).toEqual({
      key: "slope",
      label: "Slope",
      value: "38°",
    });
    expect(mapPointFacts({ ...base, slopeDegrees: 0 }).at(-1)!.value).toBe(
      "0°",
    );
    for (const facts of [
      mapPointFacts({ ...base, slopeDegrees: null }),
      mapPointFacts(base),
    ])
      expect(facts.map((fact) => fact.key)).not.toContain("slope");
  });

  // Mutation: ignore `savedHereOnly` in `asVerb`, and a marker dropped offline
  // still promises "Saved, and synced".
  it("does not promise a sync the marker has not had", () => {
    const subtitle = (savedHereOnly: boolean) =>
      [
        mapPointVerbs("gps", savedHereOnly),
        mapHoldVerbs("gps", savedHereOnly),
      ].map(
        (verbs) => verbs.find((verb) => verb.id === "dropMarker")?.subtitle,
      );
    expect(subtitle(false)).toEqual(["Saved, and synced", "Saved, and synced"]);
    expect(subtitle(true)).toEqual([
      "Saved on this phone",
      "Saved on this phone",
    ]);
  });

  it("says why there is no height rather than showing a dash", () => {
    const unavailable = mapPointFacts({
      point,
      elevation: { state: "unavailable" },
      from: null,
    });
    expect(unavailable[1]).toMatchObject({
      value: "—",
      note: "Needs a connection",
    });
  });

  // Mutation: give a verb `on: "web"` with no client that draws it, or two
  // clients the same verb under one id with different words.
  it("gives each client its verbs, in order, a one-client verb with a reason", () => {
    expect(mapPointVerbs("web").map((verb) => verb.id)).toEqual([
      "drawRoute",
      "addPlace",
      "measure",
      "weather",
    ]);
    expect(mapPointVerbs("gps").map((verb) => verb.id)).toEqual([
      "navigate",
      "dropMarker",
      "drawRoute",
      "addPlace",
      "measure",
      "weather",
    ]);
    for (const verb of MAP_POINT_VERBS)
      if ("on" in verb)
        expect((verb.reason ?? verb.gap).length).toBeGreaterThan(0);
    expect(mapPointVerbs("gps")[0]).toEqual({
      id: "navigate",
      icon: "navigateTo",
      label: "Navigate to this point",
      subtitle: "Live distance and bearing — nothing saved",
    });
  });

  // Mutation: add a verb to Options that the hold lacks and that is not the
  // weather: Logjam GPS's `run[...]` is a `Record` over the hold's ids, so that
  // verb would reach it as `undefined` and do nothing.
  it("gives every Options verb but the weather a flow from the hold's list", () => {
    const hold = mapHoldVerbs("gps").map((verb) => verb.id);
    for (const verb of mapPointVerbs("gps"))
      if (verb.id !== "weather") expect(hold, verb.id).toContain(verb.id);
  });

  // Mutation: put `drawRoute` back behind `on: "gps"`: Logjam Web's Options
  // loses it and its words stop matching Logjam GPS's.
  it("offers Draw a route from here on both clients, in the same words", () => {
    const label = (platform: "gps" | "web") =>
      mapPointVerbs(platform).find((verb) => verb.id === "drawRoute")?.label;
    expect(label("web")).toBe("Draw a route from here");
    expect(label("web")).toBe(label("gps"));
  });

  // Mutation: let weather back out to the facts, or Options close the panel:
  // Escape and the back gesture would undo two layers, or none.
  it("backs the point panel out one layer at a time", () => {
    expect(mapPointStepBack("weather")).toBe("options");
    expect(mapPointStepBack("options")).toBe("point");
    expect(mapPointStepBack("point")).toBeNull();
  });

  // Mutation: declare a copy verb again, and a client draws a Copy coordinates
  // button beside the figure that already copies when pressed.
  it("has no verb that copies the coordinates", () => {
    expect(MAP_POINT_VERBS.map((verb) => verb.id)).not.toContain("copy");
  });

  // Mutation: give a verb `hold: "gps"` that Logjam GPS's sheet does not draw
  // (or the reverse): `MapHoldSheet` draws `mapHoldVerbs`, so this list is what
  // its hold offers. Logjam Web has no hold: a right-click opens Options.
  it("gives Logjam GPS's hold its verbs, each with one label", () => {
    expect(mapHoldVerbs("gps").map((verb) => verb.id)).toEqual([
      "navigate",
      "dropMarker",
      "drawRoute",
      "addPlace",
      "measure",
    ]);
    expect(mapHoldVerbs("web")).toEqual([]);
    // A verb the hold shares with Options is one label in both.
    const labels = new Map<string, string>();
    for (const verb of [...mapPointVerbs("gps"), ...mapHoldVerbs("gps")]) {
      expect(labels.get(verb.id) ?? verb.label).toBe(verb.label);
      labels.set(verb.id, verb.label);
    }
    // Everything the hold offers is also behind Options.
    for (const platform of ["gps", "web"] as const)
      expect(mapPointVerbs(platform).map((verb) => verb.id)).toEqual(
        expect.arrayContaining(mapHoldVerbs(platform).map((verb) => verb.id)),
      );
  });

  // Mutation: give the fix's figures to every point, and a tapped spot reads
  // "Updated just now" about a position nobody measured.
  it("adds the fix's accuracy and age only for the viewer's own position", () => {
    const fix = { atMs: 1_000, accuracyM: 7.6, nowMs: 13_000 };
    const keys = (f: ReturnType<typeof mapPointFacts>) => f.map((x) => x.key);
    const facts = mapPointFacts({
      point,
      elevation: { state: "known", metres: 412 },
      from: null,
      fix,
    });
    expect(keys(facts)).toEqual([
      "position",
      "elevation",
      "accuracy",
      "fixAge",
    ]);
    expect(facts[2].value).toBe("± 8 m");
    expect(facts[3].value).toBe("12 s ago");
    expect(
      mapPointFacts({
        point,
        elevation: { state: "known", metres: 412 },
        from: null,
        fix: { ...fix, accuracyM: null },
      })[2].value,
    ).toBe("Not reported");
    expect(
      keys(
        mapPointFacts({
          point,
          elevation: { state: "known", metres: 412 },
          from: null,
        }),
      ),
    ).not.toContain("accuracy");
    // Mutation: label the receiver's height "Elevation", and a height that can
    // be tens of metres off the terrain's reads as the terrain's.
    const receiver = mapPointFacts({
      point,
      elevation: { state: "receiver", metres: 1021.6 },
      from: null,
    })[1];
    expect([receiver.label, receiver.value]).toEqual([
      "GPS altitude",
      "1022 m",
    ]);
    expect(fixAgeLabel(2_000)).toBe("just now");
    expect(fixAgeLabel(150_000)).toBe("2 min ago");
  });

  it("puts the fix's figures on Logjam GPS only, with the reason", () => {
    expect(contractSectionsFor(MAP_POINT, "gps", false)).toContain("accuracy");
    expect(contractSectionsFor(MAP_POINT, "web", false)).not.toContain(
      "accuracy",
    );
    for (const section of MAP_POINT.sections)
      if ("on" in section) expect(section.reason ?? "").not.toBe("");
  });

  // Mutation: change either client's placeholder away from this one.
  it("declares one search placeholder", () => {
    expect(MAP_SEARCH_PLACEHOLDER).toBe("Search places and locations");
  });

  // Mutation: push the land fact whatever `land` is, and with the overlay off
  // the panel has a Land figure with nothing in it.
  it("has no land figure with the overlay off or nothing drawn there", () => {
    const facts = (land?: string | null) =>
      mapPointFacts({
        point,
        elevation: { state: "unavailable" },
        from: null,
        land,
      }).map((fact) => fact.key);
    expect(facts()).not.toContain("land");
    expect(facts(null)).not.toContain("land");
  });

  it("keeps its sections and facts in step", () => {
    const keys = MAP_POINT.sections.map((section) => section.key);
    const facts = mapPointFacts({
      point,
      elevation: { state: "unavailable" },
      from: { latitude: -33.66, longitude: 150.34 },
      slopeDegrees: 12,
      land: "Private land",
      fix: { atMs: 0, accuracyM: 5, nowMs: 1_000 },
    });
    expect(facts.map((fact) => fact.key)).toEqual(keys);
    expect(MAP_POINT_NO_FIX_NOTE.web).toContain("locate button");
    expect(MAP_POINT_NO_FIX_NOTE.gps).toContain("locate button");
  });

  // Mutation: give the point panel's verb words of its own.
  it("arms the measure tool in the tool's own words", () => {
    const verb = mapPointVerbs("web").find((each) => each.id === "measure");
    expect(verb).toMatchObject({
      label: MAP_MEASURE.copy.fromHere,
      icon: "measure",
    });
  });
});

// The measure tool both clients draw: the same figures from the same points.
describe("the measure tool", () => {
  // ~1.11 km due north, then the same again due east of there.
  const line: [number, number][] = [
    [150.35, -33.66],
    [150.35, -33.65],
    [150.362, -33.65],
  ];
  const terrain = { gainM: 212.4, lossM: 87.6, minM: 411.7, maxM: 655.2 };

  // Mutation: measure the straight line between the ends instead of the path.
  it("measures along every leg, and shows a dash until there is a line", () => {
    const fact = (points: [number, number][]) =>
      mapMeasureFacts({ points, terrain: null });
    expect(fact([])).toEqual([
      { key: "distance", label: "Distance", value: "—" },
    ]);
    expect(fact(line.slice(0, 1))[0].value).toBe("—");
    expect(fact(line.slice(0, 2))[0].value).toBe("1.1 km");
    expect(fact(line)[0].value).toBe("2.2 km");
  });

  it("adds ascent and descent only once the terrain has been read", () => {
    const facts = mapMeasureFacts({ points: line, terrain });
    expect(facts.map((fact) => [fact.key, fact.value, fact.spoken])).toEqual([
      ["distance", "2.2 km", undefined],
      ["ascent", "↑ 212 m", "Ascent 212 metres"],
      ["descent", "↓ 88 m", "Descent 88 metres"],
    ]);
    expect(facts.map((fact) => fact.key)).toEqual(
      MAP_MEASURE.sections.map((section) => section.key),
    );
  });

  it("gives the ground's range only when the terrain covered the line", () => {
    expect(mapMeasureRange(terrain)).toBe("412–655 m");
    expect(mapMeasureRange({ ...terrain, minM: null })).toBeNull();
    expect(mapMeasureRange(null)).toBeNull();
  });

  it("counts the user's points", () => {
    expect(mapMeasurePointsLabel(1)).toBe("1 point");
    expect(mapMeasurePointsLabel(3)).toBe("3 points");
  });

  // Mutation: drop `on: "gps"` from `leave`, or its reason.
  it("gives both clients undo and clear, and a reason for the verb only one has", () => {
    expect(mapMeasureVerbs("web").map((verb) => verb.id)).toEqual([
      "undo",
      "clear",
    ]);
    expect(mapMeasureVerbs("gps").map((verb) => verb.id)).toEqual([
      "undo",
      "clear",
      "leave",
    ]);
    for (const verb of MAP_MEASURE_VERBS)
      expect("on" in verb, verb.id).toBe("reason" in verb || "gap" in verb);
    expect(MAP_MEASURE_START_NOTE.web).toBe("Click the map to measure");
    expect(MAP_MEASURE_START_NOTE.gps).toBe("Tap the map to measure");
  });
});

describe("the snap words", () => {
  it("name every snap mode once", () => {
    expect(MAP_SNAP_OPTIONS.map((option) => option.value)).toEqual([
      "off",
      "trails",
      "waterways",
      "both",
    ]);
    expect(new Set(MAP_SNAP_OPTIONS.map((o) => o.label)).size).toBe(4);
  });
});

describe("the leaderboard", () => {
  it("says where the user stands, and a board of one as such", () => {
    expect(leaderboardBadge(2, 4)).toBe("#2");
    expect(leaderboardBadge(1, 1)).toBeNull();
    expect(leaderboardButtonLabel({ rank: 2, size: 4 })).toBe(
      "Leaderboard, you're #2 of 4",
    );
    expect(leaderboardButtonLabel({ rank: 1, size: 1 })).toBe("Leaderboard");
    expect(leaderboardButtonLabel(null)).toBe("Leaderboard");
    expect(leaderboardHeroTitle(2, 4)).toBe("#2 of 4");
    expect(leaderboardHeroTitle(1, 1)).toBe("Just you so far");
    expect(leaderboardSeasonLine("2026–27")).toBe("2026–27 season");
  });

  it("words the podium by place and count", () => {
    expect(
      leaderboardPodiumLine({ season: "2025–26", rank: 1, canyonCount: 1 }),
    ).toBe("You came first in 2025–26, with 1 canyon.");
    expect(
      leaderboardPodiumLine({ season: "2025–26", rank: 3, canyonCount: 7 }),
    ).toBe("You came third in 2025–26, with 7 canyons.");
  });

  it("names everyone who hasn't joined", () => {
    expect(leaderboardNudge([])).toBe("");
    expect(leaderboardNudge(["kit"])).toBe("kit isn't on it yet.");
    expect(leaderboardNudge(["kit", "bo"])).toBe(
      "kit and bo aren't on it yet.",
    );
    expect(leaderboardNudge(["kit", "bo", "al"])).toBe(
      "kit, bo and al aren't on it yet.",
    );
  });
});

describe("a contract's reason and gap", () => {
  const reasons: string[] = [];
  const walk = (value: unknown, seen = new Set<unknown>()) => {
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === "reason" && typeof child === "string") reasons.push(child);
      else walk(child, seen);
    }
  };
  walk(contracts);

  // A reason is about the medium; a feature not built yet is a `gap`
  // (shared/DESIGN.md §14). Mutation that turns it red: write the sentence at
  // `account.ts` ("Logjam GPS has no data export yet.") back as a `reason`.
  it("reads as a reason about the medium, never as a gap", () => {
    expect(reasons.length).toBeGreaterThan(10);
    for (const reason of reasons)
      expect(reason, reason).not.toMatch(/\b(gap|not built|has no|yet)\b/i);
  });
});

describe("abandonConfirm", () => {
  // Mutation: swap the two branches.
  it("says a new thing is lost whole and an edit only loses its changes", () => {
    expect(abandonConfirm("place", true)).toEqual({
      confirmTitle: "Discard this place?",
      confirmBody: "Nothing you've entered is kept.",
      confirmLabel: "Discard",
      tone: "destructive",
      icon: "close",
    });
    expect(abandonConfirm("trip", false)).toEqual({
      confirmTitle: "Discard your changes?",
      confirmBody: "The trip stays as it was.",
      confirmLabel: "Discard",
      tone: "destructive",
      icon: "close",
    });
  });
});

describe("the delete confirms", () => {
  // Mutation: drop `tone` or `confirmLabel` from any of the three, or word
  // a label apart from the menu item that raises it.
  it("each carry the menu's Delete verb in the warning tone", () => {
    const copies = [
      [placeDeleteConfirm({ name: "Claustral" }), "Delete"],
      [placeTypeDeleteConfirm("Canyon"), SETTINGS_LIST.copy.deleteType],
      [
        attributeDeleteConfirm("Water level", 0, {
          one: "trip",
          many: "trips",
        }),
        SETTINGS_LIST.copy.deleteAttribute,
      ],
    ] as const;
    for (const [copy, label] of copies) {
      expect(copy.confirmLabel).toBe(label);
      expect(copy.tone).toBe("destructive");
    }
  });

  // Mutation: drop "This can't be undone." from any one, or name its thing
  // in the title no longer ("Delete this trip?" for a trip that has a title).
  it("every delete names its thing and says it can't be undone", () => {
    const copies = [
      placeDeleteConfirm({ name: "Claustral" }),
      tripDeleteConfirm({ title: "Claustral" }),
      planDeleteConfirm("Claustral", { places: 1, ways: 0 }),
      planSectionDeleteConfirm("Claustral"),
      planFormDeleteConfirm({
        title: "Claustral",
        answers: [],
        myAnswer: null,
      }),
      planItemDeleteConfirm("Claustral"),
      placeTypeDeleteConfirm("Claustral"),
      attributeDeleteConfirm("Claustral", 0, { one: "trip", many: "trips" }),
    ];
    for (const copy of copies) {
      expect(copy.confirmTitle).toContain("Delete Claustral");
      expect(copy.confirmBody).toMatch(/This can't be undone\.$/);
    }
    for (const copy of copies.slice(0, 6))
      expect(copy.confirmLabel).toBe("Delete");
  });
});

describe("the place form and the trip form", () => {
  // Mutation: change LATITUDE_RANGE, or reword `latitudeInvalid`, alone.
  it("says what the validator says under a bad coordinate", () => {
    expect(
      validatePlacePayload(
        { latitude: 91, longitude: 0 },
        { requireCoords: true },
      ),
    ).toBe(PLACE_FORM.copy.latitudeInvalid);
    expect(
      validatePlacePayload(
        { latitude: 0, longitude: 181 },
        { requireCoords: true },
      ),
    ).toBe(PLACE_FORM.copy.longitudeInvalid);
  });

  // Mutation: type "Other names" back into the plan item's label.
  it("is the one source of the words the place page and a plan's place use", () => {
    const place = SCREEN_CONTRACTS.find((c) => c.id === "places.page");
    const plan = SCREEN_CONTRACTS.find((c) => c.id === "plans.page");
    for (const key of ["alsoKnownAs", "route", "notes", "sources"] as const) {
      expect(place?.copy[key]).toBe(PLACE_FORM.copy[key]);
    }
    expect(plan?.copy.itemAlsoKnownAs).toBe(PLACE_FORM.copy.alsoKnownAs);
  });

  // Mutation: "Place updated." as `saved`.
  it("ends a done toast with a full stop and says the same for add and save", () => {
    expect(PLACE_FORM.copy.added).toBe("Place added.");
    expect(PLACE_FORM.copy.saved).toBe("Place saved.");
    expect(TRIP_FORM.copy.logged).toBe("Trip logged.");
    expect(TRIP_FORM.copy.saved).toBe("Trip saved.");
  });
});

describe("SETTINGS", () => {
  // Logjam GPS draws one menu row per section and Logjam Web one section each,
  // so this order is both clients'. Mutation: move "privacy" above
  // "notifications", or give "map" no `on`.
  it("lists the pages in one order, the phone-only ones marked", () => {
    expect(contractSectionKeys(SETTINGS, "gps").slice(0, 6)).toEqual([
      "display",
      "regions",
      "map",
      "notifications",
      "offline",
      "privacy",
    ]);
    expect(contractSectionKeys(SETTINGS, "web").slice(0, 4)).toEqual([
      "display",
      "regions",
      "notifications",
      "privacy",
    ]);
  });

  // The one entry both clients draw the copy-photos switch from. Mutation:
  // retype the label on one client (the sheet that defaults from it says the
  // same words), or move the group out of Privacy and security.
  it("holds the copy-photos switch under Copying a place", () => {
    expect(SETTINGS.copy.copying).toBe("Copying a place");
    expect(COPY_MEDIA_SETTING.label).toBe("Copy photos too");
  });

  // Mutation: type "Settings › Privacy" into copy.privacy.
  it("names a page the same on both clients", () => {
    expect(SETTINGS.copy.offline).toBe("Offline and storage");
    expect(SETTINGS.copy.privacy).toBe("Privacy and security");
  });
});

describe("the differences no section carries", () => {
  // Mutation: drop a `reason`, or set it to "".
  it.each([
    ["ACCOUNT_PHONE_ONLY", ACCOUNT_PHONE_ONLY],
    ["SETTINGS_PHONE_ONLY", SETTINGS_PHONE_ONLY],
    ["PLACES_ONBOARDING", PLACES_ONBOARDING],
    ["SELECTION_GESTURES", SELECTION_GESTURES],
  ] as const)("%s: each names its one client and a reason", (_name, list) => {
    const ids = list.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of list) {
      expect(["web", "gps"], entry.id).toContain(entry.on);
      expect(entry.reason.trim(), entry.id).not.toBe("");
    }
  });
});

describe("a verb list's reason and gap", () => {
  const lists: [string, readonly object[]][] = [
    ["PLACE_VERBS", PLACE_VERBS],
    ["FRIEND_SHARE_VERBS", FRIEND_SHARE_VERBS],
    ["MAP_POINT_VERBS", MAP_POINT_VERBS],
    ["MAP_MEASURE_VERBS", MAP_MEASURE_VERBS],
    ["MAP_TOOLS", MAP_TOOLS],
    ...PLAN_VERB_LISTS.map((list, i): [string, readonly object[]] => [
      `PLAN_VERB_LISTS[${i}]`,
      list,
    ]),
  ];

  // A verb only one client has gives exactly one non-empty `reason` or `gap`,
  // and any other verb gives neither. Mutation: give a one-client verb both,
  // or `gap: ""`.
  it.each(lists)(
    "%s: exactly one of reason or gap, on a one-client verb only",
    (_name, list) => {
      for (const verb of list as readonly {
        id: string;
        on?: string;
        reason?: string;
        gap?: string;
      }[]) {
        const given = [verb.reason, verb.gap].filter(
          (text) => text !== undefined,
        );
        if (verb.on) {
          expect(given, verb.id).toHaveLength(1);
          expect(given[0]!.trim(), verb.id).not.toBe("");
        } else expect(given, verb.id).toEqual([]);
      }
    },
  );
});

describe("MAP_TOOLS", () => {
  // Both clients' trays are `mapTools(platform)`: the web builder
  // (`webMapTools`) and Logjam GPS's `TOOLS` read it, and their own tests pin
  // that. Mutation: drop `on: "web"` from "makeMap" or "sharpen" and the GPS list gains it;
  // swap two entries and the orders below fail.
  it("draws the same tools in the same order, less what one client lacks", () => {
    expect(mapTools("web").map((tool) => tool.id)).toEqual([
      "measure",
      "route",
      "place",
      "makeMap",
      "sharpen",
    ]);
    expect(mapTools("gps").map((tool) => tool.id)).toEqual([
      "measure",
      "route",
      "place",
    ]);
  });
  // Mutation: add a `description` to a tool and `mapTools` hands it to the
  // clients, who then have a line to draw under the name.
  it("gives a tool its name alone, no description line", () => {
    for (const tool of mapTools("web")) {
      expect(Object.keys(tool).sort(), tool.id).toEqual([
        "icon",
        "id",
        "label",
      ]);
    }
  });
  it("names Measure by its own contract", () => {
    expect(mapTools("gps")[0]!.label).toBe(MAP_MEASURE.title);
  });
});

describe("a trip's page reads like a place's page", () => {
  // Red when TRIP_PAGE puts its files before its notes and attributes again,
  // or a place's page reorders them.
  it("orders the sections they share the same way", () => {
    const keys = (page: { sections: readonly { key: string }[] }) =>
      page.sections.map((section) => section.key);
    const place = keys(contracts.PLACE_PAGE);
    const trip = keys(contracts.TRIP_PAGE).map((key) =>
      key === "routes" ? "route" : key,
    );
    const files = ["attributes", "notes", "photos", "route"];
    expect(trip.filter((key) => files.includes(key))).toEqual(files);
    expect(place.filter((key) => files.includes(key))).toEqual(files);
  });

  // Red when a sharee is told the owner-private sentence under their own trips.
  it("gives a sharee words about their own trips", () => {
    expect(contracts.PLACE_PAGE.copy.tripsShared).toMatch(/your trips/i);
  });
});

// A page and a list say the same thing when a delete lands. Mutation: reword the
// singular in one function, or type a toast in a client again.
describe("delete done-toasts", () => {
  it("say one noun the same way from a page and from a list", () => {
    expect(placeDeleteDone(1)).toBe("Place deleted.");
    expect(placeDeleteDone(3)).toBe("3 places deleted.");
    expect(tripDeleteDone(1)).toBe("Trip deleted.");
    expect(tripDeleteDone(3)).toBe("3 trips deleted.");
  });
});

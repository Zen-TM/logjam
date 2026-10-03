import { describe, expect, it } from "vitest";
import { SYSTEM_FIELD_DEFS } from "../placeTypes.js";
import {
  attributeFilterShape,
  contractSectionKeys,
  contractSectionsFor,
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
  tripDeleteConfirm,
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

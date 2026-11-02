import { describe, expect, it } from "vitest";
import { coordinateEntry, parseCoordinatePair } from "./coordinates.js";

const pair = { latitude: -33.629, longitude: 150.3156 };

describe("parseCoordinatePair", () => {
  // Mutation: join the digits instead of splitting (strip everything but
  // digits and a dot), and the first case reads -33.62901503156.
  it.each([
    ["-33.6290, 150.3156", "comma and space"],
    ["-33.6290,150.3156", "comma alone"],
    ["-33.6290 150.3156", "space"],
    ["-33.6290\t150.3156", "tab"],
    ["-33.6290;150.3156", "semicolon"],
    ["  -33.6290 ,  150.3156  ", "padding"],
    ["−33.6290, 150.3156", "a typographic minus"],
    ["-33.6290°, 150.3156°", "degree signs"],
    ["33.6290° S, 150.3156° E", "hemisphere letters after"],
    ["33.6290S 150.3156E", "letters stuck to the numbers"],
    ["S 33.6290, E 150.3156", "letters before"],
    ["150.3156 E, 33.6290 S", "longitude first, said by its letters"],
    ["33.6290 s 150.3156 e", "lower case letters"],
  ])("splits %s (%s)", (text) => {
    expect(parseCoordinatePair(text)).toEqual(pair);
  });

  // Mutation: accept anything with two numbers in it, and a decimal comma, a
  // lone number or a swapped pair is split into nonsense.
  it.each([
    "",
    "-33.6290",
    "-33,6290",
    "-33,6290 150,3156",
    "-33.6290, 150.3156, 12",
    "-33.6290 abc",
    "150.3156, -33.6290",
    "91, 10",
    "10, 181",
    "33.6 N, 10 N",
    "-33.6 S, 150.3 E",
    "1.2.3, 4",
  ])("leaves %j alone", (text) => {
    expect(parseCoordinatePair(text)).toBeNull();
  });

  it("keeps a zero without a sign", () => {
    expect(Object.is(parseCoordinatePair("0, -0")?.longitude, 0)).toBe(true);
  });
});

describe("coordinateEntry", () => {
  // Mutation: return `{ [axis]: text }` always, and a pasted pair stays in
  // one field.
  it("puts a pasted pair in both fields, whichever one it landed in", () => {
    const both = { latitude: "-33.629", longitude: "150.3156" };
    expect(coordinateEntry("-33.6290, 150.3156", "latitude", "")).toEqual(both);
    expect(coordinateEntry("-33.6290, 150.3156", "longitude", "")).toEqual(
      both,
    );
  });

  // Mutation: drop the keystroke test, and typing "-33.6, 1" splits at the
  // 1 and the rest of the longitude lands in the latitude.
  it("leaves a typed key alone, even one that completes a pair", () => {
    expect(coordinateEntry("-33.6, 1", "latitude", "-33.6, ")).toEqual({
      latitude: "-33.6, 1",
    });
  });

  // Mutation: sanitise the text, and a mistake is quietly rewritten.
  it("keeps anything else exactly as typed", () => {
    expect(coordinateEntry("-33,6290 150,3156", "latitude", "")).toEqual({
      latitude: "-33,6290 150,3156",
    });
    expect(coordinateEntry("12abc", "longitude", "")).toEqual({
      longitude: "12abc",
    });
  });
});

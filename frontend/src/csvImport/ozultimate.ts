import { norm, stripWaterwaySuffix } from "./matchCanyon";

const BASE = "https://ozultimate.com/canyoning/track_notes/";

type OzEntry = { name: string; altNames: string[]; url: string };

const OZULTIMATE: OzEntry[] = [
  // Newnes
  { name: "Newnes (Starlight) Canyon", altNames: ["Starlight"], url: BASE + "newnes.htm" },
  { name: "Devils Pinch Canyon", altNames: [], url: BASE + "devils_pinch.htm" },
  { name: "Pipeline Canyon", altNames: [], url: BASE + "pipeline.htm" },
  { name: "Firefly Canyon", altNames: [], url: BASE + "firefly.htm" },
  // South Wolgan
  { name: "Tiger Snake Canyon", altNames: [], url: BASE + "tiger_snake.htm" },
  { name: "The Dry Canyon", altNames: [], url: BASE + "the_dry.htm" },
  { name: "Surefire Canyon", altNames: [], url: BASE + "surefire.htm" },
  { name: "Heart Attack Canyon", altNames: [], url: BASE + "heart_attack.htm" },
  { name: "Galah Canyon", altNames: [], url: BASE + "galah.htm" },
  { name: "Thunderstorm Canyon", altNames: [], url: BASE + "thunderstorm.htm" },
  { name: "Closet Canyon", altNames: [], url: BASE + "closet.htm" },
  { name: "Breakfast Creek Canyon", altNames: [], url: BASE + "breakfast_creek.htm" },
  { name: "Coachwood Canyon", altNames: [], url: BASE + "coachwood.htm" },
  { name: "Rocky Creek Canyon", altNames: [], url: BASE + "rocky_creek.htm" },
  { name: "Twister Canyon", altNames: [], url: BASE + "twister.htm" },
  { name: "Deep Pass Canyon", altNames: [], url: BASE + "deep_pass.htm" },
  { name: "The River Caves", altNames: [], url: BASE + "the_river_caves.htm" },
  // Bungleboori
  { name: "Hole-in-the-Wall Canyon", altNames: ["Hole in the Wall"], url: BASE + "hole-in-the-wall.htm" },
  // Wollangambe
  { name: "Waterfall of Moss Canyon", altNames: [], url: BASE + "waterfall_of_moss.htm" },
  { name: "Whungee Wheengee Canyon", altNames: ["Wheengee Whungee"], url: BASE + "whungee_wheengee.htm" },
  { name: "Water Dragon Canyon", altNames: [], url: BASE + "water_dragon.htm" },
  { name: "Geronimo Canyon", altNames: [], url: BASE + "geronimo.htm" },
  { name: "Upper Wollangambe Canyon", altNames: ["Wollangambe Upper", "Upper Wollangambe"], url: BASE + "upper_wollangambe.htm" },
  { name: "Wollangambe Canyon - Upper Tourist Section (Wollangambe 1)", altNames: ["Wollangambe 1"], url: BASE + "wollangambe_1.htm" },
  { name: "Wollangambe Canyon - Lower Tourist Section (Wollangambe 2)", altNames: ["Wollangambe 2"], url: BASE + "wollangambe_2.htm" },
  { name: "Bell Creek Canyon", altNames: [], url: BASE + "bell_creek.htm" },
  { name: "Bell Creek Complete Canyon", altNames: [], url: BASE + "bell_creek_complete.htm" },
  { name: "Clatterteeth Canyon (Du Faur Creek)", altNames: ["Du Faur Creek"], url: BASE + "clatterteeth.htm" },
  { name: "Why Don't We Do It In The Road Canyon", altNames: [], url: BASE + "why_dont_we_do_it_in_the_road.htm" },
  { name: "Lower Bowens Creek North Canyon", altNames: ["Bowens Creek North Lower", "Lower Bowens Creek North"], url: BASE + "lower_bowens_creek_north.htm" },
  { name: "Bowens Creek North Canyon", altNames: [], url: BASE + "bowens_creek_north.htm" },
  { name: "Upper Bowens Creek South Canyon", altNames: ["Bowens Creek South Upper", "Upper Bowens Creek South"], url: BASE + "upper_bowens_creek_south.htm" },
  // North Grose
  { name: "Yileen Canyon", altNames: [], url: BASE + "yileen.htm" },
  { name: "Wotta Canyon", altNames: [], url: BASE + "wotta.htm" },
  { name: "Better Offer Canyon", altNames: [], url: BASE + "better_offer.htm" },
  { name: "Birrabang Canyon", altNames: [], url: BASE + "birrabang.htm" },
  { name: "Dalpura Canyon", altNames: [], url: BASE + "dalpura.htm" },
  { name: "Jungaburra Canyon", altNames: [], url: BASE + "jungaburra.htm" },
  { name: "Koombanda Canyon", altNames: [], url: BASE + "koombanda.htm" },
  { name: "Dargans Creek Canyon", altNames: [], url: BASE + "dargans_creek.htm" },
  // Carmarthen Labyrinth
  { name: "Claustral Canyon", altNames: [], url: BASE + "claustral.htm" },
  { name: "Ranon Canyon", altNames: [], url: BASE + "ranon.htm" },
  { name: "Thunder Canyon", altNames: [], url: BASE + "thunder.htm" },
  // South Grose
  { name: "Fortress Canyon", altNames: [], url: BASE + "fortress.htm" },
  { name: "Grand Canyon", altNames: [], url: BASE + "grand.htm" },
  { name: "Mt Hay Canyon", altNames: [], url: BASE + "mt_hay.htm" },
  { name: "Jugglers Canyon", altNames: [], url: BASE + "jugglers.htm" },
  { name: "Hat Hill Canyon", altNames: [], url: BASE + "hat_hill.htm" },
  { name: "Crayfish Creek Canyon", altNames: [], url: BASE + "crayfish_creek.htm" },
  // Jamison Valley
  { name: "Empress Canyon", altNames: [], url: BASE + "empress.htm" },
  // Kanangra
  { name: "Davies Canyon", altNames: [], url: BASE + "davies.htm" },
  { name: "Carrabeanga Falls", altNames: ["Carra Beanga", "Carrabeanga"], url: BASE + "carrabeanga_falls.htm" },
  { name: "Danae Brook Canyon", altNames: [], url: BASE + "danae_brook.htm" },
  { name: "Kanangra Main Canyon", altNames: ["Kanangra Main"], url: BASE + "kanangra_main.htm" },
  { name: "Kalang Falls", altNames: [], url: BASE + "kalang_falls.htm" },
  { name: "Dione Dell Canyon", altNames: [], url: BASE + "dione_dell.htm" },
  // South Coast
  { name: "Macquarie Pass Canyon", altNames: [], url: BASE + "macquarie_pass.htm" },
  // Bungonia
  { name: "Bungonia Creek Canyon", altNames: ["Bungonia Main", "Bungonia"], url: BASE + "bungonia_creek.htm" },
  { name: "Jerrara Creek Canyon", altNames: ["Jerrara"], url: BASE + "jerrara_creek.htm" },
  { name: "Long Gully Canyon", altNames: [], url: BASE + "long_gully.htm" },
];

export function matchOzUltimateUrl(
  canyonName: string,
  canyonAltNames: string[] = [],
): string | null {
  const query = stripWaterwaySuffix(canyonName);
  const queryAlts = canyonAltNames.map(stripWaterwaySuffix);

  const matches = OZULTIMATE.filter((entry) => {
    const entryNorm = norm(entry.name);
    const entryStripped = stripWaterwaySuffix(entry.name);
    return (
      entryNorm.includes(query) ||
      entryStripped.includes(query) ||
      entry.altNames.some((a) => norm(a).includes(query)) ||
      queryAlts.some(
        (q) =>
          entryNorm.includes(q) ||
          entryStripped.includes(q) ||
          entry.altNames.some((a) => norm(a).includes(q)),
      )
    );
  });

  return matches.length === 1 ? matches[0].url : null;
}

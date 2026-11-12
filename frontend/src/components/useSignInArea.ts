// Which canyon area the sign-in screen shows this visit, and its files. Each
// area's files come from frontend/scripts/sign_in_terrain.py; only the one
// shown is downloaded.
import { useEffect, useState } from "react";
import { areaKeys, pickArea } from "./signInTerrain";

export type Terrain = {
  name: string;
  /** The month its DEM sheets were downloaded, which the credit names. */
  extracted: string;
  lat: number;
  lon: number;
  w: number;
  h: number;
  /** The 100 m contours. */
  levels: { m: number; d: string }[];
};

export type Area = { terrain: Terrain; normalsUrl: string; flowUrl: string };

const DIR = "../assets/signIn/";
const CONTOURS = import.meta.glob<Terrain>("../assets/signIn/*.json", {
  import: "default",
});
const NORMALS = import.meta.glob<string>("../assets/signIn/*Normals.webp", {
  query: "?url",
  import: "default",
});
const FLOWS = import.meta.glob<string>("../assets/signIn/*Flow.webp", {
  query: "?url",
  import: "default",
});
const LAST_AREA_KEY = "logjam.signInArea";

let chosen: string | undefined;

/** This visit's area, remembered so the next visit shows another. Chosen
 *  once per page load, however often the component mounts. */
function chooseArea() {
  chosen ??= pickAndRemember();
  return chosen;
}

function pickAndRemember() {
  const keys = areaKeys(
    Object.keys(CONTOURS),
    Object.keys(NORMALS),
    Object.keys(FLOWS),
  );
  // Logjam Web in development takes `?area=<key>`, to look at each one.
  const asked = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("area")
    : null;
  if (asked && keys.includes(asked)) return asked;
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_AREA_KEY);
  } catch {
    // No storage: a repeat now and then is all it costs.
  }
  const key = pickArea(keys, last, Math.random());
  try {
    localStorage.setItem(LAST_AREA_KEY, key);
  } catch {
    // As above.
  }
  return key;
}

/**
 * This visit's area, once its files have loaded. Loaded after the form has
 * drawn, so nothing on the way in waits for it; if they fail to load, the
 * screen is the form alone.
 */
export default function useSignInArea() {
  const [area, setArea] = useState<Area | null>(null);
  useEffect(() => {
    let live = true;
    const key = chooseArea();
    if (!key) return;
    Promise.all([
      CONTOURS[`${DIR}${key}.json`](),
      NORMALS[`${DIR}${key}Normals.webp`](),
      FLOWS[`${DIR}${key}Flow.webp`](),
    ])
      .then(([terrain, normalsUrl, flowUrl]) => {
        if (live) setArea({ terrain, normalsUrl, flowUrl });
      })
      .catch(() => {
        // Decoration: no terrain is the whole of the failure.
      });
    return () => {
      live = false;
    };
  }, []);
  return area;
}

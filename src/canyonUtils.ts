import Papa from "papaparse";
import { useEffect, useState } from "react";

export type TCanyon = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  v_grade: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null;
  a_grade: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null;
  commitment: 1 | 2 | 3 | 4 | 5 | 6 | null;
  quality: number | null;
  pitches: number | null;
  longest_pitch: number | null;
  hours: number | null;
  rock_type: string | null;
  wetsuits: 1 | 2 | 3 | 4 | 5 | null;
  alt_names: string[] | null;
  sources: [string, string][] | null;
  description: string | null;
};

export type TFilters = {
  name: TCanyon["name"] | null;
  v_grade: number[] | null;
  a_grade: number[] | null;
  commitment: number[] | null;
  quality: number[] | null;
  pitches: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  longest_pitch: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  hours: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  wetsuits: number[] | null;
};

export function useCanyons() {
  const [canyons, setCanyons] = useState<TCanyon[]>([]);

  useEffect(() => {
    fetch("/canyons.csv")
      .then((response) => response.text())
      .then((csvText) => {
        const result = Papa.parse<TCanyon>(csvText, {
          header: true,
          skipEmptyLines: true,
        });
        const data = (result.data as TCanyon[]).map((row) => ({
          ...row,
          id: Number(row.id),
          name: row.name || "Unnamed Canyon",
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          v_grade: row.v_grade
            ? (Number(row.v_grade) as 1 | 2 | 3 | 4 | 5 | 6 | 7)
            : null,
          a_grade: row.a_grade
            ? (Number(row.a_grade) as 1 | 2 | 3 | 4 | 5 | 6 | 7)
            : null,
          commitment: row.commitment
            ? (Number(row.commitment) as 1 | 2 | 3 | 4 | 5 | 6)
            : null,
          quality: row.quality ? Number(row.quality) : null,
          pitches: row.pitches ? Number(row.pitches) : null,
          longest_pitch: row.longest_pitch ? Number(row.longest_pitch) : null,
          hours: row.hours ? Number(row.hours) : null,
          rock_type: row.rock_type || null,
          wetsuits: row.wetsuits
            ? (Number(row.wetsuits) as 1 | 2 | 3 | 4 | 5)
            : null,
          alt_names:
            row.alt_names && typeof row.alt_names === "string"
              ? JSON.parse(row.alt_names)["alternative_names"]
              : null,
          sources:
            row.sources && typeof row.sources === "string"
              ? JSON.parse(row.sources)
              : null,
          description: row.description || null,
        }));
        setCanyons(data);
      });
  }, []);

  return canyons;
}

export function passesFilters(canyon: TCanyon, filters: TFilters): boolean {
  function passesSliderFilter(name: keyof TFilters, range: [number, number]) {
    if (
      filters[name] &&
      (!Array.isArray(filters[name]) ||
        filters[name].length !== 2 ||
        filters[name][0] !== range[0] ||
        filters[name][1] !== range[1])
    ) {
      if (canyon[name] == null) {
        return false;
      } else if (
        canyon[name] < filters[name][0] ||
        canyon[name] > filters[name][1]
      ) {
        return false;
      }
    }
    return true;
  }

  function passesSelectNumberFilter(name: keyof TFilters) {
    if (filters[name] && filters[name][0] !== "Any") {
      if (canyon[name] == null) {
        return false;
      } else if (
        (filters[name][0] === "Less than" &&
          canyon[name] >= filters[name][1]) ||
        (filters[name][0] === "More than" &&
          canyon[name] <= filters[name][1]) ||
        (filters[name][0] === "Exactly" && canyon[name] !== filters[name][1])
      ) {
        return false;
      }
    }
    return true;
  }

  if (
    typeof filters.name === "string" &&
    filters.name.trim() !== "" &&
    !canyon.name.toLowerCase().includes(filters.name.toLowerCase()) &&
    !canyon.alt_names?.some((altName: string) =>
      altName.toLowerCase().includes(filters.name!.toLowerCase())
    )
  ) {
    return false;
  }

  if (!passesSliderFilter("v_grade", [1, 7])) return false;
  if (!passesSliderFilter("a_grade", [1, 7])) return false;
  if (!passesSliderFilter("commitment", [1, 6])) return false;
  if (!passesSliderFilter("quality", [1, 5])) return false;
  if (!passesSelectNumberFilter("pitches")) return false;
  if (!passesSelectNumberFilter("longest_pitch")) return false;
  if (!passesSelectNumberFilter("hours")) return false;
  if (!passesSliderFilter("wetsuits", [1, 5])) return false;
  return true;
}

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
  pitches: number[] | null;
  longest_pitch: number[] | null;
  hours: number[] | null;
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
  if (
    filters.v_grade &&
    (!Array.isArray(filters.v_grade) ||
      filters.v_grade.length !== 2 ||
      filters.v_grade[0] !== 1 ||
      filters.v_grade[1] !== 7)
  ) {
    if (!canyon.v_grade) {
      return false;
    } else if (
      canyon.v_grade < filters.v_grade[0] ||
      canyon.v_grade > filters.v_grade[1]
    ) {
      return false;
    }
  }
  if (
    filters.a_grade &&
    (!Array.isArray(filters.a_grade) ||
      filters.a_grade.length !== 2 ||
      filters.a_grade[0] !== 1 ||
      filters.a_grade[1] !== 7)
  ) {
    if (!canyon.a_grade) {
      return false;
    } else if (
      canyon.a_grade < filters.a_grade[0] ||
      canyon.a_grade > filters.a_grade[1]
    ) {
      return false;
    }
  }
  if (
    filters.commitment &&
    (!Array.isArray(filters.commitment) ||
      filters.commitment.length !== 2 ||
      filters.commitment[0] !== 1 ||
      filters.commitment[1] !== 6)
  ) {
    if (!canyon.commitment) {
      return false;
    } else if (
      canyon.commitment < filters.commitment[0] ||
      canyon.commitment > filters.commitment[1]
    ) {
      return false;
    }
  }
  if (
    filters.quality &&
    (!Array.isArray(filters.quality) ||
      filters.quality.length !== 2 ||
      filters.quality[0] !== 1 ||
      filters.quality[1] !== 6)
  ) {
    if (!canyon.quality) {
      return false;
    } else if (
      canyon.quality < filters.quality[0] ||
      canyon.quality > filters.quality[1]
    ) {
      return false;
    }
  }
  // will check for uther filters when added
  return true;
}

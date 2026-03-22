import { useEffect, useState } from "react";

export type TCanyonAttributes = {
  v_grade?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  a_grade?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  commitment?: 1 | 2 | 3 | 4 | 5 | 6;
  quality?: number;
  wetsuits?: 1 | 2 | 3 | 4 | 5;
  rock_type?: string;
  hours?: number;
  sources?: [string, string][];
  description?: string;
};

export type TCanyon = {
  id: string;
  name: string;
  altNames: string[];
  latitude: number;
  longitude: number;
  grade: string | null;
  numAbseils: number | null;
  longestAbseil: number | null;
  notes: string | null;
  attributes: TCanyonAttributes;
  createdAt: string;
  updatedAt: string;
};

export type TFilters = {
  name: string | null;
  v_grade: number[] | null;
  a_grade: number[] | null;
  commitment: number[] | null;
  quality: number[] | null;
  pitches: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  longest_pitch: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  hours: ["Any" | "Less than" | "More than" | "Exactly", number] | null;
  wetsuits: number[] | null;
};

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export function useCanyons(token: string | null) {
  const [canyons, setCanyons] = useState<TCanyon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    apiFetch<TCanyon[]>("/canyons", token)
      .then(setCanyons)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  return { canyons, loading, error };
}

export function useSharedCanyons(token: string | null) {
  const [canyons, setCanyons] = useState<TCanyon[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    apiFetch<TCanyon[]>("/canyons/shared", token)
      .then(setCanyons)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  return { canyons, loading };
}

export function passesFilters(canyon: TCanyon, filters: TFilters): boolean {
  const attr = canyon.attributes;

  function passesSliderFilter(
    value: number | null | undefined,
    filter: number[] | null,
    range: [number, number],
  ): boolean {
    if (filter && (filter[0] !== range[0] || filter[1] !== range[1])) {
      if (value == null) return false;
      if (value < filter[0] || value > filter[1]) return false;
    }
    return true;
  }

  function passesSelectNumberFilter(
    value: number | null | undefined,
    filter: ["Any" | "Less than" | "More than" | "Exactly", number] | null,
  ): boolean {
    if (filter && filter[0] !== "Any") {
      if (value == null) return false;
      if (filter[0] === "Less than" && value >= filter[1]) return false;
      if (filter[0] === "More than" && value <= filter[1]) return false;
      if (filter[0] === "Exactly" && value !== filter[1]) return false;
    }
    return true;
  }

  if (filters.name && filters.name.trim() !== "") {
    const query = filters.name.toLowerCase();
    const matchesName = canyon.name.toLowerCase().includes(query);
    const matchesAlt = canyon.altNames?.some((n) =>
      n.toLowerCase().includes(query),
    );
    if (!matchesName && !matchesAlt) return false;
  }

  if (!passesSliderFilter(attr.v_grade, filters.v_grade, [1, 7])) return false;
  if (!passesSliderFilter(attr.a_grade, filters.a_grade, [1, 7])) return false;
  if (!passesSliderFilter(attr.commitment, filters.commitment, [1, 6]))
    return false;
  if (!passesSliderFilter(attr.quality, filters.quality, [1, 5])) return false;
  if (!passesSelectNumberFilter(canyon.numAbseils, filters.pitches))
    return false;
  if (!passesSelectNumberFilter(canyon.longestAbseil, filters.longest_pitch))
    return false;
  if (!passesSelectNumberFilter(attr.hours, filters.hours)) return false;
  if (!passesSliderFilter(attr.wetsuits, filters.wetsuits, [1, 5]))
    return false;

  return true;
}

export function formatCanyonGrade(canyon: TCanyon): string | null {
  const { v_grade, a_grade, commitment } = canyon.attributes;
  if (!v_grade && !a_grade && !commitment) return null;
  const v = v_grade ? `v${v_grade}` : "v?";
  const a = a_grade ? `a${a_grade}` : "a?";
  const c = commitment
    ? " " + ["I", "II", "III", "IV", "V", "VI"][commitment - 1]
    : "";
  return `${v}${a}${c}`;
}

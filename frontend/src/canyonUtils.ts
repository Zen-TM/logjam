import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";

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

// Gets a fresh ID token from Amplify on every call. Amplify automatically
// refreshes the token using the refresh token when the ID token has expired
// (every 1 hour), so callers never need to worry about expiry.
async function getIdToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error("No auth session");
  return token;
}

// Every API call fetches its own fresh token internally, so hooks don't
// need a token parameter — just a boolean to control whether to fetch.
async function apiFetch<T>(path: string): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export function useCanyons(enabled: boolean) {
  const [canyons, setCanyons] = useState<TCanyon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    apiFetch<TCanyon[]>("/canyons")
      .then(setCanyons)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [enabled]);

  return { canyons, loading, error };
}

export function useSharedCanyons(enabled: boolean) {
  const [canyons, setCanyons] = useState<TCanyon[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    apiFetch<TCanyon[]>("/canyons/shared")
      .then(setCanyons)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [enabled]);

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

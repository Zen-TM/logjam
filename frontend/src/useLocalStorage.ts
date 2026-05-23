import { useState, useEffect, type Dispatch, type SetStateAction } from "react";

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw) as T;
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {
        // quota or security restriction — ignore
      }
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn(`useLocalStorage: failed to persist "${key}"`, err);
    }
  }, [key, value]);

  return [value, setValue];
}

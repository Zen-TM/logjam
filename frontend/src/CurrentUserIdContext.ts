import { createContext } from "react";

/** The signed-in user's id, or null until `/users/me` has answered. */
export const CurrentUserIdContext = createContext<string | null>(null);

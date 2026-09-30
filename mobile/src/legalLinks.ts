import { Linking } from "react-native";

// The hosted documents, even in a dev build: what a user agrees to is the
// policy published for the service, and a dev phone often cannot reach the
// dev machine's Vite server anyway.
export const TERMS_URL = "https://logjamnsw.com/tos.html";
export const PRIVACY_POLICY_URL = "https://logjamnsw.com/privacy.html";

/** Opens a legal document in the phone's browser. */
export function openLegalDocument(url: string): void {
  Linking.openURL(url).catch((err: unknown) => console.error(err));
}

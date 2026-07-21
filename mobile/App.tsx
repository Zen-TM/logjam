import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { config, CLIENT_VERSION, CLIENT_VERSION_HEADER } from "./src/config";

// Stage 0 deliverable: a blank shell that proves the app builds, runs on a
// device/simulator, reads config, and can reach the API. Auth (Stage 1) will
// wrap this fetch in a real Cognito token; for now an unauthed probe of the API
// base is enough to confirm end-to-end wiring. Do not build UI beyond this in
// Stage 0 — the real screens start at Stage 1.
type Probe =
  | { status: "loading" }
  | { status: "reached"; httpStatus: number }
  | { status: "error"; message: string };

export default function App() {
  const [probe, setProbe] = useState<Probe>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${config.apiUrl}/users/me`, {
      headers: { [CLIENT_VERSION_HEADER]: CLIENT_VERSION },
    })
      .then((response) => {
        if (!cancelled) {
          setProbe({ status: "reached", httpStatus: response.status });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setProbe({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Logjam Mobile</Text>
      <Text style={styles.line}>{CLIENT_VERSION}</Text>
      <Text style={styles.line}>API: {config.apiUrl}</Text>
      <Text style={styles.line}>
        {probe.status === "loading" && "Probing API…"}
        {probe.status === "reached" &&
          `API reached (HTTP ${probe.httpStatus} — 401 expected until Stage 1 auth)`}
        {probe.status === "error" && `API unreachable: ${probe.message}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  title: { fontSize: 22, fontWeight: "600" },
  line: { fontSize: 14, opacity: 0.8, textAlign: "center" },
});

// One tap that writes a `mark` row into the research sensor log: "stopped
// here", "moving again". Developer builds only. `sensorLogRunning` is false
// without the native module and while no log is running, and then this draws
// nothing (`sensorLog.test.ts`).
//
// A full-width button in the map's notice stack because it is pressed in wet
// gloves, and the count in its label is the confirmation that the tap landed.
import { useState, useSyncExternalStore } from "react";

import { Button } from "../ui";
import {
  markSensorLog,
  onSensorLogRunningChanged,
  sensorLogMarkCount,
  sensorLogRunning,
} from "./sensorLog";

/** Give it `key={trackId}`: the count is read once per recording. */
export function SensorMarkButton({ trackId }: { trackId: string }) {
  const running = useSyncExternalStore(
    onSensorLogRunningChanged,
    sensorLogRunning,
  );
  const [count, setCount] = useState(() => sensorLogMarkCount(trackId));
  if (!running) return null;
  return (
    <Button
      label={count === 0 ? "Mark" : `Mark (${count})`}
      icon="flag"
      onPress={() => {
        const n = markSensorLog(trackId);
        if (n != null) setCount(n);
      }}
    />
  );
}

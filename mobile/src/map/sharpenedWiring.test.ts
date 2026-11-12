// The screens' wiring of the sharpened areas, read as text: neither screen
// has a render test, and each line here holds a fix the pure helpers'
// tests can't see dropped (sharpenedClips.test.ts, sharpenedAreaStore.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

describe("the save screen", () => {
  const source = read("map/RegionDownloadScreen.tsx");

  // Mutation: drop the effect, and an area new since the map loaded its list
  // is cut into the save but never drawn or read offline.
  it("keeps the list it cuts from", () => {
    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]{0,120}rememberSharpenedAreas\(sharpenedAreas, areasEpoch\)/,
    );
  });

  // Mutations: build `canDownload` without the gate, or hard-code the gate's
  // connectivity, and a signed-in save goes ahead online without the areas
  // and without a word.
  it("lets Save go ahead only as the gate says, from the live connectivity", () => {
    expect(source).toMatch(/const online = useConnectivity\(\) === "online";/);
    expect(source).toMatch(/saveGate\(areasState, online\)/);
    expect(source).toMatch(/const canDownload =[^;]*gate\.canSave/);
  });

  // Mutation: let the tap read its own connectivity (`isConnected`), and on
  // Wi-Fi with no internet Save is enabled, no alert shows, and the save
  // queues with no area list.
  it("asks for a connection at the tap by the gate's reading", () => {
    expect(source).toMatch(/if \(gate\.noConnection\)/);
    expect(source).not.toMatch(/isConnected === false/);
  });
});

describe("the map", () => {
  // Mutation: drop the subscription, and the map draws its saved area clips
  // from the list it loaded at mount, never the save screen's newer one.
  it("reads the kept area list again whenever it changes", () => {
    expect(read("map/MapScreen.tsx")).toMatch(
      /subscribeSharpenedAreas\(read\)/,
    );
  });
});

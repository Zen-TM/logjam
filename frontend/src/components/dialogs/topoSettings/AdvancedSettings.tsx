import { useState } from "react";
import { Tabs, Tab, Box } from "@mui/material";
import type { TopoSettings } from "@logjam/shared";
import HillshadeSettings from "./HillshadeSettings";
import SlopeSettings from "./SlopeSettings";
import VegetationSettings from "./VegetationSettings";
import ContoursSettings from "./ContoursSettings";
import OsmSettings from "./OsmSettings";
import LayerToggles from "./LayerToggles";

interface Props {
  value: TopoSettings;
  onChange: (next: TopoSettings) => void;
}

export default function AdvancedSettings({ value, onChange }: Props) {
  const [tab, setTab] = useState(0);

  const patch = <K extends keyof TopoSettings>(key: K, sub: TopoSettings[K]) =>
    onChange({ ...value, [key]: sub });

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab label="Layers" />
        <Tab label="Hillshade" />
        <Tab label="Slope" />
        <Tab label="Vegetation" />
        <Tab label="Contours" />
        <Tab label="OSM" />
      </Tabs>

      {tab === 0 && <LayerToggles value={value} onChange={onChange} />}
      {tab === 1 && <HillshadeSettings value={value.hillshade} onChange={(v) => patch("hillshade", v)} />}
      {tab === 2 && <SlopeSettings value={value.slope} onChange={(v) => patch("slope", v)} />}
      {tab === 3 && <VegetationSettings value={value.vegetation} onChange={(v) => patch("vegetation", v)} />}
      {tab === 4 && <ContoursSettings value={value.contours} onChange={(v) => patch("contours", v)} />}
      {tab === 5 && <OsmSettings value={value.features} onChange={(v) => patch("features", v)} />}
    </Box>
  );
}

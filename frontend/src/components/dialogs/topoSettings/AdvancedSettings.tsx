import { useState } from "react";
import { Tabs, Tab, Box } from "@mui/material";
import type { RasterTemplateSettings } from "@logjam/shared";
import HillshadeSettings from "./HillshadeSettings";
import SlopeSettings from "./SlopeSettings";
import VegetationSettings from "./VegetationSettings";
import ContoursSettings from "./ContoursSettings";
import LayerToggles from "./LayerToggles";

interface Props {
  value: RasterTemplateSettings;
  onChange: (next: RasterTemplateSettings) => void;
}

export default function AdvancedSettings({ value, onChange }: Props) {
  const [tab, setTab] = useState(0);

  const patch = <K extends keyof RasterTemplateSettings>(key: K, sub: RasterTemplateSettings[K]) =>
    onChange({ ...value, [key]: sub });

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="fullWidth"
      >
        <Tab label="Layers" sx={{ minWidth: 0, px: 0.75, fontSize: "0.8em" }} />
        <Tab label="Hillshade" sx={{ minWidth: 0, px: 0.75, fontSize: "0.8em" }} />
        <Tab label="Slope" sx={{ minWidth: 0, px: 0.75, fontSize: "0.8em" }} />
        <Tab label="Vegetation" sx={{ minWidth: 0, px: 0.75, fontSize: "0.8em" }} />
        <Tab label="Contours" sx={{ minWidth: 0, px: 0.75, fontSize: "0.8em" }} />
      </Tabs>

      {tab === 0 && <LayerToggles value={value} onChange={onChange} />}
      {tab === 1 && <HillshadeSettings value={value.hillshade} onChange={(v) => patch("hillshade", v)} />}
      {tab === 2 && <SlopeSettings value={value.slope} onChange={(v) => patch("slope", v)} />}
      {tab === 3 && <VegetationSettings value={value.vegetation} onChange={(v) => patch("vegetation", v)} />}
      {tab === 4 && <ContoursSettings value={value.contours} onChange={(v) => patch("contours", v)} />}
    </Box>
  );
}
